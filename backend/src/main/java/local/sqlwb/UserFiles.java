package local.sqlwb;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/**
 * The file area of each app user: DATA_DIR/files/&lt;user&gt;. Wb commands use it as base dir
 * (WbExport -file=x.csv writes here, WbImport and WbInclude read here). The browser lists, downloads and uploads files.
 */
final class UserFiles {
  /** Max. size of one upload. The proxy allows 20 MB (client_max_body_size). */
  static final long MAX_UPLOAD = 20L * 1024 * 1024;
  private static volatile Path root = Path.of("data", "files");

  static void init(Path dataDir) {
    root = dataDir.resolve("files").toAbsolutePath().normalize();
  }

  /** The folder of one user. The user name is checked at login ([a-z0-9._-]). */
  static Path dir(String user) throws IOException {
    if (user == null || !user.matches("[a-z0-9._-]{2,40}")) throw new IOException("No app user");
    Path d = root.resolve(user);
    Files.createDirectories(d);
    return d;
  }

  /** A path inside the user folder, or an exception. Sub folders are allowed, ".." is not. */
  static Path resolve(String user, String name) throws IOException {
    Path d = dir(user);
    if (name == null || name.isBlank()) throw new IOException("No file name");
    Path p = d.resolve(name.replace('\\', '/')).normalize();
    if (!p.startsWith(d) || p.equals(d)) throw new IOException("Bad file name " + name);
    return p;
  }

  /** All files of the user, newest first: name (relative, "/" between folders), size, modified (ms). */
  static List<Map<String, Object>> list(String user) throws IOException {
    Path d = dir(user);
    List<Map<String, Object>> out = new ArrayList<>();
    try (Stream<Path> s = Files.walk(d, 5)) {
      for (Path p : (Iterable<Path>) s.filter(Files::isRegularFile)::iterator) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("name", d.relativize(p).toString().replace('\\', '/'));
        m.put("size", Files.size(p));
        m.put("modified", Files.getLastModifiedTime(p).toMillis());
        out.add(m);
      }
    }
    out.sort((a, b) -> Long.compare((Long) b.get("modified"), (Long) a.get("modified")));
    return out;
  }

  private UserFiles() {
  }
}
