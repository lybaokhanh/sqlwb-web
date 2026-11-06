package local.sqlwb;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Variables per tab, as in SQL Workbench/J: WbVarDef, WbVarDelete, WbVarList, $[name] text replacement,
 * plus :name as a real JDBC bind (Oracle then parses the statement only once).
 */
final class Vars {
  private static final Pattern DEF = Pattern.compile("(?is)^\\s*wbvardef\\s+(-\\w+\\s+)*([A-Za-z_][\\w.]*)\\s*=\\s*(.*?)\\s*$");
  private static final Pattern DEL = Pattern.compile("(?is)^\\s*wbvardelete\\s+([A-Za-z_][\\w.*]*)\\s*$");
  private static final Pattern LIST = Pattern.compile("(?is)^\\s*wbvarlist\\s*$");
  private static final Pattern TEXT_VAR = Pattern.compile("\\$\\[[&?]?([A-Za-z_][\\w.]*)]");
  /** $[?name]: always ask. $[&name]: ask when not defined. */
  private static final Pattern PROMPT_VAR = Pattern.compile("\\$\\[([&?])([A-Za-z_][\\w.]*)]");
  private static final Pattern PLSQL = Pattern.compile("(?is)^\\s*(begin|declare|create\\s+(or\\s+replace\\s+)?(editionable\\s+)?(trigger|procedure|function|package|type))\\b.*");

  /** SQL text with ? for each bind, and the bind values in order. */
  record Prepared(String sql, List<String> binds) {
  }

  /** Runs a WbVar command and returns its message, or null when the statement is not a WbVar command. */
  static String handleCommand(Map<String, String> vars, String sql) {
    Matcher m = DEF.matcher(sql);
    if (m.matches()) {
      String v = unquote(m.group(3));
      vars.put(m.group(2), v);
      return "Variable " + m.group(2) + " defined with value '" + v + "'";
    }
    m = DEL.matcher(sql);
    if (m.matches()) {
      String name = m.group(1);
      if (name.equals("*")) {
        vars.clear();
        return "All variables deleted";
      }
      return vars.remove(name) == null ? "Variable " + name + " not found" : "Variable " + name + " deleted";
    }
    if (LIST.matcher(sql).matches()) {
      if (vars.isEmpty()) return "No variables defined";
      StringBuilder sb = new StringBuilder("Variables:");
      new TreeMap<>(vars).forEach((k, v) -> sb.append('\n').append(k).append(" = ").append(v));
      return sb.toString();
    }
    return null;
  }

  /** Replaces $[name] as text only (for Wb commands: the jar reads the command text). */
  static String text(Map<String, String> vars, String sql) {
    if (vars.isEmpty()) return sql;
    Matcher m = TEXT_VAR.matcher(sql);
    StringBuilder sb = new StringBuilder();
    while (m.find()) {
      String v = vars.get(m.group(1));
      m.appendReplacement(sb, Matcher.quoteReplacement(v == null ? m.group() : v));
    }
    m.appendTail(sb);
    return sb.toString();
  }

  static boolean isPlsql(String sql) {
    return PLSQL.matcher(sql).matches();
  }

  /** Replaces $[name] as text and :name (when defined) with ? binds. PL/SQL keeps :name (trigger :new/:old). */
  static Prepared prepare(Map<String, String> vars, String sql) {
    if (vars.isEmpty()) {
      return new Prepared(sql, List.of());
    }
    String text = text(vars, sql);
    if (PLSQL.matcher(text).matches()) {
      return new Prepared(text, List.of());
    }
    return bindNamed(vars, text);
  }

  /**
   * Names the user must give a value for before the statement runs, in order of first use:
   * :name binds and $[&name] that are not defined, and every $[?name]. Names in {@code asked} are skipped.
   * PL/SQL keeps :name (trigger :new/:old), so there only $[...] counts.
   */
  static List<String> missing(Map<String, String> vars, Set<String> asked, String sql) {
    Set<String> out = new LinkedHashSet<>();
    Matcher m = PROMPT_VAR.matcher(sql);
    while (m.find()) {
      String name = m.group(2);
      if (!asked.contains(name) && (m.group(1).equals("?") || !vars.containsKey(name))) out.add(name);
    }
    String text = text(vars, sql);
    if (!PLSQL.matcher(text).matches()) {
      for (String name : namedBinds(text)) {
        if (!vars.containsKey(name) && !asked.contains(name)) out.add(name);
      }
    }
    return new ArrayList<>(out);
  }

  /** The :name binds of a statement, outside strings, quoted names and comments. */
  static List<String> namedBinds(String sql) {
    List<String> names = new ArrayList<>();
    scan(sql, name -> {
      names.add(name);
      return null;
    });
    return names;
  }

  private static Prepared bindNamed(Map<String, String> vars, String s) {
    List<String> binds = new ArrayList<>();
    String sql = scan(s, name -> {
      if (!vars.containsKey(name)) return null;
      binds.add(vars.get(name));
      return "?";
    });
    return new Prepared(sql, binds);
  }

  /**
   * Scans the SQL and skips strings, quoted names and comments.
   * For each :name, onName returns the replacement text, or null to keep :name.
   */
  private static String scan(String s, Function<String, String> onName) {
    StringBuilder out = new StringBuilder(s.length());
    int i = 0;
    int n = s.length();
    while (i < n) {
      char c = s.charAt(i);
      if (c == '\'' || c == '"') {
        int j = s.indexOf(c, i + 1);
        while (j > 0 && c == '\'' && j + 1 < n && s.charAt(j + 1) == '\'') j = s.indexOf(c, j + 2);
        j = j < 0 ? n : j + 1;
        out.append(s, i, j);
        i = j;
      } else if (c == '-' && i + 1 < n && s.charAt(i + 1) == '-') {
        int j = s.indexOf('\n', i);
        j = j < 0 ? n : j;
        out.append(s, i, j);
        i = j;
      } else if (c == '/' && i + 1 < n && s.charAt(i + 1) == '*') {
        int j = s.indexOf("*/", i + 2);
        j = j < 0 ? n : j + 2;
        out.append(s, i, j);
        i = j;
      } else if (c == ':' && i + 1 < n && Character.isJavaIdentifierStart(s.charAt(i + 1))
          && (i == 0 || s.charAt(i - 1) != ':')) {
        int j = i + 1;
        while (j < n && (Character.isJavaIdentifierPart(s.charAt(j)) || s.charAt(j) == '.')) j++;
        String name = s.substring(i + 1, j);
        String r = onName.apply(name);
        if (r != null) {
          out.append(r);
        } else {
          out.append(s, i, j);
        }
        i = j;
      } else {
        out.append(c);
        i++;
      }
    }
    return out.toString();
  }

  private static String unquote(String v) {
    if (v.length() >= 2 && ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith("\"") && v.endsWith("\"")))) {
      return v.substring(1, v.length() - 1);
    }
    return v;
  }

  private Vars() {
  }
}
