// Wire protocol between the web UI and the sqlwb-web backend.
// HTTP under /api, one WebSocket at /ws with JSON messages.
// Every WebSocket message has `type` and `tabId`.

// ---- HTTP ----
export interface HealthResponse { status: string }
/** GET /api/session sets an HttpOnly session cookie. user = '' means: not logged in. */
export interface SessionResponse { user: string; admin: boolean }
/** POST /api/login {name,password}. 200 = this, 401 = {error}. First login of a new name creates the account. */
export interface LoginRequest { name: string; password: string }
export interface LoginError { error: string }
/** GET /api/update */
export interface UpdateInfo { current: string; latest: string; latestDate?: string; updateAvailable: boolean; error?: string }
/** POST /api/update {build} */
export interface UpdateStarted { message: string; activeSessions: number }

/** Profile options the server uses on connect (desktop "Select Connection Profile" options). */
export interface ProfileOptions {
  /** Oracle: ALTER SESSION SET CURRENT_SCHEMA. */
  defaultSchema?: string;
  /** Runs after each connect (Wb commands work). */
  connectScript?: string;
  /** name=value lines: Wb variables set on connect. */
  variables?: string;
  /** name=value lines: JDBC connection properties. */
  properties?: string;
  /** One regex per line, hidden in completion; first line "(include)" = show only these. */
  schemaFilter?: string;
  catalogFilter?: string;
  /** Statement delimiter next to ";", e.g. "/". */
  altDelimiter?: string;
  ignoreDropErrors?: boolean;
  emptyStringIsNull?: boolean;
  trimCharData?: boolean;
  removeComments?: boolean;
  hideWarnings?: boolean;
  /** Client: ask before a tab with an open transaction closes. */
  checkUncommitted?: boolean;
  /** Imported from the desktop app. Stored, not used yet. */
  promptUser?: boolean;
}
export const PROFILE_OPTION_KEYS: (keyof ProfileOptions)[] = [
  'defaultSchema', 'connectScript', 'variables', 'properties', 'schemaFilter', 'catalogFilter', 'altDelimiter',
  'ignoreDropErrors', 'emptyStringIsNull', 'trimCharData', 'removeComments', 'hideWarnings', 'checkUncommitted', 'promptUser',
];

/** File in the user's file area (WbExport output, WbImport input). GET /api/files. */
export interface FileInfo { name: string; size: number; modified: number }

/** Saved connection profile (GET/PUT /api/profiles). The server encrypts the password when savePassword is true. */
export interface SavedProfile extends ProfileOptions {
  name: string;
  /** Group path, "/" between levels. "" = no group. */
  group: string;
  url: string;
  user: string;
  password?: string;
  savePassword: boolean;
  /** Server: the saved password cannot be decrypted (app password changed). */
  passwordLost?: boolean;
  autocommit: boolean;
  fetchSize?: number;
  timeout?: number;
  sysdba?: boolean;
  readOnly?: boolean;
  confirmUpdates?: boolean;
  confirmNoWhere?: boolean;
  rememberSchema?: boolean;
  /** Last DB Explorer schema (when rememberSchema is set). */
  explorerSchema?: string;
  color?: string;
  tags?: string;
}
export interface ProfilesDoc { profiles: SavedProfile[]; groups?: string[] }
export interface TestResult { ok: boolean; product?: string; version?: string; user?: string; error?: string; ms?: number }
/** GET /api/tabs: tabId -> info of the DB connection that is still open on the server. */
export type LiveTabs = Record<string, ConnectionInfo>;

/** GET/PUT /api/workspace. Never holds passwords. */
export interface WorkspaceConnection {
  name: string; url: string; user: string; autocommit: boolean; fetchSize?: number; color?: string;
  sysdba?: boolean; readOnly?: boolean; confirmUpdates?: boolean; timeout?: number;
  confirmNoWhere?: boolean; group?: string;
}
export interface WorkspaceTab {
  id: string; title: string; sql: string; cursor: { line: number; col: number };
  connection?: WorkspaceConnection; split?: number; history?: string[];
}
export interface WorkspaceDoc {
  tabs?: WorkspaceTab[]; activeTab?: string; theme?: 'dark' | 'light';
  maxRows?: number; timeout?: number; maxResults?: number;
  macros?: Macro[];
  /** Browser copy only: set while a server save failed, so the next start uses this copy. */
  unsentAt?: number;
  /** Browser copy only: server version the copy is based on. */
  baseVer?: number;
}
export interface Macro { name: string; sql: string; shortcut?: string }
export interface VersionResponse { app: string; wbBuild: string; wbBuildDate: string }
export interface ConfigResponse { defaultProfile: { name: string; url: string } }

// ---- Shared types ----
export interface ConnectionProfile extends ProfileOptions {
  name: string;
  url: string;
  user: string;
  password: string;
  autocommit: boolean;
  fetchSize?: number;
  color?: string;
  /** Oracle: server adds internal_logon=sysdba. */
  sysdba?: boolean;
  /** The engine blocks writes of Wb commands too. */
  readOnly?: boolean;
}

export type ExecMode = 'current' | 'selected' | 'all';

export interface ColumnInfo {
  name: string;
  typeName: string;
  jdbcType: number;
  nullable: boolean;
}

export interface ConnectionInfo {
  product: string;
  version: string;
  user: string;
  schema: string;
  url: string;
  autocommit?: boolean;
  /** Connect time in ms. */
  ms?: number;
}

// ---- Client -> server ----
export interface ConnectMsg { type: 'connect'; tabId: string; profile: ConnectionProfile }
export interface ExecuteMsg {
  type: 'execute';
  tabId: string;
  reqId: string;
  sql: string;
  mode: ExecMode;
  /** Character offsets in `sql`. */
  cursor: number;
  selStart: number;
  selEnd: number;
  maxRows: number;
  /** Max. result sets kept open (default 20). Older cursors get closed. */
  maxResults: number;
  /** Seconds, 0 = no timeout. */
  timeout: number;
}
export interface FetchMsg { type: 'fetch'; tabId: string; resultId: string; offset: number; count: number }
export interface CancelMsg { type: 'cancel'; tabId: string }
export interface CommitMsg { type: 'commit'; tabId: string }
export interface RollbackMsg { type: 'rollback'; tabId: string }
export interface DisconnectMsg { type: 'disconnect'; tabId: string }
/** Format works without a connection. */
export interface FormatMsg { type: 'format'; tabId: string; reqId: string; sql: string }
/** Keep-alive, every 30 s. No tabId. */
export interface PingMsg { type: 'ping' }
/** First message on each socket: the browser tab (window) id. The socket then gets only that window's messages. */
export interface HelloMsg { type: 'hello'; win: string }
/** Ctrl+Space. cursor = char offset in sql (the whole editor text). */
export interface CompleteMsg { type: 'complete'; tabId: string; reqId: string; sql: string; cursor: number }

// ---- v3: DB Explorer metadata ----
export type MetaWhat = 'schemas' | 'tableTypes' | 'objects' | 'procedures' | 'triggers' | 'params' | 'search'
  | 'columns' | 'indexes' | 'pk' | 'source';
export interface MetaMsg {
  type: 'meta'; tabId: string; reqId: string; what: MetaWhat;
  schema?: string; name?: string;
  /** objects: none or ["*"] = all types. source: the object type. */
  types?: string[];
  /** source: object type (TABLE, VIEW, PROCEDURE, ...). */
  objectType?: string;
  /** search: text to find (LIKE, case-insensitive; no % = anywhere) and the row limit per table. */
  value?: string; maxRows?: number;
}
/** table, event, timing: triggers only. */
export interface DbObject { name: string; type: string; remarks?: string; status?: string; table?: string; event?: string; timing?: string }
/** object: the routine; for a package, one of its routines. */
export interface DbParam { object: string; name: string | null; position: number; mode: string; type: string | null }
export interface DbSearchHit { columns: string[]; rows: (string | null)[][] }
export interface DbColumn {
  name: string; type: string; size?: number; digits?: number; nullable: boolean;
  default?: string | null; remarks?: string | null; position: number;
}
export interface DbIndexCol { name: string; unique: boolean; column: string; position: number }

// ---- v3: editable grid ----
export type RowChange =
  | { op: 'update'; key: Record<string, unknown>; values: Record<string, unknown> }
  | { op: 'insert'; values: Record<string, unknown> }
  | { op: 'delete'; key: Record<string, unknown> };
export interface SaveChangesMsg { type: 'saveChanges'; tabId: string; reqId: string; table: string; changes: RowChange[] }

// ---- v3: load run ----
export interface LoadStartMsg {
  type: 'loadStart'; tabId: string; reqId: string; sessions: number; seconds: number; ratePerSec: number; sql: string;
  profile: { url: string; user: string; password: string; autocommit: boolean };
}
export interface LoadStopMsg { type: 'loadStop'; tabId: string }

export type ClientMsg =
  | ConnectMsg | ExecuteMsg | FetchMsg | CancelMsg | CommitMsg
  | RollbackMsg | DisconnectMsg | FormatMsg | PingMsg | HelloMsg | CompleteMsg
  | MetaMsg | SaveChangesMsg | LoadStartMsg | LoadStopMsg;

// ---- Server -> client ----
export interface ConnectedMsg { type: 'connected'; tabId: string; info: ConnectionInfo }
export interface DisconnectedMsg { type: 'disconnected'; tabId: string }
export interface ErrorMsg { type: 'error'; tabId: string; reqId?: string; message: string }
/** start = char offset of the statement in the editor text. */
export interface StmtStartMsg { type: 'stmtStart'; tabId: string; reqId: string; index: number; sql: string; start?: number }
export interface ResultMetaMsg {
  type: 'resultMeta'; tabId: string; reqId: string; resultId: string; sql: string; columns: ColumnInfo[];
}
/** First page (500 rows) comes unasked. More rows come via `fetch`. */
export interface RowsMsg {
  type: 'rows'; tabId: string; resultId: string; offset: number; rows: unknown[][]; done: boolean;
  /** -1 while unknown, else the final row count. */
  total?: number;
}
export interface UpdateCountMsg { type: 'updateCount'; tabId: string; reqId: string; count: number }
export interface MessageMsg {
  type: 'message'; tabId: string; reqId: string; level: 'info' | 'warn' | 'error'; text: string;
}
export interface StmtEndMsg {
  type: 'stmtEnd'; tabId: string; reqId: string; index: number; ms: number; error?: boolean;
  execMs?: number; fetchMs?: number;
  /** Rows returned or affected. */
  rows?: number;
}
/** Server closed an old cursor (more than maxResults). Keep the rows already here. */
export interface ResultClosedMsg { type: 'resultClosed'; tabId: string; resultId: string }
export interface ExecEndMsg { type: 'execEnd'; tabId: string; reqId: string; ms: number; ok: boolean }
export interface FormattedMsg { type: 'formatted'; tabId: string; reqId: string; sql: string }
export interface PongMsg { type: 'pong'; tabId?: undefined }
/** items: string[] (schemas, pk), DbObject[], DbColumn[], DbIndexCol[] or string (source). */
export interface MetaResultMsg { type: 'metaResult'; tabId: string; reqId: string; what: MetaWhat; items: unknown }
export interface SavedMsg { type: 'saved'; tabId?: string; reqId: string; count: number }
export interface LoadStats {
  elapsedMs: number; count: number; errors: number; rps: number;
  p50: number; p95: number; p99: number; max: number; lastError?: string;
}
export interface LoadStatsMsg extends LoadStats { type: 'loadStats'; tabId?: string; reqId: string }
export interface LoadEndMsg extends LoadStats { type: 'loadEnd'; tabId?: string; reqId: string; sessions: number }

export type CompletionKind = 'table' | 'view' | 'column' | 'keyword' | 'param' | 'value' | 'other';
export interface CompletionItem { label: string; insert: string; kind: CompletionKind; detail?: string }
export interface CompletionMsg { type: 'completion'; tabId: string; reqId: string; title?: string; items: CompletionItem[]; error?: string }
/** A DML ran since the last commit or rollback (open = true), or the transaction ended. */
export interface TxStateMsg { type: 'txState'; tabId: string; open: boolean }

export type ServerMsg =
  | ConnectedMsg | DisconnectedMsg | ErrorMsg | StmtStartMsg | ResultMetaMsg
  | RowsMsg | UpdateCountMsg | MessageMsg | StmtEndMsg | ExecEndMsg | FormattedMsg | PongMsg | ResultClosedMsg
  | MetaResultMsg | SavedMsg | LoadStatsMsg | LoadEndMsg | CompletionMsg | TxStateMsg;

/** Each WS frame is a JSON array of messages (batched by the server every 25 ms). */
export type ServerFrame = ServerMsg[] | ServerMsg;

/** WS close code: no session. Call /api/session again, then reconnect. */
export const WS_CLOSE_NO_SESSION = 4401;
export const PING_INTERVAL_MS = 30_000;

export const FIRST_PAGE_ROWS = 500;
