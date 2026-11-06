// API client: HTTP helpers and one shared WebSocket.
// - App login: GET /api/session, POST /api/login, POST /api/logout.
// - Each WS frame is a JSON array of messages (one message also works).
// - Reconnects with backoff. Close code 4401 = not logged in: the app
//   shows the login screen and calls start() again after login.
// - Server keeps tab connections for 15 min while the WS is down, so the
//   client does not send "connect" again after a reconnect.
// - Mock mode: URL ?mock=1, or by itself in dev when the backend is down.
import type {
  ClientMsg, ConfigResponse, FileInfo, HealthResponse, ServerFrame, ServerMsg, SessionResponse,
  UpdateInfo, UpdateStarted, VersionResponse, WorkspaceDoc, ProfilesDoc, SavedProfile, TestResult, LiveTabs,
} from './protocol';
import { PING_INTERVAL_MS, WS_CLOSE_NO_SESSION } from './protocol';
import { MockServer, mockFiles, mockHttp } from './mock';

/**
 * Id of this browser tab. The server keeps connections and messages per window, so two browser tabs
 * do not mix results. sessionStorage keeps the id over a reload (the open DB connections come back).
 * A duplicated browser tab copies sessionStorage and so shares the id (known limit).
 */
function windowId(): string {
  const key = 'sqlwb.win';
  const fresh = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  try {
    const id = sessionStorage.getItem(key) ?? fresh;
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return fresh;
  }
}
export const WINDOW_ID = windowId();

export type LinkStatus = 'connecting' | 'open' | 'closed' | 'mock' | 'auth';
type Handler = (m: ServerMsg) => void;

const MOCK_CONFIG: ConfigResponse = {
  defaultProfile: { name: 'demo (mock)', url: 'jdbc:oracle:thin:@//localhost:1521/FREEPDB1' },
};
const MOCK_VERSION: VersionResponse = { app: 'sqlwb-web (mock)', wbBuild: '132', wbBuildDate: '2025-01-01' };

import { HttpError } from "./errors";
export { HttpError };

function wantMock(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('mock') === '1';
  } catch {
    return false;
  }
}

async function http<T>(
  method: string, path: string, body?: unknown, keepalive = false, headers: Record<string, string> = {}, onHeaders?: (h: Headers) => void,
): Promise<T> {
  const raw = typeof body === "string";
  const r = await fetch(path, {
    method,
    credentials: "same-origin",
    keepalive,
    headers: body !== undefined ? { "Content-Type": raw ? "text/plain" : "application/json", ...headers } : headers,
    body: body !== undefined ? (raw ? body : JSON.stringify(body)) : undefined,
  });
  onHeaders?.(r.headers);
  const text = await r.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!r.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `${path}: HTTP ${r.status}`;
    throw new HttpError(r.status, msg);
  }
  return data as T;
}

export class WbClient {
  mock: boolean = wantMock();
  status: LinkStatus = this.mock ? 'mock' : 'closed';

  private ws: WebSocket | null = null;
  private mockServer: MockServer | null = null;
  private queue: ClientMsg[] = [];
  private tabHandlers = new Map<string, Set<Handler>>();
  private allHandlers = new Set<Handler>();
  private frameHandlers = new Set<(msgs: ServerMsg[]) => void>();
  private statusHandlers = new Set<(s: LinkStatus) => void>();
  private retry = 0;
  private everOpened = false;
  private pingTimer: number | undefined;
  private reconnectTimer: number | undefined;
  private running = false;

  // ---- HTTP ----
  private devFallback<T>(e: unknown, value: T): T {
    // Dev only: backend not running -> switch to mock.
    if (import.meta.env.DEV && !(e instanceof HttpError) && !this.everOpened) {
      this.switchToMock(`backend not reachable (${String(e)})`);
      return value;
    }
    throw e;
  }

  health(): Promise<HealthResponse> {
    return this.mock ? Promise.resolve({ status: 'UP' }) : http('GET', '/api/health');
  }
  version(): Promise<VersionResponse> {
    return this.mock ? Promise.resolve(MOCK_VERSION) : http<VersionResponse>('GET', '/api/version').catch(() => MOCK_VERSION);
  }
  async config(): Promise<ConfigResponse> {
    if (this.mock) return MOCK_CONFIG;
    try {
      return await http<ConfigResponse>('GET', '/api/config');
    } catch {
      return MOCK_CONFIG;
    }
  }
  async session(): Promise<SessionResponse> {
    if (this.mock) return mockHttp.session();
    try {
      return await http<SessionResponse>('GET', '/api/session');
    } catch (e) {
      return this.devFallback(e, mockHttp.session());
    }
  }
  async login(name: string, password: string): Promise<SessionResponse> {
    if (this.mock) return mockHttp.login(name);
    return http<SessionResponse>('POST', '/api/login', { name, password });
  }
  async logout(): Promise<void> {
    this.stop();
    if (this.mock) mockHttp.logout();
    else await http('POST', '/api/logout').catch(() => null);
  }
  /** Version of the workspace on the server, sent with each save. -1 = unknown (save always). */
  workspaceVersion = -1;
  async getWorkspace(): Promise<WorkspaceDoc> {
    if (this.mock) { this.workspaceVersion = mockHttp.workspaceVersion(); return mockHttp.getWorkspace(); }
    const doc = await http<WorkspaceDoc | null>('GET', '/api/workspace', undefined, false, {}, (h) => {
      const v = h.get('X-Workspace-Version');
      this.workspaceVersion = v == null ? -1 : Number(v);
    });
    return doc ?? {};
  }
  /** keepalive = true for pagehide / visibilitychange. force = overwrite a newer version. HTTP 409 = saved from another tab. */
  async putWorkspace(doc: WorkspaceDoc, keepalive = false, force = false): Promise<void> {
    const ver = force ? -1 : this.workspaceVersion;
    if (this.mock) { this.workspaceVersion = mockHttp.putWorkspace(doc, ver); return; }
    const r = await http<{ version: number }>('PUT', '/api/workspace', doc, keepalive,
      ver >= 0 ? { 'X-Workspace-Version': String(ver) } : {});
    this.workspaceVersion = r.version;
  }
  async getProfiles(): Promise<ProfilesDoc> {
    if (this.mock) return mockHttp.getProfiles();
    return (await http<ProfilesDoc | null>('GET', '/api/profiles')) ?? { profiles: [] };
  }
  async putProfiles(doc: ProfilesDoc): Promise<void> {
    if (this.mock) { mockHttp.putProfiles(doc); return; }
    await http('PUT', '/api/profiles', doc);
  }
  /** Reads a desktop WbProfiles.xml / .properties file. Saves nothing. */
  async importProfiles(content: string, ini: boolean): Promise<SavedProfile[]> {
    if (this.mock) return mockHttp.importProfiles(content);
    return (await http<{ profiles: SavedProfile[] }>('POST', `/api/profiles/import${ini ? '?format=ini' : ''}`, content)).profiles;
  }
  testConnection(p: { url: string; user: string; password: string; sysdba?: boolean }): Promise<TestResult> {
    if (this.mock) return Promise.resolve(mockHttp.testConnection(p));
    return http<TestResult>('POST', '/api/test-connection', p);
  }
  async liveTabs(): Promise<LiveTabs> {
    if (this.mock) return {};
    try {
      return await http<LiveTabs>('GET', `/api/tabs?win=${encodeURIComponent(WINDOW_ID)}`);
    } catch {
      return {};
    }
  }

  // ---- File area (WbExport writes here, WbImport / WbInclude read here) ----
  async listFiles(): Promise<FileInfo[]> {
    if (this.mock) return mockFiles.list();
    return (await http<{ files: FileInfo[] }>('GET', '/api/files')).files;
  }
  /** Download link. Mock: a blob URL. */
  fileUrl(name: string): string {
    return this.mock ? mockFiles.url(name) : `/api/files/content?name=${encodeURIComponent(name)}`;
  }
  async uploadFile(name: string, file: Blob): Promise<void> {
    if (this.mock) { await mockFiles.put(name, file); return; }
    const r = await fetch(`/api/files/content?name=${encodeURIComponent(name)}`, {
      method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    });
    if (!r.ok) {
      const e = await r.json().catch(() => null) as { error?: string } | null;
      throw new HttpError(r.status, e?.error ?? `Upload failed: HTTP ${r.status}`);
    }
  }
  async deleteFile(name: string): Promise<void> {
    if (this.mock) { mockFiles.remove(name); return; }
    await http('DELETE', `/api/files/content?name=${encodeURIComponent(name)}`);
  }
  getUpdate(): Promise<UpdateInfo> {
    return this.mock ? Promise.resolve(mockHttp.update()) : http<UpdateInfo>('GET', '/api/update');
  }
  startUpdate(build: string): Promise<UpdateStarted> {
    return this.mock ? Promise.resolve(mockHttp.startUpdate()) : http<UpdateStarted>('POST', '/api/update', { build });
  }

  // ---- Subscriptions ----
  /** Messages for one tab. Returns an unsubscribe function. */
  subscribe(tabId: string, h: Handler): () => void {
    let set = this.tabHandlers.get(tabId);
    if (!set) this.tabHandlers.set(tabId, (set = new Set()));
    set.add(h);
    return () => set!.delete(h);
  }
  /** All messages, one by one (also pong). */
  subscribeAll(h: Handler): () => void {
    this.allHandlers.add(h);
    return () => this.allHandlers.delete(h);
  }
  /** All messages of one frame at once (for batched UI updates). */
  subscribeFrames(h: (msgs: ServerMsg[]) => void): () => void {
    this.frameHandlers.add(h);
    return () => this.frameHandlers.delete(h);
  }
  onStatus(h: (s: LinkStatus) => void): () => void {
    this.statusHandlers.add(h);
    return () => this.statusHandlers.delete(h);
  }

  // ---- Sending ----
  send(msg: ClientMsg) {
    if (this.mock) {
      this.ensureMock().send(msg);
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (msg.type !== 'ping') this.queue.push(msg);
  }

  /** Open the socket (after login). */
  start() {
    if (this.running) return;
    this.running = true;
    if (this.mock) {
      this.ensureMock();
      this.setStatus('mock');
      return;
    }
    this.retry = 0;
    this.open();
  }

  /** Close the socket and stop reconnects (logout). */
  stop() {
    this.running = false;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
    this.queue = [];
  }

  // ---- Internals ----
  private dispatchFrame(frame: ServerFrame) {
    const msgs = Array.isArray(frame) ? frame : [frame];
    this.frameHandlers.forEach((h) => h(msgs));
    for (const m of msgs) {
      this.allHandlers.forEach((h) => h(m));
      if (m.tabId) this.tabHandlers.get(m.tabId)?.forEach((h) => h(m));
    }
  }

  private setStatus(s: LinkStatus) {
    this.status = s;
    this.statusHandlers.forEach((h) => h(s));
  }

  private ensureMock(): MockServer {
    if (!this.mockServer) {
      this.mockServer = new MockServer();
      this.mockServer.onMessage((f) => this.dispatchFrame(f));
    }
    return this.mockServer;
  }

  private switchToMock(reason: string) {
    if (this.mock) return;
    console.warn(`[sqlwb] ${reason}. Using the in-memory mock server.`);
    this.mock = true;
    this.ws = null;
    this.ensureMock();
    this.setStatus('mock');
    const q = this.queue;
    this.queue = [];
    q.forEach((m) => this.ensureMock().send(m));
  }

  private open() {
    if (!this.running) return;
    this.setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.everOpened = true;
      this.retry = 0;
      this.setStatus('open');
      // First message: the window id. Without it the server mixes all browser tabs of the session.
      ws.send(JSON.stringify({ type: 'hello', win: WINDOW_ID }));
      const q = this.queue;
      this.queue = [];
      q.forEach((m) => ws.send(JSON.stringify(m)));
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, PING_INTERVAL_MS);
    };
    ws.onmessage = (ev) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(ev.data)) as ServerFrame;
      } catch (e) {
        console.error('[sqlwb] bad frame', e);
        return;
      }
      this.dispatchFrame(frame);
    };
    ws.onclose = (ev) => {
      window.clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.running) return;
      if (ev.code === WS_CLOSE_NO_SESSION) {
        // Not logged in (or session expired): the app shows the login screen.
        this.running = false;
        this.setStatus('auth');
        return;
      }
      if (import.meta.env.DEV && !this.everOpened && this.retry >= 1) {
        this.switchToMock('/ws failed');
        return;
      }
      this.setStatus('closed');
      const delay = Math.min(10_000, 500 * 2 ** this.retry);
      this.retry++;
      this.reconnectTimer = window.setTimeout(() => this.open(), delay);
    };
  }
}

export const client = new WbClient();
