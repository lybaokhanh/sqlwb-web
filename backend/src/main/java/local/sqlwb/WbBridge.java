package local.sqlwb;

import com.fasterxml.jackson.databind.JsonNode;
import workbench.db.ColumnIdentifier;
import workbench.db.ConnectionProfile;
import workbench.db.ObjectNameFilter;
import workbench.db.TableIdentifier;
import workbench.db.WbConnection;
import workbench.gui.completion.BaseAnalyzer;
import workbench.gui.completion.StatementContext;
import workbench.sql.DelimiterDefinition;
import workbench.sql.SqlCommand;
import workbench.sql.StatementRunner;
import workbench.sql.StatementRunnerResult;
import workbench.storage.DataStore;
import workbench.storage.ResultInfo;

import java.nio.file.Path;
import java.sql.Connection;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The jar side of one tab: a WbConnection around the tab's JDBC connection and a StatementRunner.
 * Runs Wb commands (WbExport, WbList, DESC, ...) and gives the Ctrl+Space completion of the desktop app.
 * Plain SQL does not go through here (TabConn has its own fast path with paging).
 */
final class WbBridge {
  /** Commands that reach the OS, change the connection or change settings of all users. */
  private static final Set<String> BLOCKED = Set.of(
      "wbsysexec", "wbsysopen", "wbsetprop", "wbconnect", "wbrestoreconnection", "wbdefinedriver", "wbloaddriver");
  /** Our own variables (Vars) handle these. */
  private static final Set<String> OWN = Set.of("wbvardef", "wbvardelete", "wbvarlist");
  /** -name=value (value quoted or not), and the bare words after the verb. */
  private static final Pattern ARG = Pattern.compile("(?s)-\\w+\\s*=\\s*(\"[^\"]*\"|'[^']*'|\\S+)|(\"[^\"]*\"|'[^']*'|\\S+)");
  private static final Pattern BAD_PATH = Pattern.compile("(?i)^(/|\\\\|~|[a-z]:[\\\\/]|.*%(configdir|programdir)%)|(^|[\\\\/])\\.\\.([\\\\/]|$)");

  private final WbConnection wb;
  private final StatementRunner runner;
  private final Path baseDir;

  /** Result of one Wb command: its messages and its result tables. */
  record Result(boolean ok, String messages, List<DataStore> data) {
  }

  WbBridge(String id, Connection con, ConnectionProfile profile, Path baseDir) throws Exception {
    WbEngine.awaitReady();
    this.baseDir = baseDir;
    java.nio.file.Files.createDirectories(baseDir);
    wb = new WbConnection(id, con, profile);
    runner = new StatementRunner();
    runner.setBaseDir(baseDir.toAbsolutePath().toString());
    runner.setConnection(wb);
    runner.setIgnoreDropErrors(profile.getIgnoreDropErrors());
    runner.setHideWarnings(profile.isHideWarnings());
  }

  /** The jar profile for a tab, with the options of the web profile. */
  static ConnectionProfile profile(String name, String url, JsonNode p) {
    ConnectionProfile cp = new ConnectionProfile();
    cp.setName(name == null || name.isBlank() ? "sqlwb" : name);
    cp.setUrl(url);
    cp.setUsername(p.path("user").asText());
    cp.setTemporaryProfile(true);
    cp.setAutocommit(p.path("autocommit").asBoolean(false));
    cp.setIgnoreDropErrors(p.path("ignoreDropErrors").asBoolean(false));
    cp.setEmptyStringIsNull(p.path("emptyStringIsNull").asBoolean(false));
    cp.setTrimCharData(p.path("trimCharData").asBoolean(false));
    cp.setRemoveComments(p.path("removeComments").asBoolean(false));
    cp.setHideWarnings(p.path("hideWarnings").asBoolean(false));
    cp.setReadOnly(p.path("readOnly").asBoolean(false));
    cp.setPreventDMLWithoutWhere(p.path("confirmNoWhere").asBoolean(false));
    String alt = p.path("altDelimiter").asText("");
    if (!alt.isBlank()) cp.setAlternateDelimiter(new DelimiterDefinition(alt.strip()));
    cp.setSchemaFilter(filter(p.path("schemaFilter").asText("")));
    cp.setCatalogFilter(filter(p.path("catalogFilter").asText("")));
    return cp;
  }

  /** First line of a filter that shows only the matching names (desktop "inclusion filter"). */
  static final String INCLUDE = "(include)";

  /** One regex per line; the matching names are hidden, or shown only after a first line "(include)". Null when empty. */
  static ObjectNameFilter filter(String lines) {
    if (lines == null || lines.isBlank()) return null;
    ObjectNameFilter f = new ObjectNameFilter();
    for (String l : lines.split("\\R")) {
      if (l.strip().equalsIgnoreCase(INCLUDE)) f.setInclusionFilter(true);
      else if (!l.isBlank()) f.addExpression(l.strip());
    }
    return f;
  }

  /** True when the jar must run this statement (a Wb command, also DESC, SHOW, @file). */
  boolean handles(String sql) {
    // WbExport without -sourceTable sets a consumer: the next statement goes to the export, so the jar must run it
    if (runner.getConsumer() != null) return true;
    String verb = verb(sql);
    if (OWN.contains(verb)) return false;
    if (verb.startsWith("wb") || verb.startsWith("@")) return true;
    SqlCommand c = runner.getCommandToUse(sql);
    return c != null && c.isWbCommand();
  }

  /** Runs one Wb command. Refuses commands that leave the user's file area or reach the OS. */
  Result run(String sql) throws Exception {
    String verb = verb(sql);
    if (BLOCKED.contains(verb)) {
      return new Result(false, verb(sql, true) + " is blocked in the web version (it reaches the server OS, "
          + "changes the connection or changes settings of all users)", List.of());
    }
    // Only command arguments are checked; a SELECT after WbExport may hold any text
    String bad = verb.startsWith("wb") || verb.startsWith("@") || verb.equals("desc") ? badPath(sql) : null;
    if (bad != null) {
      return new Result(false, "Path " + bad + " is not allowed. Use a file name relative to your file area "
          + "(Files dialog), for example -file=export.csv", List.of());
    }
    String badUrl = verb.startsWith("wb") ? Policy.badUrlIn(sql) : null;
    if (badUrl != null) {
      return new Result(false, "JDBC URL not allowed on this server (JDBC_URL_ALLOW): " + badUrl, List.of());
    }
    if (verb.startsWith("wb")) makeFolders(sql);
    StatementRunnerResult r = runner.runStatement(sql);
    try {
      String msg = r == null || r.getMessages() == null ? "" : r.getMessages().toString().strip();
      if (msg.isEmpty() && r != null && !r.isSuccess() && r.getErrorDescriptor() != null) {
        msg = String.valueOf(r.getErrorDescriptor().getErrorMessage()).strip();
      }
      if (msg.isEmpty() && r != null && !r.isSuccess()) msg = verb(sql, true) + " failed (no message from the engine)";
      List<DataStore> data = r == null || !r.hasDataStores() ? List.of() : new ArrayList<>(r.getDataStores());
      return new Result(r == null || r.isSuccess(), msg, data);
    } finally {
      runner.statementDone();
    }
  }

  void cancel() {
    try {
      runner.cancel();
    } catch (Exception ignored) {
      // best effort
    }
  }

  /** Releases the jar objects. The JDBC connection stays open: TabConn closes it. */
  void dispose() {
    try {
      runner.done();
      runner.dispose();
    } catch (Exception ignored) {
      // best effort
    }
  }

  /**
   * Completion items for the cursor position in one statement, from the jar's analyzer and object cache.
   * Each item: label, insert, kind (table, view, column, keyword, param, value, other), detail.
   */
  Map<String, Object> complete(String sql, int pos) {
    StatementContext ctx = new StatementContext(wb, sql, Math.max(0, Math.min(pos, sql.length())));
    Map<String, Object> out = new LinkedHashMap<>();
    List<Map<String, Object>> items = new ArrayList<>();
    if (ctx.isStatementSupported()) {
      BaseAnalyzer a = ctx.getAnalyzer();
      List<?> data = ctx.getData();
      for (Object o : data == null ? List.of() : data) {
        if (items.size() >= 2000) break;
        Map<String, Object> i = new LinkedHashMap<>();
        String paste = a == null ? null : a.getPasteValue(o);
        if (o instanceof TableIdentifier t) {
          i.put("label", t.getTableName());
          i.put("kind", t.getType() != null && t.getType().toUpperCase(Locale.ROOT).contains("VIEW") ? "view" : "table");
          i.put("detail", (t.getSchema() == null ? "" : t.getSchema() + " ") + (t.getType() == null ? "" : t.getType()));
        } else if (o instanceof ColumnIdentifier c) {
          i.put("label", c.getColumnName());
          i.put("kind", "column");
          i.put("detail", c.getDbmsType());
        } else {
          String s = String.valueOf(o);
          i.put("label", s);
          i.put("kind", a != null && a.isWbParam() ? "param" : a != null && a.isKeywordList() ? "keyword" : "other");
        }
        i.put("insert", paste == null || paste.isEmpty() ? i.get("label") : paste);
        items.add(i);
      }
      out.put("title", ctx.getTitle());
    }
    out.put("items", items);
    return out;
  }

  /** Column names and rows of a jar result table, for the result grid. */
  static List<Map<String, Object>> columns(DataStore ds) {
    ResultInfo ri = ds.getResultInfo();
    List<Map<String, Object>> cols = new ArrayList<>();
    for (int i = 0; i < ri.getColumnCount(); i++) {
      Map<String, Object> c = new LinkedHashMap<>();
      c.put("name", ri.getColumnName(i));
      c.put("typeName", ri.getDbmsTypeName(i));
      c.put("jdbcType", ri.getColumnType(i));
      c.put("nullable", true);
      cols.add(c);
    }
    return cols;
  }

  Path baseDir() {
    return baseDir;
  }

  private static final Pattern OUT_ARG = Pattern.compile("(?i)-(file|outputDir|outputFile|xsltOutput)\\s*=\\s*(\"[^\"]*\"|'[^']*'|\\S+)");

  /** Creates the folders of -file / -outputDir in the file area (the jar does not), so "-file=sub/x.csv" works. */
  private void makeFolders(String sql) {
    Matcher m = OUT_ARG.matcher(sql);
    while (m.find()) {
      Path p = baseDir.resolve(unquote(m.group(2))).normalize();
      Path dir = m.group(1).equalsIgnoreCase("outputDir") ? p : p.getParent();
      if (dir != null && dir.startsWith(baseDir)) {
        try {
          java.nio.file.Files.createDirectories(dir);
        } catch (Exception ignored) {
          // the command reports the missing folder
        }
      }
    }
  }

  /** First path-like argument that points outside the file area, or null. */
  static String badPath(String sql) {
    String s = sql.strip();
    int sp = 0;
    while (sp < s.length() && !Character.isWhitespace(s.charAt(sp))) sp++;
    String head = s.substring(0, sp);
    if (head.startsWith("@") && isBad(head.substring(1))) return head.substring(1);
    Matcher m = ARG.matcher(s.substring(sp));
    while (m.find()) {
      String v = m.group(1) != null ? m.group(1) : m.group(2);
      v = unquote(v);
      // Values like "username=x,url=jdbc:..." of -targetConnection hold no file path
      if (v.length() > 1 && isBad(v)) return v;
    }
    return null;
  }

  private static boolean isBad(String v) {
    return BAD_PATH.matcher(v.strip()).find();
  }

  private static String unquote(String v) {
    if (v.length() >= 2 && (v.startsWith("\"") && v.endsWith("\"") || v.startsWith("'") && v.endsWith("'"))) {
      return v.substring(1, v.length() - 1);
    }
    return v;
  }

  static String verb(String sql) {
    return verb(sql, false).toLowerCase(Locale.ROOT);
  }

  private static String verb(String sql, boolean keepCase) {
    String s = sql.strip();
    int i = 0;
    while (i < s.length() && !Character.isWhitespace(s.charAt(i)) && s.charAt(i) != ';') i++;
    return s.substring(0, i);
  }

  /** Name=value lines (the profile variables and extended properties). */
  static Properties props(String lines) {
    Properties p = new Properties();
    if (lines == null) return p;
    for (String l : lines.split("\\R")) {
      int eq = l.indexOf('=');
      if (eq > 0 && !l.strip().startsWith("#")) p.setProperty(l.substring(0, eq).strip(), l.substring(eq + 1).strip());
    }
    return p;
  }
}
