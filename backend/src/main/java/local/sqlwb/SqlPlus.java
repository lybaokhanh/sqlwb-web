package local.sqlwb;

import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SQL*Plus client commands in Oracle scripts. The database does not know them (ORA-00922), so the app handles them.
 * SET SERVEROUTPUT (and ENABLEOUT / DISABLEOUT of the desktop app) switch DBMS_OUTPUT on or off.
 * Other SQL*Plus display options (SET ECHO, SET DEFINE, ...) have no effect here: the app skips them.
 */
final class SqlPlus {
  /** What the app does with one statement. */
  enum Action { OUTPUT_ON, OUTPUT_OFF, IGNORE }

  private static final Pattern SERVEROUTPUT = Pattern.compile("(?is)^\\s*set\\s+serverout(?:put)?\\s+(on|off)\\b.*");
  private static final Pattern OUT_CMD = Pattern.compile("(?is)^\\s*(enableout|disableout)\\b.*");
  private static final Pattern SET = Pattern.compile("(?is)^\\s*set\\s+(\\w+)\\b.*");
  /** SQL*Plus SET options. SET ROLE, SET TRANSACTION and SET CONSTRAINTS are SQL and are not in this list. */
  private static final Set<String> OPTIONS = Set.of(
      "appinfo", "arraysize", "autoprint", "autorecovery", "autotrace", "blockterminator", "cmdsep", "colinvisible",
      "colsep", "concat", "copycommit", "copytypecheck", "define", "describe", "echo", "editfile", "embedded",
      "errorlogging", "escape", "escchar", "exitcommit", "feedback", "feed", "flagger", "flush", "heading", "head",
      "headsep", "instance", "linesize", "lines", "lobprefetch", "logsource", "long", "longchunksize", "markup",
      "newpage", "null", "numformat", "numwidth", "pagesize", "pages", "pause", "recsep", "recsepchar", "rowprefetch",
      "securedcol", "shiftinout", "showmode", "sqlblanklines", "sqlcase", "sqlcontinue", "sqlnumber", "sqlpluscompat",
      "sqlprefix", "sqlprompt", "sqlterminator", "statementcache", "suffix", "tab", "termout", "term", "time", "timing",
      "trimout", "trimspool", "underline", "verify", "ver", "wrap");

  private SqlPlus() {
  }

  /** Comments before the first word: "-- ..." lines and "/* ... *&#47;" blocks. */
  private static final Pattern LEADING_COMMENTS = Pattern.compile("(?s)^(\\s*(--[^\\n]*(\\n|$)|/\\*.*?\\*/))*\\s*");

  /** The action for a statement, or null when the statement goes to the database. */
  static Action action(String sql) {
    sql = LEADING_COMMENTS.matcher(sql).replaceFirst("");
    Matcher m = SERVEROUTPUT.matcher(sql);
    if (m.matches()) return m.group(1).equalsIgnoreCase("on") ? Action.OUTPUT_ON : Action.OUTPUT_OFF;
    m = OUT_CMD.matcher(sql);
    if (m.matches()) return m.group(1).equalsIgnoreCase("enableout") ? Action.OUTPUT_ON : Action.OUTPUT_OFF;
    m = SET.matcher(sql);
    if (m.matches() && OPTIONS.contains(m.group(1).toLowerCase(Locale.ROOT))) return Action.IGNORE;
    return null;
  }

  /** Message for a skipped SET option, for example "SET ECHO is a SQL*Plus option: skipped". */
  static String skipped(String sql) {
    Matcher m = SET.matcher(LEADING_COMMENTS.matcher(sql).replaceFirst(""));
    String opt = m.matches() ? m.group(1).toUpperCase(Locale.ROOT) : "option";
    return "SET " + opt + " is a SQL*Plus option: skipped";
  }

  /**
   * Reads all waiting DBMS_OUTPUT lines in one round trip.
   * Lines go into a VARCHAR2 chunk first; the chunk goes into the CLOB when it is full (CLOB appends are slow).
   */
  static final String READ_OUTPUT = """
      declare
        l varchar2(32767);
        s integer;
        chunk varchar2(32767);
        buf clob;
      begin
        loop
          dbms_output.get_line(l, s);
          exit when s <> 0;
          if nvl(lengthb(chunk), 0) + nvl(lengthb(l), 0) + 1 > 32000 then
            buf := buf || chunk || l || chr(10);
            chunk := null;
          else
            chunk := chunk || l || chr(10);
          end if;
        end loop;
        ? := buf || chunk;
      end;""";
}
