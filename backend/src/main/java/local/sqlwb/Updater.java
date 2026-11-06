package local.sqlwb;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Checks sql-workbench.eu for a newer stable build and installs it into DATA_DIR/wb/current.
 * The app restarts after an install (Docker restart policy) to load the new jar.
 */
final class Updater {
  private static final Pattern STABLE = Pattern.compile("Current stable release:\\s*Build\\s*(\\d+)(?:,\\s*([0-9-]+))?");
  private static final Duration CACHE = Duration.ofHours(6);

  private HttpClient httpClient;

  /** Created on first use: TLS setup takes about 1 s and must not delay the start. */
  private synchronized HttpClient http() {
    if (httpClient == null) {
      httpClient = HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NORMAL).build();
    }
    return httpClient;
  }  private final String site;
  private final Path wbRoot;
  private volatile Map<String, Object> last;
  private volatile long lastAt;

  Updater(String site, Path dataDir) {
    this.site = site.endsWith("/") ? site : site + "/";
    this.wbRoot = dataDir.resolve("wb");
  }

  /** Returns current and latest build; the result is cached for 6 hours unless force is true. */
  Map<String, Object> check(boolean force) {
    if (!force && last != null && System.currentTimeMillis() - lastAt < CACHE.toMillis()) {
      return last;
    }
    Map<String, Object> r = new LinkedHashMap<>();
    r.put("current", WbEngine.buildNumber());
    try {
      String html = get(site + "downloads.html");
      Matcher m = STABLE.matcher(html);
      if (m.find()) {
        r.put("latest", m.group(1));
        r.put("latestDate", m.group(2));
        r.put("updateAvailable", isNewer(m.group(1), WbEngine.buildNumber()));
      } else {
        r.put("error", "Build number not found on " + site);
      }
    } catch (Exception e) {
      r.put("error", "Cannot reach " + site + ": " + TabConn.message(e));
    }
    last = r;
    lastAt = System.currentTimeMillis();
    return r;
  }

  /** Downloads, verifies (SHA-1 from the site) and installs the build. */
  String install(String build) throws Exception {
    if (!build.matches("\\d{2,4}")) {
      throw new IllegalArgumentException("Bad build number");
    }
    String name = "Workbench-Build" + build + "-with-optional-libs.zip";
    Path dir = wbRoot.resolve("build-" + build);
    Path zip = wbRoot.resolve(name);
    Files.createDirectories(wbRoot);
    String expected = get(site + name + ".sha1").trim().split("\\s+")[0].toLowerCase();
    HttpResponse<Path> res = http().send(HttpRequest.newBuilder(URI.create(site + name))
        .timeout(Duration.ofMinutes(5)).build(), HttpResponse.BodyHandlers.ofFile(zip));
    if (res.statusCode() != 200) {
      throw new IOException("Download failed: HTTP " + res.statusCode());
    }
    String actual = sha1(zip);
    if (!actual.equals(expected)) {
      Files.deleteIfExists(zip);
      throw new IOException("SHA-1 mismatch: expected " + expected + ", got " + actual);
    }
    unzip(zip, dir);
    stripClassPath(dir.resolve("sqlworkbench.jar"));
    Files.deleteIfExists(zip);
    if (!Files.exists(dir.resolve("sqlworkbench.jar"))) {
      throw new IOException("sqlworkbench.jar missing in " + name);
    }
    // Switch "current" in one step: write the target name, the entrypoint copies nothing
    Path current = wbRoot.resolve("current");
    Path tmp = wbRoot.resolve("current.tmp");
    deleteTree(tmp);
    copyTree(dir, tmp);
    deleteTree(current);
    Files.move(tmp, current, StandardCopyOption.ATOMIC_MOVE);
    return "Installed build " + build + ". The app restarts now.";
  }

  static boolean isNewer(String latest, String current) {
    try {
      return Integer.parseInt(latest) > Integer.parseInt(current);
    } catch (NumberFormatException e) {
      return false;
    }
  }

  private String get(String url) throws IOException, InterruptedException {
    HttpResponse<String> r = http().send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(20)).build(),
        HttpResponse.BodyHandlers.ofString());
    if (r.statusCode() != 200) {
      throw new IOException("HTTP " + r.statusCode() + " for " + url);
    }
    return r.body();
  }

  private static String sha1(Path f) throws Exception {
    MessageDigest md = MessageDigest.getInstance("SHA-1");
    try (InputStream in = Files.newInputStream(f)) {
      byte[] buf = new byte[1 << 16];
      int n;
      while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
    }
    return HexFormat.of().formatHex(md.digest());
  }

  /** Extracts only sqlworkbench.jar and ext/*.jar; rejects paths that leave the target folder. */
  private static void unzip(Path zip, Path target) throws IOException {
    deleteTree(target);
    Files.createDirectories(target.resolve("ext"));
    try (ZipInputStream in = new ZipInputStream(Files.newInputStream(zip))) {
      ZipEntry e;
      while ((e = in.getNextEntry()) != null) {
        String n = e.getName();
        boolean wanted = n.equals("sqlworkbench.jar") || (n.startsWith("ext/") && n.endsWith(".jar") && !n.contains(".."));
        if (!wanted || e.isDirectory()) continue;
        Path out = target.resolve(n).normalize();
        if (!out.startsWith(target)) throw new IOException("Bad zip entry " + n);
        Files.copy(in, out, StandardCopyOption.REPLACE_EXISTING);
      }
    }
  }

  /** Removes "Class-Path: . ext/..." from the manifest: CDS rejects directories; the entrypoint lists ext/* itself. */
  static void stripClassPath(Path jar) throws IOException {
    try (java.nio.file.FileSystem fs = java.nio.file.FileSystems.newFileSystem(jar)) {
      Path mf = fs.getPath("META-INF", "MANIFEST.MF");
      java.util.jar.Manifest m;
      try (InputStream in = Files.newInputStream(mf)) {
        m = new java.util.jar.Manifest(in);
      }
      m.getMainAttributes().remove(java.util.jar.Attributes.Name.CLASS_PATH);
      try (var out = Files.newOutputStream(mf)) {
        m.write(out);
      }
    }
  }

  private static void copyTree(Path src, Path dst) throws IOException {
    try (var s = Files.walk(src)) {
      for (Path p : (Iterable<Path>) s::iterator) {
        Path t = dst.resolve(src.relativize(p).toString());
        if (Files.isDirectory(p)) Files.createDirectories(t);
        else Files.copy(p, t, StandardCopyOption.REPLACE_EXISTING);
      }
    }
  }

  private static void deleteTree(Path p) throws IOException {
    if (!Files.exists(p)) return;
    try (var s = Files.walk(p)) {
      for (Path x : (Iterable<Path>) s.sorted(java.util.Comparator.reverseOrder())::iterator) {
        Files.delete(x);
      }
    }
  }
}
