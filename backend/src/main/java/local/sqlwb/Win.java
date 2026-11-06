package local.sqlwb;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.websocket.WsContext;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * One browser tab (window) of a session: its statement tabs, their DB connections and its WebSocket.
 * Each window has its own connections and gets only its own messages, so two browser tabs do not mix results.
 * The connections stay open when the WebSocket drops, so a page reload does not lose them.
 */
final class Win {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final int MAX_BUFFER = 2000;

  final String id;
  final Session session;
  private final StringBuilder pending = new StringBuilder();
  private int pendingCount;
  private final Map<String, TabConn> tabs = new ConcurrentHashMap<>();
  private final Map<String, LoadRun> loads = new ConcurrentHashMap<>();
  private final Deque<String> buffer = new ArrayDeque<>();
  private WsContext ws;
  private volatile long detachedSince = System.currentTimeMillis();

  Win(String id, Session session) {
    this.id = id;
    this.session = session;
  }

  synchronized void attach(WsContext ctx) {
    ws = ctx;
    detachedSince = 0;
    while (!buffer.isEmpty()) {
      ctx.send(buffer.poll());
    }
  }

  synchronized void detach(WsContext ctx) {
    if (ws == ctx) {
      ws = null;
      detachedSince = System.currentTimeMillis();
    }
  }

  long detachedSince() {
    return detachedSince;
  }

  void handle(JsonNode m) {
    String tabId = m.path("tabId").asText();
    String type = m.path("type").asText();
    switch (type) {
      case "connect" -> tab(tabId).connect(m.path("profile"));
      case "disconnect" -> {
        TabConn t = tabs.remove(tabId);
        if (t != null) t.close();
      }
      case "execute" -> tab(tabId).execute(m);
      case "fetch" -> tab(tabId).fetch(m.path("resultId").asText(), m.path("count").asInt(TabConn.PAGE));
      case "cancel" -> tab(tabId).cancel();
      case "commit" -> tab(tabId).endTransaction(true);
      case "rollback" -> tab(tabId).endTransaction(false);
      case "format" -> tab(tabId).format(m.path("reqId").asText(), m.path("sql").asText());
      case "complete" -> tab(tabId).complete(m);
      case "meta" -> tab(tabId).meta(m);
      case "saveChanges" -> tab(tabId).saveChanges(m);
      case "loadStart" -> startLoad(tabId, m);
      case "loadStop" -> {
        LoadRun r = loads.remove(tabId);
        if (r != null) r.stop();
      }
      case "ping" -> send(Map.of("type", "pong"));
      default -> send(Map.of("type", "error", "tabId", tabId, "message", "Unknown message type " + type));
    }
  }

  /** Returns the tab, or a new tab without a connection that answers "Not connected". */
  private TabConn tab(String tabId) {
    return tabs.computeIfAbsent(tabId, t -> new TabConn(t, this));
  }

  void send(Map<String, Object> msg) {
    String text;
    try {
      text = JSON.writeValueAsString(msg);
    } catch (Exception e) {
      text = "{\"type\":\"error\",\"message\":\"Cannot encode a server message\"}";
    }
    synchronized (this) {
      pending.append(pendingCount == 0 ? "[" : ",").append(text);
      pendingCount++;
      if (pending.length() > 512 * 1024) {
        flush();
      }
    }
  }

  /** Sends queued messages as one JSON array frame (called every 25 ms and when the queue is large). */
  synchronized void flush() {
    if (pendingCount == 0) {
      return;
    }
    String frame = pending.append(']').toString();
    pending.setLength(0);
    pendingCount = 0;
    if (ws != null && ws.session.isOpen()) {
      ws.send(frame);
    } else if (buffer.size() < MAX_BUFFER) {
      buffer.add(frame);
    }
  }

  private void startLoad(String tabId, JsonNode m) {
    LoadRun run = new LoadRun();
    if (loads.putIfAbsent(tabId, run) != null) {
      send(Map.of("type", "error", "tabId", tabId, "message", "A load run is already active in this tab"));
      return;
    }
    String reqId = m.path("reqId").asText();
    Thread.ofVirtual().name("load-" + tabId).start(() -> {
      try {
        run.run(m, s -> {
          s.put("tabId", tabId);
          s.put("reqId", reqId);
          send(s);
        });
      } finally {
        loads.remove(tabId);
      }
    });
  }

  /** Tabs with an open DB connection and their DB info. */
  Map<String, Object> liveTabs() {
    Map<String, Object> m = new java.util.LinkedHashMap<>();
    tabs.forEach((id, t) -> {
      Map<String, Object> i = t.info;
      if (i != null) m.put(id, i);
    });
    return m;
  }

  void closeAll() {
    loads.values().forEach(LoadRun::stop);
    tabs.values().forEach(TabConn::close);
    tabs.clear();
  }
}
