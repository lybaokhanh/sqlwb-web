package local.sqlwb;

import com.fasterxml.jackson.databind.JsonNode;
import workbench.sql.parser.ParserType;

import java.sql.Blob;
import java.sql.Clob;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.SQLWarning;
import java.sql.Statement;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

/**
 * One statement tab: one JDBC connection and one worker thread, as "separate connection per tab" in the desktop app.
 */
final class TabConn {
  static final int PAGE = 500;
  private static final AtomicInteger RESULT_SEQ = new AtomicInteger();
  private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
  private static final int MAX_LOB_CHARS = 32_768;

  private final String tabId;
  private final Win session;
  private final ExecutorService worker;
  private final Map<String, Cursor> cursors = new LinkedHashMap<>();
  private final Map<String, String> vars = new java.util.concurrent.ConcurrentHashMap<>();
  private volatile Connection con;
  private volatile Statement running;
  private String url;
  private ParserType parserType = ParserType.Standard;
  private int fetchSize = PAGE;
  /** Jar side of the tab (Wb commands, completion). Null when not connected or when it failed to start. */
  private volatile WbBridge bridge;
  /** Profile options of the open connection (ignoreDropErrors, hideWarnings, ...). */
  private JsonNode opts = com.fasterxml.jackson.databind.node.MissingNode.getInstance();
  private workbench.sql.DelimiterDefinition altDelimiter;
  /** A DML ran since the last commit or rollback (for "Check uncommitted"). */
  private volatile boolean txOpen;

  TabConn(String tabId, Win session) {
    this.tabId = tabId;
    this.session = session;
    this.worker = Executors.newSingleThreadExecutor(Thread.ofVirtual().name("tab-" + tabId).factory());

  }

  String url() {
    return url;
  }

  /** DB info of the open connection, null when not connected (for GET /api/tabs after a page reload). */
  volatile Map<String, Object> info;

  void connect(JsonNode p) {
    worker.execute(() -> {
      long t0 = System.nanoTime();
      try {
        closeQuietly();
        url = p.path("url").asText();
        Properties props = new Properties();
        props.setProperty("user", p.path("user").asText());
        props.setProperty("password", p.path("password").asText());
        // DBAs see the app name in v$session
        props.setProperty("v$session.program", "sqlwb-web");
        props.setProperty("ApplicationName", "sqlwb-web");
        if (p.path("sysdba").asBoolean(false)) props.setProperty("internal_logon", "sysdba");
        // Extended properties of the profile (name=value lines), as in the desktop dialog
        props.putAll(WbBridge.props(p.path("properties").asText("")));
        Policy.checkUrl(url);
        DriverManager.setLoginTimeout(15);
        con = DriverManager.getConnection(url, props);
        con.setAutoCommit(p.path("autocommit").asBoolean(false));
        fetchSize = p.path("fetchSize").asInt(PAGE) > 0 ? p.path("fetchSize").asInt(PAGE) : PAGE;
        parserType = SqlText.parserFor(url);
        opts = p;
        txOpen = false;
        String alt = p.path("altDelimiter").asText("").strip();
        altDelimiter = alt.isEmpty() ? null : new workbench.sql.DelimiterDefinition(alt);
        String schema = p.path("defaultSchema").asText("").strip();
        if (!schema.isEmpty()) setSchema(schema);
        WbBridge.props(p.path("variables").asText("")).forEach((k, v) -> vars.put((String) k, (String) v));
        try {
          bridge = new WbBridge("tab-" + tabId, con, WbBridge.profile(p.path("name").asText(), url, p), UserFiles.dir(session.session.user));
        } catch (Throwable e) {
          bridge = null;
          send("message", "level", "warn", "text", "Wb commands and completion are off for this tab: " + message(e));
        }
        DatabaseMetaData md = con.getMetaData();
        Map<String, Object> info = new LinkedHashMap<>();
        info.put("product", md.getDatabaseProductName());
        info.put("version", md.getDatabaseProductVersion());
        info.put("user", md.getUserName());
        info.put("schema", schemaOf(con));
        info.put("url", url);
        info.put("autocommit", con.getAutoCommit());
        info.put("ms", ms(t0));
        this.info = info;
        send("connected", "info", info);
        runConnectScript(p.path("connectScript").asText(""));
      } catch (Exception e) {
        con = null;
        send("error", "message", "Connect failed: " + message(e));
      }
    });
  }

  /** Default schema of the profile. Oracle: ALTER SESSION SET CURRENT_SCHEMA (what setSchema does in ojdbc). */
  private void setSchema(String schema) {
    try {
      con.setSchema(schema);
    } catch (Throwable e) {
      send("message", "level", "warn", "text", "Default schema " + schema + " not set: " + message(e));
    }
  }

  /** Runs the connect script of the profile, as the desktop app does after each connect. Messages go to the log only. */
  private void runConnectScript(String script) {
    if (script.isBlank()) return;
    long t0 = System.nanoTime();
    int n = 0;
    for (SqlText.Stmt st : SqlText.split(script, 0, parserType, altDelimiter)) {
      String sql = st.sql();
      try {
        String own = Vars.handleCommand(vars, sql);
        if (own != null) {
          send("message", "level", "info", "text", "Connect script: " + own);
        } else if (bridge != null && bridge.handles(sql)) {
          WbBridge.Result r = bridge.run(Vars.text(vars, sql));
          if (!r.messages().isEmpty()) send("message", "level", r.ok() ? "info" : "error", "text", "Connect script: " + r.messages());
          if (!r.ok()) break;
        } else {
          try (Statement s = con.createStatement()) {
            s.execute(Vars.text(vars, sql));
          }
        }
        n++;
      } catch (Exception e) {
        send("message", "level", "error", "text", "Connect script stopped: " + message(e) + "\n\n" + sql);
        break;
      }
    }
    send("message", "level", "info", "text", "Connect script: " + n + " statement(s) in " + ms(t0) + " ms");
  }

  private static Connection open(String url, Properties props) throws java.sql.SQLException {
    Policy.checkUrl(url);
    return DriverManager.getConnection(url, props);
  }

  /** "Test" button of the connection dialog: connect, read the DB info, close. */
  static java.util.Map<String, Object> test(JsonNode p) {
    long t0 = System.nanoTime();
    java.util.Map<String, Object> r = new LinkedHashMap<>();
    Properties props = new Properties();
    props.setProperty("user", p.path("user").asText());
    props.setProperty("password", p.path("password").asText());
    props.setProperty("v$session.program", "sqlwb-web-test");
    if (p.path("sysdba").asBoolean(false)) props.setProperty("internal_logon", "sysdba");
    DriverManager.setLoginTimeout(15);
    try (Connection c = open(p.path("url").asText(), props)) {
      DatabaseMetaData md = c.getMetaData();
      r.put("ok", true);
      r.put("product", md.getDatabaseProductName());
      r.put("version", md.getDatabaseProductVersion());
      r.put("user", md.getUserName());
    } catch (Exception e) {
      r.put("ok", false);
      r.put("error", message(e));
    }
    r.put("ms", ms(t0));
    return r;
  }

  void execute(JsonNode m) {
    String reqId = m.path("reqId").asText();
    worker.execute(() -> runScript(reqId, m));
  }

  /** Sends the next rows of a result. The client sends its row count as offset; rows continue after the last sent row. */
  void fetch(String resultId, int count) {
    worker.execute(() -> {
      Cursor c = cursors.get(resultId);
      if (c == null) {
        send("error", "message", "Result " + resultId + " is closed");
        return;
      }
      try {
        sendRows(c, Math.min(count, 5000));
      } catch (SQLException e) {
        send("error", "message", message(e));
      }
    });
  }

  void cancel() {
    WbBridge b = bridge;
    if (b != null && wbRunning) b.cancel();
    Statement s = running;
    if (s != null) {
      try {
        s.cancel();
      } catch (SQLException e) {
        send("message", "level", "warn", "text", "Cancel failed: " + message(e));
      }
    }
  }

  void endTransaction(boolean commit) {
    worker.execute(() -> {
      try {
        requireCon();
        if (commit) {
          con.commit();
        } else {
          con.rollback();
        }
        setTx(false);
        send("message", "level", "info", "text", commit ? "COMMIT done" : "ROLLBACK done");
      } catch (SQLException e) {
        send("error", "message", message(e));
      }
    });
  }

  void format(String reqId, String sql) {
    worker.execute(() -> {
      try {
        send("formatted", "reqId", reqId, "sql", SqlText.format(sql, SqlText.dbId(url)));
      } catch (Exception e) {
        send("error", "reqId", reqId, "message", "Format failed: " + message(e));
      }
    });
  }

  /** Closes the connection; the worker thread stops after pending work. */
  void close() {
    cancel();
    worker.execute(this::closeQuietly);
    worker.shutdown();
  }

  /** Ctrl+Space: the completion list of the jar for the statement at the cursor. */
  void complete(JsonNode m) {
    String reqId = m.path("reqId").asText();
    worker.execute(() -> {
      try {
        WbBridge b = bridge;
        if (con == null || b == null) {
          send("completion", "reqId", reqId, "items", List.of());
          return;
        }
        String text = m.path("sql").asText();
        int cursor = Math.max(0, Math.min(m.path("cursor").asInt(), text.length()));
        SqlText.Stmt st = SqlText.at(text, cursor, parserType, altDelimiter);
        Map<String, Object> r = st == null ? Map.of("items", List.of()) : b.complete(st.sql(), cursor - st.start());
        send("completion", "reqId", reqId, "title", r.getOrDefault("title", ""), "items", r.get("items"));
      } catch (Throwable e) {
        send("completion", "reqId", reqId, "items", List.of(), "error", message(e));
      }
    });
  }

  void meta(JsonNode m) {
    String reqId = m.path("reqId").asText();
    worker.execute(() -> {
      try {
        requireCon();
        Object items = Meta.read(con, url, m);
        if ("schemas".equals(m.path("what").asText())) {
          items = hide(items, opts.path("schemaFilter").asText(""));
        }
        send("metaResult", "reqId", reqId, "what", m.path("what").asText(), "items", items);
      } catch (Exception e) {
        send("error", "reqId", reqId, "message", message(e));
      }
    });
  }

  void saveChanges(JsonNode m) {
    String reqId = m.path("reqId").asText();
    worker.execute(() -> {
      try {
        requireCon();
        int n = Meta.save(con, m, opts.path("emptyStringIsNull").asBoolean(false));
        send("saved", "reqId", reqId, "count", n);
        send("message", "reqId", reqId, "level", "info", "text", n + " row(s) saved");
      } catch (Exception e) {
        send("error", "reqId", reqId, "message", "Save failed, nothing changed: " + message(e));
      }
    });
  }

  // ---------------------------------------------------------------- execution
  private void runScript(String reqId, JsonNode m) {
    long t0 = System.nanoTime();
    double parseMs = 0;
    boolean ok = true;
    try {
      requireCon();
      closeCursors();
      String mode = m.path("mode").asText("current");
      String text = m.path("sql").asText();
      int maxResults = m.path("maxResults").asInt(20) > 0 ? m.path("maxResults").asInt(20) : 20;
      int maxRows = m.path("maxRows").asInt(0);
      int timeout = m.path("timeout").asInt(0);
      var queue = new java.util.concurrent.LinkedBlockingQueue<java.util.Optional<SqlText.Stmt>>();
      var stopParse = new java.util.concurrent.atomic.AtomicBoolean();
      var parseNanos = new java.util.concurrent.atomic.AtomicLong();
      int selStart = m.path("selStart").asInt();
      int selEnd = m.path("selEnd").asInt();
      if ("current".equals(mode) || ("selected".equals(mode) && selEnd <= selStart)) {
        long tp = System.nanoTime();
        SqlText.pick(text, "current", m.path("cursor").asInt(), 0, 0, parserType, altDelimiter).forEach(s -> queue.add(java.util.Optional.of(s)));
        parseNanos.set(System.nanoTime() - tp);
        queue.add(java.util.Optional.empty());
      } else {
        // Pipeline: parse in a second thread while the first statements already run
        boolean sel = "selected".equals(mode);
        String part = sel ? text.substring(selStart, selEnd) : text;
        int off = sel ? selStart : 0;
        Thread.ofVirtual().name("parse-" + tabId).start(() -> {
          long tp = System.nanoTime();
          try {
            SqlText.stream(part, off, parserType, altDelimiter, s -> {
              queue.add(java.util.Optional.of(s));
              return !stopParse.get();
            });
          } finally {
            parseNanos.set(System.nanoTime() - tp);
            queue.add(java.util.Optional.empty());
          }
        });
      }
      int i = 0;
      for (java.util.Optional<SqlText.Stmt> next = queue.take(); next.isPresent(); next = queue.take()) {
        if (!runOne(reqId, i++, next.get(), maxRows, timeout)) {
          ok = false;
          stopParse.set(true);
          break;
        }
        limitCursors(maxResults);
      }
      if (i == 0) {
        send("message", "reqId", reqId, "level", "warn", "text", "No statement to run");
      }
      parseMs = Math.round(parseNanos.get() / 1000.0) / 1000.0;    } catch (Exception e) {
      ok = false;
      send("error", "reqId", reqId, "message", message(e));
    }
    send("execEnd", "reqId", reqId, "ms", msd(t0), "parseMs", parseMs, "ok", ok);
  }

  private boolean runOne(String reqId, int index, SqlText.Stmt st, int maxRows, int timeout) {
    long t0 = System.nanoTime();
    send("stmtStart", "reqId", reqId, "index", index, "sql", st.sql(), "start", st.start());
    String wbResult = Vars.handleCommand(vars, st.sql());
    if (wbResult != null) {
      send("message", "reqId", reqId, "level", "info", "text", wbResult);
      send("stmtEnd", "reqId", reqId, "index", index, "ms", ms(t0), "execMs", ms(t0), "fetchMs", 0, "rows", 0);
      return true;
    }
    WbBridge b = bridge;
    if (b != null && b.handles(st.sql())) {
      return runWb(reqId, index, st, b, t0);
    }
    String text = st.sql();
    if (opts.path("removeComments").asBoolean(false) && !text.contains("/*+") && !Vars.isPlsql(text)) {
      // Oracle hints (/*+ ... */) and PL/SQL keep their comments
      text = workbench.util.SqlUtil.makeCleanSql(text, true, false);
    }
    Vars.Prepared sql = Vars.prepare(vars, text);
    Statement s = null;
    boolean keepOpen = false;
    double execMs = 0;
    double fetchMs = 0;
    long rows = 0;
    try {
      if (sql.binds().isEmpty()) {
        s = con.createStatement();
      } else {
        PreparedStatement ps = con.prepareStatement(sql.sql());
        for (int i = 0; i < sql.binds().size(); i++) ps.setString(i + 1, sql.binds().get(i));
        s = ps;
      }
      s.setFetchSize(fetchSize);
      if (maxRows > 0) s.setMaxRows(maxRows);
      if (timeout > 0) s.setQueryTimeout(timeout);
      running = s;
      long te = System.nanoTime();
      boolean isRs = s instanceof PreparedStatement ps ? ps.execute() : s.execute(sql.sql());
      execMs = msd(te);
      int results = 0;
      while (true) {
        if (isRs) {
          long tf = System.nanoTime();
          ResultSet rs = s.getResultSet();
          Cursor c = new Cursor("r" + RESULT_SEQ.incrementAndGet(), s, rs);
          cursors.put(c.id, c);
          keepOpen = true;
          results++;
          send("resultMeta", "reqId", reqId, "resultId", c.id, "sql", st.sql(), "columns", c.columns);
          sendRows(c, PAGE);
          fetchMs = msd(tf);
          rows = c.sent;
        } else {
          int n = s.getUpdateCount();
          if (n < 0) break;
          rows += n;
          if (n > 0 && !con.getAutoCommit()) setTx(true);
          send("updateCount", "reqId", reqId, "count", n);
          send("message", "reqId", reqId, "level", "info", "text", n + " row(s) affected");
        }
        if (keepOpen) break; // keep the cursor open for paging; more results of a call are rare
        isRs = s.getMoreResults();
      }
      if (!opts.path("hideWarnings").asBoolean(false)) warnings(reqId, s.getWarnings());
      if (results == 0 && !keepOpen) {
        send("message", "reqId", reqId, "level", "info", "text", firstWord(st.sql()) + " executed successfully");
      }
      send("stmtEnd", "reqId", reqId, "index", index, "ms", ms(t0), "execMs", execMs, "fetchMs", fetchMs, "rows", rows);
      return true;
    } catch (SQLException e) {
      if (opts.path("ignoreDropErrors").asBoolean(false) && "drop".equalsIgnoreCase(firstWord(st.sql()))) {
        // "Ignore DROP errors" of the profile: a warning, the script goes on
        send("message", "reqId", reqId, "level", "warn", "text", "DROP error ignored: " + message(e));
        send("stmtEnd", "reqId", reqId, "index", index, "ms", ms(t0), "execMs", ms(t0), "fetchMs", 0, "rows", 0);
        return true;
      }
      send("message", "reqId", reqId, "level", "error", "text", message(e) + "\n\n" + st.sql());
      send("stmtEnd", "reqId", reqId, "index", index, "ms", ms(t0), "execMs", ms(t0), "fetchMs", 0, "rows", 0, "error", true);
      return false;
    } finally {
      running = null;
      if (!keepOpen && s != null) {
        try {
          s.close();
        } catch (SQLException ignored) {
          // closing is best effort
        }
      }
    }
  }

  private volatile boolean wbRunning;

  /** Runs a Wb command in the jar. Its result tables go to the grid as complete results (no paging). */
  private boolean runWb(String reqId, int index, SqlText.Stmt st, WbBridge b, long t0) {
    long rows = 0;
    try {
      wbRunning = true;
      WbBridge.Result r = b.run(Vars.text(vars, st.sql()));
      double execMs = msd(t0);
      for (workbench.storage.DataStore ds : r.data()) {
        String id = "r" + RESULT_SEQ.incrementAndGet();
        send("resultMeta", "reqId", reqId, "resultId", id, "sql", st.sql(), "columns", WbBridge.columns(ds));
        int cols = ds.getColumnCount();
        int types[] = new int[cols];
        for (int c = 0; c < cols; c++) types[c] = ds.getResultInfo().getColumnType(c);
        List<Object[]> page = new ArrayList<>();
        int n = ds.getRowCount();
        for (int i = 0; i < n; i++) {
          Object[] row = new Object[cols];
          for (int c = 0; c < cols; c++) row[c] = plain(ds.getValue(i, c));
          page.add(row);
          if (page.size() == 5000 || i == n - 1) {
            send("rows", "resultId", id, "offset", i + 1 - page.size(), "rows", page, "done", i == n - 1, "total", i == n - 1 ? n : -1);
            page = new ArrayList<>();
          }
        }
        if (n == 0) send("rows", "resultId", id, "offset", 0, "rows", page, "done", true, "total", 0);
        rows += n;
      }
      if (!r.messages().isEmpty()) {
        send("message", "reqId", reqId, "level", r.ok() ? "info" : "error", "text", r.messages());
      } else if (r.ok() && r.data().isEmpty()) {
        send("message", "reqId", reqId, "level", "info", "text", firstWord(st.sql()) + " executed successfully");
      }
      String verb = WbBridge.verb(st.sql());
      if (verb.equals("wbexport") || verb.equals("wbselectblob") || verb.equals("wbschemareport") || verb.equals("wbschemadiff")
          || verb.equals("wbdatadiff") || verb.equals("wbgeneratescript") || verb.equals("wbxslt")) {
        send("filesChanged");
      }
      send("stmtEnd", "reqId", reqId, "index", index, "ms", ms(t0), "execMs", execMs, "fetchMs", 0, "rows", rows,
          "error", !r.ok());
      return r.ok();
    } catch (Throwable e) {
      send("message", "reqId", reqId, "level", "error", "text", message(e) + "\n\n" + st.sql());
      send("stmtEnd", "reqId", reqId, "index", index, "ms", ms(t0), "execMs", ms(t0), "fetchMs", 0, "rows", 0, "error", true);
      return false;
    } finally {
      wbRunning = false;
    }
  }

  /** A jar value as JSON (same rules as the JDBC rows). */
  private static Object plain(Object o) {
    if (o == null || o instanceof String || o instanceof Boolean || o instanceof Integer || o instanceof Long) return o;
    if (o instanceof java.math.BigDecimal d) return d.precision() <= 15 ? d : d.toPlainString();
    if (o instanceof Number) return o;
    if (o instanceof java.util.Date d) return TS.format(new Timestamp(d.getTime()).toLocalDateTime());
    if (o instanceof java.time.temporal.TemporalAccessor t) return t.toString().replace('T', ' ');
    return o.toString();
  }

  private void setTx(boolean open) {
    if (txOpen != open) {
      txOpen = open;
      send("txState", "open", open);
    }
  }

  /** Removes the names that match one of the regex lines (profile schema filter). */
  private static Object hide(Object items, String lines) {
    if (lines.isBlank() || !(items instanceof List<?> list)) return items;
    List<Pattern> ps = new ArrayList<>();
    boolean include = false;
    for (String l : lines.split("\\R")) {
      if (l.strip().equalsIgnoreCase(WbBridge.INCLUDE)) {
        include = true;
      } else if (!l.isBlank()) {
        try {
          ps.add(Pattern.compile(l.strip(), Pattern.CASE_INSENSITIVE));
        } catch (Exception ignored) {
          // a bad line hides nothing
        }
      }
    }
    List<Object> out = new ArrayList<>();
    for (Object o : list) {
      String name = String.valueOf(o);
      boolean hit = ps.stream().anyMatch(p -> p.matcher(name).matches());
      if (hit == include) out.add(o);
    }
    return out;
  }

  /**
   * Reads the next count rows and sends them. The server keeps no sent rows (the client has them),
   * so the RAM of a big result stays at one page. Rows always continue at the row after the last sent one.
   */
  private void sendRows(Cursor c, int count) throws SQLException {
    List<Object[]> rows = new ArrayList<>(Math.min(count, PAGE));
    while (rows.size() < count && !c.done) {
      if (c.rs.next()) {
        rows.add(readRow(c));
      } else {
        c.done = true;
        c.closeRs();
      }
    }
    int from = c.sent;
    c.sent += rows.size();
    send("rows", "resultId", c.id, "offset", from, "rows", rows, "done", c.done, "total", c.done ? c.sent : -1);
  }

  private Object[] readRow(Cursor c) throws SQLException {
    Object[] row = new Object[c.types.length];
    boolean trim = opts.path("trimCharData").asBoolean(false);
    for (int i = 0; i < row.length; i++) {
      row[i] = value(c.rs, i + 1, c.types[i]);
      if (trim && row[i] instanceof String s && (c.types[i] == Types.CHAR || c.types[i] == Types.NCHAR)) row[i] = s.stripTrailing();
    }
    return row;
  }

  private static Object value(ResultSet rs, int col, int type) throws SQLException {
    switch (type) {
      case Types.DATE, Types.TIMESTAMP, Types.TIMESTAMP_WITH_TIMEZONE, -101, -102 -> {
        Timestamp ts = rs.getTimestamp(col);
        return ts == null ? null : TS.format(ts.toLocalDateTime());
      }
      case Types.CLOB, Types.NCLOB -> {
        Clob c = rs.getClob(col);
        if (c == null) return null;
        long len = c.length();
        return c.getSubString(1, (int) Math.min(len, MAX_LOB_CHARS)) + (len > MAX_LOB_CHARS ? " …" : "");
      }
      case Types.BLOB -> {
        Blob b = rs.getBlob(col);
        return b == null ? null : "(BLOB " + b.length() + " bytes)";
      }
      case Types.BINARY, Types.VARBINARY, Types.LONGVARBINARY -> {
        byte[] b = rs.getBytes(col);
        return b == null ? null : hex(b);
      }
      default -> {
        Object o = rs.getObject(col);
        if (o == null || o instanceof String || o instanceof Boolean || o instanceof Integer || o instanceof Long) {
          return o;
        }
        if (o instanceof java.math.BigDecimal d) {
          // JSON numbers lose precision above 15 digits: send those as text
          return d.precision() <= 15 ? d : d.toPlainString();
        }
        if (o instanceof Number) {
          return o;
        }
        return o.toString();
      }
    }
  }

  private void warnings(String reqId, SQLWarning w) {
    int n = 0;
    while (w != null && n++ < 50) {
      send("message", "reqId", reqId, "level", "warn", "text", w.getMessage());
      w = w.getNextWarning();
    }
  }

  // ---------------------------------------------------------------- helpers

  private void requireCon() throws SQLException {
    if (con == null) {
      throw new SQLException("Not connected");
    }
  }

  /** Keeps at most n open cursors (Oracle limits open cursors per session); the client keeps the rows it has. */
  private void limitCursors(int n) {
    var it = cursors.values().iterator();
    while (cursors.size() > n && it.hasNext()) {
      Cursor c = it.next();
      c.closeJdbc();
      it.remove();
      send("resultClosed", "resultId", c.id);
    }
  }

  private void closeCursors() {
    cursors.values().forEach(Cursor::closeJdbc);
    cursors.clear();
  }

  private void closeQuietly() {
    closeCursors();
    WbBridge b = bridge;
    bridge = null;
    if (b != null) b.dispose();
    if (con != null) {
      try {
        if (!con.getAutoCommit()) {
          con.rollback(); // as the desktop app with "Rollback before disconnect"
        }
        con.close();
      } catch (SQLException ignored) {
        // closing is best effort
      }
      info = null;
      con = null;
      send("disconnected");
    }
  }

  private static String schemaOf(Connection c) {
    try {
      return c.getSchema();
    } catch (Throwable e) {
      return null;
    }
  }

  private void send(String type, Object... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("type", type);
    m.put("tabId", tabId);
    for (int i = 0; i + 1 < kv.length; i += 2) {
      m.put((String) kv[i], kv[i + 1]);
    }
    session.send(m);
  }

  /** Milliseconds with microsecond precision, for the statistics. */
  private static double msd(long t0) {
    return Math.round((System.nanoTime() - t0) / 1000.0) / 1000.0;
  }

  private static long ms(long t0) {
    return (System.nanoTime() - t0) / 1_000_000;
  }

  static String message(Throwable e) {
    String msg = e.getMessage();
    return msg == null ? e.getClass().getSimpleName() : msg.trim();
  }

  private static String firstWord(String sql) {
    String s = sql.strip();
    int i = 0;
    while (i < s.length() && Character.isLetter(s.charAt(i))) i++;
    return i == 0 ? "Statement" : s.substring(0, i).toUpperCase();
  }

  private static String hex(byte[] b) {
    int n = Math.min(b.length, 2000);
    StringBuilder sb = new StringBuilder(n * 2 + 2).append("0x");
    for (int i = 0; i < n; i++) sb.append(String.format("%02X", b[i]));
    return sb.toString();
  }

  /** An open result set that the client reads page by page. */
  private static final class Cursor {
    final String id;
    final Statement stmt;
    final ResultSet rs;
    final int[] types;
    final List<Map<String, Object>> columns = new ArrayList<>();
    /** Rows sent to the client so far. */
    int sent;
    boolean done;

    Cursor(String id, Statement stmt, ResultSet rs) throws SQLException {
      this.id = id;
      this.stmt = stmt;
      this.rs = rs;
      ResultSetMetaData md = rs.getMetaData();
      types = new int[md.getColumnCount()];
      for (int i = 1; i <= types.length; i++) {
        types[i - 1] = md.getColumnType(i);
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("name", md.getColumnLabel(i));
        c.put("typeName", md.getColumnTypeName(i));
        c.put("jdbcType", types[i - 1]);
        c.put("nullable", md.isNullable(i) != ResultSetMetaData.columnNoNulls);
        columns.add(c);
      }
    }

    void closeRs() {
      try {
        rs.close();
      } catch (SQLException ignored) {
        // closing is best effort
      }
    }

    void closeJdbc() {
      try {
        rs.close();
        stmt.close();
      } catch (SQLException ignored) {
        // closing is best effort
      }
    }
  }
}
