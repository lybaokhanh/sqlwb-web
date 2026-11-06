package local.sqlwb;

import com.fasterxml.jackson.databind.JsonNode;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * DB Explorer metadata, table data search and "Save changes" of the editable result grid.
 */
final class Meta {

  /** Oracle object types that JDBC getTables() does not list. */
  private static final List<String> ORACLE_EXTRA = List.of("SEQUENCE", "TYPE");

  /** Column types that "search" looks at. */
  private static final Set<Integer> TEXT_TYPES = Set.of(Types.CHAR, Types.VARCHAR, Types.NCHAR, Types.NVARCHAR);

  /** Answers a metadata request: schemas, tableTypes, objects, procedures, triggers, params, search, columns, indexes, pk, source. */
  static Object read(Connection con, String url, JsonNode m) throws SQLException {
    DatabaseMetaData md = con.getMetaData();
    String schema = emptyToNull(m.path("schema").asText(null));
    String name = m.path("name").asText(null);
    boolean oracle = "oracle".equals(SqlText.dbId(url));
    return switch (m.path("what").asText()) {
      case "schemas" -> list(md.getSchemas(), rs -> rs.getString("TABLE_SCHEM"));
      case "tableTypes" -> {
        List<Object> out = list(md.getTableTypes(), rs -> rs.getString("TABLE_TYPE").strip());
        if (oracle) out.addAll(ORACLE_EXTRA);
        yield out;
      }
      case "objects" -> objects(con, md, oracle, schema, m.has("types") ? List.of(toArray(m.path("types"))) : List.of());
      case "procedures" -> oracle
          ? oracleObjects(con, schema, List.of("PROCEDURE", "FUNCTION", "PACKAGE"))
          : list(md.getProcedures(null, schema, "%"), rs -> row("name", rs.getString("PROCEDURE_NAME"),
              "type", rs.getShort("PROCEDURE_TYPE") == DatabaseMetaData.procedureReturnsResult ? "FUNCTION" : "PROCEDURE",
              "remarks", rs.getString("REMARKS")));
      case "triggers" -> oracle ? oracleTriggers(con, schema) : List.of();
      case "params" -> params(con, md, oracle, schema, name);
      case "search" -> search(con, md, schema, name, m.path("value").asText(""), m.path("maxRows").asInt(100));
      case "columns" -> list(md.getColumns(null, schema, name, "%"), rs -> row(
          "name", rs.getString("COLUMN_NAME"), "type", rs.getString("TYPE_NAME"), "size", rs.getInt("COLUMN_SIZE"),
          "digits", rs.getInt("DECIMAL_DIGITS"), "nullable", rs.getInt("NULLABLE") != DatabaseMetaData.columnNoNulls,
          "default", rs.getString("COLUMN_DEF"), "remarks", rs.getString("REMARKS"), "position", rs.getInt("ORDINAL_POSITION")));
      case "indexes" -> list(md.getIndexInfo(null, schema, name, false, true), rs -> row(
          "name", rs.getString("INDEX_NAME"), "unique", !rs.getBoolean("NON_UNIQUE"),
          "column", rs.getString("COLUMN_NAME"), "position", rs.getInt("ORDINAL_POSITION")));
      case "pk" -> list(md.getPrimaryKeys(null, schema, name), rs -> rs.getString("COLUMN_NAME"));
      case "source" -> source(con, oracle, schema, name, m.path("objectType").asText("TABLE"));
      default -> throw new SQLException("Unknown metadata request " + m.path("what").asText());
    };
  }

  /** Runs the grid changes in one transaction with prepared statements. Returns the number of changed rows. */
  static int save(Connection con, JsonNode m, boolean emptyIsNull) throws SQLException {
    String table = m.path("table").asText();
    if (!table.matches("[\\w$#.\"]+")) throw new SQLException("Bad table name " + table);
    int count = 0;
    boolean auto = con.getAutoCommit();
    con.setAutoCommit(false);
    try {
      for (JsonNode ch : m.path("changes")) {
        String op = ch.path("op").asText();
        List<String> cols = new ArrayList<>();
        List<JsonNode> vals = new ArrayList<>();
        StringBuilder sql = new StringBuilder();
        if ("insert".equals(op)) {
          ch.path("values").fields().forEachRemaining(e -> { cols.add(ident(e.getKey())); vals.add(e.getValue()); });
          sql.append("INSERT INTO ").append(table).append(" (").append(String.join(", ", cols))
              .append(") VALUES (").append("?, ".repeat(cols.size()).replaceAll(", $", "")).append(')');
        } else if ("update".equals(op)) {
          List<String> set = new ArrayList<>();
          ch.path("values").fields().forEachRemaining(e -> { set.add(ident(e.getKey()) + " = ?"); vals.add(e.getValue()); });
          sql.append("UPDATE ").append(table).append(" SET ").append(String.join(", ", set)).append(where(ch.path("key"), vals));
        } else if ("delete".equals(op)) {
          sql.append("DELETE FROM ").append(table).append(where(ch.path("key"), vals));
        } else {
          throw new SQLException("Unknown change " + op);
        }
        try (PreparedStatement ps = con.prepareStatement(sql.toString())) {
          for (int i = 0; i < vals.size(); i++) {
            JsonNode v = vals.get(i);
            // "Empty string is NULL" of the profile
            if (v.isNull() || emptyIsNull && v.isTextual() && v.asText().isEmpty()) ps.setObject(i + 1, null);
            else if (v.isNumber()) ps.setBigDecimal(i + 1, v.decimalValue());
            else ps.setString(i + 1, v.asText());
          }
          int n = ps.executeUpdate();
          if (!"insert".equals(op) && n != 1) {
            throw new SQLException(n + " rows match the key of one changed row. Nothing saved. Define key columns.");
          }
          count += n;
        }
      }
      if (auto || m.path("commit").asBoolean(true)) con.commit();
      return count;
    } catch (SQLException e) {
      con.rollback();
      throw e;
    } finally {
      con.setAutoCommit(auto);
    }
  }

  private static String where(JsonNode key, List<JsonNode> vals) throws SQLException {
    if (!key.isObject() || key.isEmpty()) throw new SQLException("No key columns for the changed row");
    List<String> parts = new ArrayList<>();
    for (Iterator<Map.Entry<String, JsonNode>> it = key.fields(); it.hasNext(); ) {
      var e = it.next();
      if (e.getValue().isNull()) {
        parts.add(ident(e.getKey()) + " IS NULL");
      } else {
        parts.add(ident(e.getKey()) + " = ?");
        vals.add(e.getValue());
      }
    }
    return " WHERE " + String.join(" AND ", parts);
  }

  private static String ident(String col) throws IllegalArgumentException {
    if (!col.matches("[\\w$#]+")) return "\"" + col.replace("\"", "\"\"") + "\"";
    return col;
  }

  private static Object source(Connection con, boolean oracle, String schema, String name, String type) throws SQLException {
    if (!oracle) {
      return "-- Source is available for Oracle only. Use the Columns and Indexes tabs.";
    }
    String t = type.toUpperCase().replace(' ', '_');
    if (t.equals("PACKAGE")) t = "PACKAGE";
    try (PreparedStatement ps = con.prepareStatement("select dbms_metadata.get_ddl(?, ?, ?) from dual")) {
      ps.setString(1, t);
      ps.setString(2, name);
      ps.setString(3, schema);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next() ? rs.getString(1).strip() : "";
      }
    }
  }

  /** Objects of the given types. No types or "*" = all types. */
  private static List<Object> objects(Connection con, DatabaseMetaData md, boolean oracle, String schema, List<String> types)
      throws SQLException {
    boolean all = types.isEmpty() || types.contains("*");
    List<String> extra = oracle ? (all ? ORACLE_EXTRA : types.stream().filter(ORACLE_EXTRA::contains).toList()) : List.of();
    List<String> jdbc = types.stream().filter(t -> !extra.contains(t)).toList();
    List<Object> out = new ArrayList<>();
    if (all || !jdbc.isEmpty()) {
      out.addAll(list(md.getTables(null, schema, "%", all ? null : jdbc.toArray(String[]::new)), rs -> row(
          "name", rs.getString("TABLE_NAME"), "type", rs.getString("TABLE_TYPE"), "remarks", rs.getString("REMARKS"))));
    }
    if (!extra.isEmpty()) out.addAll(oracleObjects(con, schema, extra));
    return out;
  }

  private static List<Object> oracleObjects(Connection con, String schema, List<String> types) throws SQLException {
    try (PreparedStatement ps = con.prepareStatement(
        "select object_name, object_type, status from all_objects where owner = nvl(?, user) and object_type in ("
            + "?, ".repeat(types.size()).replaceAll(", $", "") + ") order by object_type, object_name")) {
      ps.setString(1, schema);
      for (int i = 0; i < types.size(); i++) ps.setString(i + 2, types.get(i));
      return list(ps.executeQuery(), rs -> row("name", rs.getString(1), "type", rs.getString(2), "status", rs.getString(3)));
    }
  }

  private static List<Object> oracleTriggers(Connection con, String schema) throws SQLException {
    try (PreparedStatement ps = con.prepareStatement(
        "select trigger_name, table_name, triggering_event, trigger_type, status from all_triggers "
            + "where owner = nvl(?, user) order by trigger_name")) {
      ps.setString(1, schema);
      return list(ps.executeQuery(), rs -> row("name", rs.getString(1), "type", "TRIGGER", "table", rs.getString(2),
          "event", rs.getString(3), "timing", rs.getString(4), "status", rs.getString(5)));
    }
  }

  /** Parameters of a procedure or function; for a package, of all its routines. */
  private static List<Object> params(Connection con, DatabaseMetaData md, boolean oracle, String schema, String name)
      throws SQLException {
    if (!oracle) {
      return list(md.getProcedureColumns(null, schema, name, "%"), rs -> row(
          "object", rs.getString("PROCEDURE_NAME"), "name", rs.getString("COLUMN_NAME"),
          "position", rs.getInt("ORDINAL_POSITION"), "mode", mode(rs.getInt("COLUMN_TYPE")), "type", rs.getString("TYPE_NAME")));
    }
    try (PreparedStatement ps = con.prepareStatement(
        "select object_name, argument_name, position, in_out, data_type from all_arguments "
            + "where owner = nvl(?, user) and data_level = 0 "
            + "and ((package_name is null and object_name = ?) or package_name = ?) "
            + "order by object_name, overload, sequence")) {
      ps.setString(1, schema);
      ps.setString(2, name);
      ps.setString(3, name);
      return list(ps.executeQuery(), rs -> row("object", rs.getString(1),
          "name", rs.getInt(3) == 0 ? "(return)" : rs.getString(2), "position", rs.getInt(3),
          "mode", rs.getString(4), "type", rs.getString(5)));
    }
  }

  private static String mode(int t) {
    return switch (t) {
      case DatabaseMetaData.procedureColumnIn -> "IN";
      case DatabaseMetaData.procedureColumnInOut -> "IN/OUT";
      case DatabaseMetaData.procedureColumnOut -> "OUT";
      case DatabaseMetaData.procedureColumnReturn -> "RETURN";
      case DatabaseMetaData.procedureColumnResult -> "RESULT";
      default -> "";
    };
  }

  /**
   * Searches one table for a value in its text columns (case-insensitive LIKE).
   * Without % or _ in the value, it matches anywhere. Returns the columns and at most maxRows rows.
   */
  private static Object search(Connection con, DatabaseMetaData md, String schema, String table, String value, int maxRows)
      throws SQLException {
    if (value.isBlank()) throw new SQLException("Enter a search value");
    List<String> cols = new ArrayList<>();
    List<String> text = new ArrayList<>();
    try (ResultSet rs = md.getColumns(null, schema, table, "%")) {
      while (rs.next()) {
        String c = rs.getString("COLUMN_NAME");
        cols.add(c);
        if (TEXT_TYPES.contains(rs.getInt("DATA_TYPE"))) text.add(c);
      }
    }
    List<Object> rows = new ArrayList<>();
    if (!text.isEmpty()) {
      String like = value.matches(".*[%_].*") ? value : "%" + value + "%";
      String where = String.join(" or ", text.stream().map(c -> "upper(" + quote(c) + ") like upper(?)").toList());
      String from = schema == null ? quote(table) : quote(schema) + "." + quote(table);
      try (PreparedStatement ps = con.prepareStatement("select * from " + from + " where " + where)) {
        ps.setMaxRows(Math.max(1, Math.min(maxRows, 1000)));
        ps.setQueryTimeout(30);
        for (int i = 0; i < text.size(); i++) ps.setString(i + 1, like);
        try (ResultSet rs = ps.executeQuery()) {
          int n = rs.getMetaData().getColumnCount();
          while (rs.next()) {
            List<String> r = new ArrayList<>(n);
            for (int i = 1; i <= n; i++) r.add(rs.getString(i));
            rows.add(r);
          }
        }
      }
    }
    return row("columns", cols, "rows", rows);
  }

  /** Quotes a name from the metadata as it is (exact case). */
  private static String quote(String name) {
    return "\"" + name.replace("\"", "\"\"") + "\"";
  }

  private interface RowFn {
    Object map(ResultSet rs) throws SQLException;
  }

  private static List<Object> list(ResultSet rs, RowFn fn) throws SQLException {
    List<Object> out = new ArrayList<>();
    try (rs) {
      while (rs.next()) out.add(fn.map(rs));
    }
    return out;
  }

  private static Map<String, Object> row(Object... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i + 1 < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
    return m;
  }

  private static String[] toArray(JsonNode a) {
    String[] out = new String[a.size()];
    for (int i = 0; i < out.length; i++) out[i] = a.get(i).asText();
    return out;
  }

  private static String emptyToNull(String s) {
    return s == null || s.isBlank() ? null : s;
  }

  private Meta() {
  }
}
