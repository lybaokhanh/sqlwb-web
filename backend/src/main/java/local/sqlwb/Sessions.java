package local.sqlwb;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.javalin.Javalin;
import io.javalin.http.Context;
import io.javalin.http.HttpStatus;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Browser sessions (cookie), login, workspace, update and the WebSocket endpoint.
 */
final class Sessions {
  static final String COOKIE = "sqlwb_sid";
  static final String VER_HEADER = "X-Workspace-Version";
  private volatile long lastPurge;
  private static final long IDLE_MS = TimeUnit.MINUTES.toMillis(15);
  /** App login lifetime. Renewed while the user works (sliding). */
  static final long TTL_MS = TimeUnit.DAYS.toMillis(30);
  private static final long TOUCH_MS = TimeUnit.HOURS.toMillis(1);
  private static final SecureRandom RND = new SecureRandom();
  private static final ObjectMapper JSON = new ObjectMapper();

  private final Map<String, Session> byId = new ConcurrentHashMap<>();
  private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(r -> {
    Thread t = new Thread(r, "sessions-timer");
    t.setDaemon(true);
    return t;
  });
  private final Store store;
  private final Updater updater;
  private final Set<String> admins;

  Sessions(Store store, Updater updater, Set<String> admins) {
    this.store = store;
    this.updater = updater;
    this.admins = admins;
  }

  void register(Javalin app) {
    app.get("/api/session", ctx -> {
      Session s = sessionOf(ctx);
      if (s.user != null && System.currentTimeMillis() - s.touched > TOUCH_MS) {
        s.touched = System.currentTimeMillis();
        store.touchSession(s.id, s.touched + TTL_MS);
        setCookie(ctx, s.id);
      }
      ctx.json(Map.of("user", s.user == null ? "" : s.user, "admin", isAdmin(s)));
    });

    app.post("/api/login", ctx -> {
      JsonNode b = JSON.readTree(ctx.body());
      String name = b.path("name").asText("").trim().toLowerCase();
      String pw = b.path("password").asText("");
      if (!name.matches("[a-z0-9._-]{2,40}") || pw.length() < 4) {
        ctx.status(HttpStatus.BAD_REQUEST).json(Map.of("error", "Name: 2-40 chars a-z 0-9 . _ -; password: min 4 chars"));
        return;
      }
      String ip = ctx.ip();
      if (Policy.locked("u:" + name) || Policy.locked("ip:" + ip)) {
        ctx.status(HttpStatus.TOO_MANY_REQUESTS).json(Map.of("error", "Too many failed logins. Wait one minute"));
        return;
      }
      if (!store.login(name, pw)) {
        Policy.failed("u:" + name);
        Policy.failed("ip:" + ip);
        ctx.status(HttpStatus.UNAUTHORIZED).json(Map.of("error", Policy.SIGNUP ? "Wrong password" : "Wrong name or password"));
        return;
      }
      Policy.succeeded("u:" + name);
      Policy.succeeded("ip:" + ip);
      Session s = sessionOf(ctx);
      s.user = name;
      s.profileKey = Store.profileKey(name, pw);
      s.touched = System.currentTimeMillis();
      store.saveSession(s.id, name, s.profileKey, s.touched + TTL_MS);
      setCookie(ctx, s.id);
      ctx.json(Map.of("user", name, "admin", isAdmin(s)));
    });

    app.post("/api/logout", ctx -> {
      Session s = existing(ctx);
      if (s != null) {
        s.closeAll();
        byId.remove(s.id);
        store.deleteSession(s.id);
      }
      ctx.res().addHeader("Set-Cookie", COOKIE + "=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict");
      ctx.json(Map.of("ok", true));
    });

    app.get("/api/workspace", ctx -> {
      Session s = requireUser(ctx);
      if (s == null) return;
      Store.Workspace w = store.loadWorkspace(s.user);
      ctx.header(VER_HEADER, String.valueOf(w == null ? 0 : w.ver()));
      ctx.contentType("application/json").result(w == null ? "{}" : w.json());
    });

    app.put("/api/workspace", ctx -> {
      Session s = requireUser(ctx);
      if (s == null) return;
      if (ctx.body().length() > 20_000_000) {
        ctx.status(HttpStatus.CONTENT_TOO_LARGE).json(Map.of("error", "Workspace larger than 20 MB"));
        return;
      }
      JsonNode ws = JSON.readTree(ctx.body());
      stripPasswords(ws);
      String h = ctx.header(VER_HEADER);
      long expect = h == null || h.isBlank() ? -1 : Long.parseLong(h.trim());
      long ver = store.saveWorkspace(s.user, JSON.writeValueAsString(ws), expect);
      if (ver < 0) {
        Store.Workspace cur = store.loadWorkspace(s.user);
        ctx.status(HttpStatus.CONFLICT).json(Map.of("error", "Saved from another browser tab", "version", cur == null ? 0 : cur.ver()));
        return;
      }
      ctx.json(Map.of("ok", true, "version", ver));
    });

    app.get("/api/profiles", ctx -> {
      Session s = requireKey(ctx);
      if (s == null) return;
      String json = store.loadProfiles(s.user);
      JsonNode root = JSON.readTree(json == null ? "{\"profiles\":[],\"groups\":[]}" : json);
      for (JsonNode p : root.path("profiles")) {
        if (p instanceof ObjectNode o && o.has("passwordEnc")) {
          String plain = Store.decrypt(s.profileKey, o.path("passwordEnc").asText());
          o.remove("passwordEnc");
          o.put("password", plain == null ? "" : plain);
          if (plain == null) o.put("passwordLost", true);
        }
      }
      ctx.json(root);
    });

    app.put("/api/profiles", ctx -> {
      Session s = requireKey(ctx);
      if (s == null) return;
      JsonNode root = JSON.readTree(ctx.body());
      for (JsonNode p : root.path("profiles")) {
        if (p instanceof ObjectNode o) {
          String pw = o.path("password").asText("");
          o.remove("password");
          o.remove("passwordEnc");
          o.remove("passwordLost");
          if (o.path("savePassword").asBoolean(false) && !pw.isEmpty()) {
            o.put("passwordEnc", Store.encrypt(s.profileKey, pw));
          }
        }
      }
      store.saveProfiles(s.user, JSON.writeValueAsString(root));
      ctx.json(Map.of("ok", true));
    });

    // Body: the content of WbProfiles.xml (or WbProfiles.properties with ?format=ini). Nothing is saved here:
    // the client merges the result into its list and saves it with PUT /api/profiles.
    app.post("/api/profiles/import", ctx -> {
      Session s = requireUser(ctx);
      if (s == null) return;
      if (ctx.body().length() > 10_000_000) {
        ctx.status(HttpStatus.CONTENT_TOO_LARGE).json(Map.of("error", "File larger than 10 MB"));
        return;
      }
      try {
        ctx.json(Map.of("profiles", ProfileImport.read(ctx.body(), "ini".equals(ctx.queryParam("format")))));
      } catch (Exception e) {
        ctx.status(HttpStatus.BAD_REQUEST).json(Map.of("error", "Cannot read the file: " + e.getMessage()));
      }
    });

    // Tabs whose DB connection is still open (kept 15 min without a WebSocket): a reloaded page re-uses them.
    app.get("/api/tabs", ctx -> {
      Session s = requireUser(ctx);
      if (s == null) return;
      Win w = s.findWin(ctx.queryParam("win"));
      ctx.json(w == null ? Map.of() : w.liveTabs());
    });

    // File area of the user (WbExport output, WbImport input). ?name= is relative to the user folder.
    app.get("/api/files", ctx -> {
      Session s = requireUser(ctx);
      if (s == null) return;
      ctx.json(Map.of("files", UserFiles.list(s.user)));
    });

    app.get("/api/files/content", ctx -> {
      Session s = requireUser(ctx);
      if (s == null) return;
      java.nio.file.Path p = fileOf(ctx, s);
      if (p == null) return;
      if (!java.nio.file.Files.isRegularFile(p)) {
        ctx.status(HttpStatus.NOT_FOUND).json(Map.of("error", "No such file"));
        return;
      }
      String fn = p.getFileName().toString().replaceAll("[^\\w.\\-]", "_");
      ctx.header("Content-Disposition", "attachment; filename=\"" + fn + "\"");
      ctx.contentType("application/octet-stream");
      ctx.result(java.nio.file.Files.newInputStream(p));
    });

    app.put("/api/files/content", ctx -> {
      Session s = requireUser(ctx);
      if (s == null) return;
      java.nio.file.Path p = fileOf(ctx, s);
      if (p == null) return;
      byte[] body = ctx.bodyAsBytes();
      if (body.length > UserFiles.MAX_UPLOAD) {
        ctx.status(HttpStatus.CONTENT_TOO_LARGE).json(Map.of("error", "File larger than 20 MB"));
        return;
      }
      java.nio.file.Files.createDirectories(p.getParent());
      java.nio.file.Files.write(p, body);
      ctx.json(Map.of("ok", true, "size", body.length));
    });

    app.delete("/api/files/content", ctx -> {
      Session s = requireUser(ctx);
      if (s == null) return;
      java.nio.file.Path p = fileOf(ctx, s);
      if (p == null) return;
      ctx.json(Map.of("ok", java.nio.file.Files.deleteIfExists(p)));
    });

    app.post("/api/test-connection", ctx -> {
      Session s = requireUser(ctx);
      if (s == null) return;
      ctx.json(TabConn.test(JSON.readTree(ctx.body())));
    });

    app.get("/api/update", ctx -> ctx.json(updater.check("1".equals(ctx.queryParam("force")))));

    app.post("/api/update", ctx -> {
      Session s = requireUser(ctx);
      if (s == null) return;
      if (!isAdmin(s)) {
        ctx.status(HttpStatus.FORBIDDEN).json(Map.of("error", "Only admins (ADMIN_USERS) can update"));
        return;
      }
      String build = JSON.readTree(ctx.body()).path("build").asText();
      String msg = updater.install(build);
      ctx.json(Map.of("message", msg, "activeSessions", byId.size()));
      // Exit after the answer is sent; Docker restarts the container with the new jar
      timer.schedule(() -> System.exit(0), 1, TimeUnit.SECONDS);
    });

    app.ws("/ws", ws -> {
      ws.onConnect(ctx -> {
        ctx.session.setIdleTimeout(Duration.ofMinutes(10));
        Session s = find(ctx.cookie(COOKIE));
        if (s == null || s.user == null) {
          ctx.closeSession(4401, "Login first");
          return;
        }
        ctx.attribute("s", s);
      });
      ws.onMessage(ctx -> {
        Session s = ctx.attribute("s");
        if (s == null) return;
        JsonNode m = JSON.readTree(ctx.message());
        Win w = ctx.attribute("w");
        if ("hello".equals(m.path("type").asText())) {
          // First message of a browser tab: its window id. From now on this socket gets only the messages of that window.
          if (w != null) w.detach(ctx);
          w = s.win(m.path("win").asText(null));
          ctx.attribute("w", w);
          w.attach(ctx);
          return;
        }
        if (w == null) {
          // Old client without "hello"
          w = s.win(Session.DEFAULT_WIN);
          ctx.attribute("w", w);
          w.attach(ctx);
        }
        w.handle(m);
      });
      ws.onClose(ctx -> {
        Win w = ctx.attribute("w");
        if (w != null) w.detach(ctx);
      });
      ws.onError(ctx -> {
        Win w = ctx.attribute("w");
        if (w != null) w.detach(ctx);
      });
    });

    timer.scheduleAtFixedRate(this::reap, 1, 1, TimeUnit.MINUTES);
    timer.scheduleAtFixedRate(() -> byId.values().forEach(Session::flush), 25, 25, TimeUnit.MILLISECONDS);
  }

  /** The file of ?name= in the user folder; answers 400 and returns null for a bad name. */
  private static java.nio.file.Path fileOf(Context ctx, Session s) {
    try {
      return UserFiles.resolve(s.user, ctx.queryParam("name"));
    } catch (java.io.IOException e) {
      ctx.status(HttpStatus.BAD_REQUEST).json(Map.of("error", e.getMessage()));
      return null;
    }
  }

  private boolean isAdmin(Session s) {
    return s.user != null && admins.contains(s.user);
  }

  private Session existing(Context ctx) {
    return find(ctx.cookie(COOKIE));
  }

  /** Session from memory, or rebuilt from the store (after a restart or the idle cleanup). */
  private Session find(String sid) {
    if (sid == null || sid.isEmpty()) return null;
    Session s = byId.get(sid);
    if (s != null) return s;
    try {
      Store.SessionRow row = store.loadSession(sid);
      if (row == null) return null;
      Session n = new Session(sid);
      n.user = row.name();
      n.profileKey = row.profileKey();
      n.touched = row.expires() - TTL_MS;
      Session prev = byId.putIfAbsent(sid, n);
      return prev != null ? prev : n;
    } catch (Exception e) {
      return null;
    }
  }

  private static void setCookie(Context ctx, String sid) {
    ctx.res().addHeader("Set-Cookie", COOKIE + "=" + sid + "; Path=/; Max-Age=" + TTL_MS / 1000 + "; HttpOnly; SameSite=Strict");
  }

  private Session requireUser(Context ctx) {
    Session s = existing(ctx);
    if (s == null || s.user == null) {
      ctx.status(HttpStatus.UNAUTHORIZED).json(Map.of("error", "Login first"));
      return null;
    }
    return s;
  }

  /** Like requireUser, and the session must hold the password key (lost after a server restart: log in again). */
  private Session requireKey(Context ctx) {
    Session s = requireUser(ctx);
    if (s != null && s.profileKey == null) {
      ctx.status(HttpStatus.UNAUTHORIZED).json(Map.of("error", "Log in again to read saved profiles"));
      return null;
    }
    return s;
  }

  private Session sessionOf(Context ctx) {
    Session s = existing(ctx);
    if (s != null) return s;
    byte[] b = new byte[24];
    RND.nextBytes(b);
    String sid = Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    s = new Session(sid);
    byId.put(sid, s);
    setCookie(ctx, sid);
    return s;
  }

  /** Removes every "password" field, so DB passwords never reach the disk. */
  static void stripPasswords(JsonNode n) {
    if (n instanceof ObjectNode o) {
      o.remove("password");
      for (Iterator<JsonNode> it = o.elements(); it.hasNext(); ) stripPasswords(it.next());
    } else if (n != null && n.isArray()) {
      n.forEach(Sessions::stripPasswords);
    }
  }

  /**
   * Closes the DB connections of windows without a WebSocket for 15 minutes. Drops sessions without a window from memory.
   * The app login stays: the next request rebuilds the session from the store.
   */
  private void reap() {
    long now = System.currentTimeMillis();
    if (now - lastPurge > TOUCH_MS) {
      lastPurge = now;
      try {
        store.purgeSessions();
      } catch (Exception ignored) {
        // retried next hour
      }
    }
    byId.values().removeIf(s -> s.reap(now, IDLE_MS));
  }
}
