package local.sqlwb;

import workbench.db.ConnectionProfile;
import workbench.db.IniProfileStorage;
import workbench.db.XmlProfileStorage;
import workbench.util.WbFile;

import java.awt.Color;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Reads desktop SQL Workbench/J profiles (WbProfiles.xml or .properties) with the jar's own reader. */
final class ProfileImport {
  private ProfileImport() {
  }

  private static void flag(Map<String, Object> m, String key, boolean v) {
    if (v) m.put(key, true);
  }

  /** Properties as name=value lines. */
  private static void putLines(Map<String, Object> m, String key, java.util.Properties p) {
    if (p == null || p.isEmpty()) return;
    StringBuilder sb = new StringBuilder();
    new java.util.TreeMap<>(p).forEach((k, v) -> sb.append(k).append('=').append(v).append('\n'));
    m.put(key, sb.toString().strip());
  }

  /** One regex per line. An inclusion filter starts with the line "(include)". */
  private static void putFilter(Map<String, Object> m, String key, workbench.db.ObjectNameFilter f) {
    if (f == null || f.getSize() == 0) return;
    String lines = String.join("\n", f.getFilterExpressions());
    m.put(key, f.isInclusionFilter() ? WbBridge.INCLUDE + "\n" + lines : lines);
  }

  static List<Map<String, Object>> read(String content, boolean ini) throws Exception {
    System.setProperty("java.awt.headless", "true");
    Path dir = Files.createTempDirectory("wbimport");
    Path f = dir.resolve(ini ? "WbProfiles.properties" : "WbProfiles.xml");
    try {
      Files.writeString(f, content, StandardCharsets.UTF_8);
      WbFile wf = new WbFile(f.toString());
      List<ConnectionProfile> list = ini ? new IniProfileStorage().readProfiles(wf) : new XmlProfileStorage().readProfiles(wf);
      List<Map<String, Object>> out = new ArrayList<>();
      for (ConnectionProfile p : list == null ? List.<ConnectionProfile>of() : list) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", p.getName());
        m.put("group", p.getGroups() == null ? "" : String.join("/", p.getGroups()));
        m.put("url", p.getUrl());
        m.put("user", p.getUsername() == null ? "" : p.getUsername());
        String pw = p.getStorePassword() ? p.getDecryptedPassword() : null;
        m.put("password", pw == null ? "" : pw);
        m.put("savePassword", p.getStorePassword());
        m.put("autocommit", p.getAutocommit());
        if (p.getDefaultFetchSize() != null) m.put("fetchSize", p.getDefaultFetchSize());
        m.put("sysdba", p.getOracleSysDBA());
        m.put("readOnly", p.isReadOnly());
        m.put("confirmUpdates", p.getConfirmUpdates());
        m.put("confirmNoWhere", p.getPreventDMLWithoutWhere());
        m.put("rememberSchema", p.getStoreExplorerSchema());
        Color c = p.getInfoDisplayColor();
        if (c != null) m.put("color", String.format("#%02x%02x%02x", c.getRed(), c.getGreen(), c.getBlue()));
        if (p.getTagList() != null && !p.getTagList().isBlank()) m.put("tags", p.getTagList());
        if (p.getPostConnectScript() != null && !p.getPostConnectScript().isBlank()) m.put("connectScript", p.getPostConnectScript());
        putLines(m, "variables", p.getConnectionVariables());
        putLines(m, "properties", p.getConnectionProperties());
        flag(m, "ignoreDropErrors", p.getIgnoreDropErrors());
        flag(m, "emptyStringIsNull", p.getEmptyStringIsNull());
        flag(m, "trimCharData", p.getTrimCharData());
        flag(m, "removeComments", p.getRemoveComments());
        flag(m, "hideWarnings", p.isHideWarnings());
        flag(m, "checkUncommitted", p.getDetectOpenTransaction());
        flag(m, "promptUser", p.getPromptForUsername());
        String alt = p.getAlternateDelimiterString();
        if (alt != null && !alt.isBlank()) m.put("altDelimiter", alt);
        putFilter(m, "schemaFilter", p.getSchemaFilter());
        putFilter(m, "catalogFilter", p.getCatalogFilter());
        out.add(m);
      }
      return out;
    } finally {
      Files.deleteIfExists(f);
      Files.deleteIfExists(dir);
    }
  }
}
