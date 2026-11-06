package local.sqlwb;

import workbench.sql.DelimiterDefinition;
import workbench.sql.formatter.WbSqlFormatter;
import workbench.sql.parser.ParserType;
import workbench.sql.parser.ScriptParser;

import java.util.ArrayList;
import java.util.List;

/**
 * Statement split and formatting with the SQL Workbench/J classes, so the behavior matches the desktop app.
 * alt = the alternate delimiter of the profile (for example "/" on its own line for PL/SQL), or null.
 */
final class SqlText {

  /** One statement of a script and its start offset in the editor text. */
  record Stmt(String sql, int start) {
  }

  /** Returns the statements to run for the given mode ("current", "selected" or "all"). */
  static List<Stmt> pick(String text, String mode, int cursor, int selStart, int selEnd, ParserType type) {
    return pick(text, mode, cursor, selStart, selEnd, type, null);
  }

  static List<Stmt> pick(String text, String mode, int cursor, int selStart, int selEnd, ParserType type, DelimiterDefinition alt) {
    if ("selected".equals(mode) && selEnd > selStart) {
      return split(text.substring(selStart, selEnd), selStart, type, alt);
    }
    if ("all".equals(mode)) {
      return split(text, 0, type, alt);
    }
    Stmt s = at(text, cursor, type, alt);
    return s == null ? List.of() : List.of(s);
  }

  /** The statement at the cursor. After the last delimiter: the statement before it, as in the desktop app. */
  static Stmt at(String text, int cursor, ParserType type, DelimiterDefinition alt) {
    ScriptParser p = parser(text, type, alt);
    if (p.getSize() == 0) return null;
    int idx = p.getCommandIndexAtCursorPos(cursor);
    if (idx < 0) idx = p.getSize() - 1;
    return idx < 0 ? null : new Stmt(p.getCommand(idx), p.getStartPosForCommand(idx));
  }

  static List<Stmt> split(String text, int offset, ParserType type) {
    return split(text, offset, type, null);
  }

  static List<Stmt> split(String text, int offset, ParserType type, DelimiterDefinition alt) {
    ScriptParser p = parser(text, type, alt);
    List<Stmt> out = new ArrayList<>(p.getSize());
    for (int i = 0; i < p.getSize(); i++) {
      String s = p.getCommand(i);
      if (s != null && !s.isBlank()) {
        out.add(new Stmt(s, offset + p.getStartPosForCommand(i)));
      }
    }
    return out;
  }

  private static ScriptParser parser(String text, ParserType type, DelimiterDefinition alt) {
    WbEngine.awaitReady();
    ScriptParser p = new ScriptParser(type);
    if (alt != null) p.setAlternateDelimiter(alt);
    p.setScript(text);
    return p;
  }

  /** Parses statement by statement and hands each one over at once, so execution can start before the parse ends. */
  static void stream(String text, int offset, ParserType type, DelimiterDefinition alt, java.util.function.Predicate<Stmt> out) {
    WbEngine.awaitReady();
    workbench.sql.parser.LexerBasedParser p = new workbench.sql.parser.LexerBasedParser(type);
    if (alt != null) p.setAlternateDelimiter(alt);
    p.setScript(text);
    workbench.sql.ScriptCommandDefinition c;
    while ((c = p.getNextCommand()) != null) {
      String s = c.getSQL();
      if (s != null && !s.isBlank() && !out.test(new Stmt(s, offset + c.getStartPositionInScript()))) {
        return;
      }
    }
  }

  static String format(String sql, String dbId) {
    WbEngine.awaitReady();
    return new WbSqlFormatter(sql, dbId).getFormattedSql();
  }

  /** Maps a JDBC URL to the parser type and DBID of SQL Workbench/J. */
  static ParserType parserFor(String url) {
    return ParserType.getTypeFromDBID(dbId(url));
  }

  static String dbId(String url) {
    String u = url == null ? "" : url.toLowerCase();
    if (u.startsWith("jdbc:oracle:")) return "oracle";
    if (u.startsWith("jdbc:postgresql:")) return "postgresql";
    if (u.startsWith("jdbc:sqlserver:")) return "microsoft_sql_server";
    if (u.startsWith("jdbc:mysql:") || u.startsWith("jdbc:mariadb:")) return "mysql";
    if (u.startsWith("jdbc:h2:")) return "h2";
    return "generic";
  }

  private SqlText() {
  }
}
