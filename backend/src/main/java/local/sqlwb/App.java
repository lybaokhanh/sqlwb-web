package local.sqlwb;

import io.javalin.Javalin;
import io.javalin.http.staticfiles.Location;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/**
 * Entry point: HTTP API, WebSocket and the static frontend.
 */
public final class App {

  public static void main(String[] args) {
    long t0 = System.nanoTime();
    Config cfg = Config.fromEnv();
    WbEngine.init(cfg);
    UserFiles.init(cfg.dataDir());
    long tEngine = System.nanoTime();

    Javalin app = Javalin.create(c -> {
      c.showJavalinBanner = false;
      c.http.maxRequestSize = UserFiles.MAX_UPLOAD + 1024 * 1024;
      c.http.gzipOnlyCompression();
      if (Files.isDirectory(cfg.publicDir())) {
        c.staticFiles.add(s -> {
          s.directory = cfg.publicDir().toString();
          s.location = Location.EXTERNAL;
          s.headers = Map.of("Cache-Control", "public, max-age=31536000, immutable");
          s.skipFileFunction = req -> req.getRequestURI().equals("/") || req.getRequestURI().endsWith(".html");
        });
        c.spaRoot.addFile("/", cfg.publicDir().resolve("index.html").toString(), Location.EXTERNAL);
      }
    });

    app.get("/api/health", ctx -> ctx.json(Map.of("status", "ok")));
    app.get("/api/version", ctx -> ctx.json(Map.of(
        "app", Config.APP_VERSION,
        "wbBuild", WbEngine.buildNumber(),
        "wbBuildDate", WbEngine.buildDate())));
    app.get("/api/config", ctx -> ctx.json(Map.of(
        "defaultProfile", Map.of("name", cfg.defaultName(), "url", cfg.defaultUrl()))));

    long tHttp = System.nanoTime();
    Store store;
    try {
      store = new Store(cfg.dataDir());
    } catch (Exception e) {
      throw new IllegalStateException("Cannot open the store in " + cfg.dataDir(), e);
    }
    Updater updater = new Updater(System.getenv().getOrDefault("WB_SITE", "https://www.sql-workbench.eu/"), cfg.dataDir());
    java.util.Set<String> admins = new java.util.HashSet<>();
    for (String a : System.getenv().getOrDefault("ADMIN_USERS", "").split(",")) {
      if (!a.isBlank()) admins.add(a.trim().toLowerCase());
    }
    long tStore = System.nanoTime();
    new Sessions(store, updater, admins).register(app);
    app.start(cfg.port());
    long tEnd = System.nanoTime();
    System.out.printf("sqlwb-web ready on :%d in %d ms (engine %d, http setup %d, store %d, start %d) (SQL Workbench/J build %s)%n",
        cfg.port(), (tEnd - t0) / 1_000_000,
        (tEngine - t0) / 1_000_000, (tHttp - tEngine) / 1_000_000, (tStore - tHttp) / 1_000_000, (tEnd - tStore) / 1_000_000, WbEngine.buildNumber());
    if (System.getenv("SQLWB_EXIT_AFTER_START") != null) {
      // Image build: load the hot classes once so the CDS archive holds them, then exit
      SqlText.split("select 1 from dual;\nselect 2 from dual", 0, SqlText.parserFor("jdbc:oracle:thin:"));
      SqlText.format("select a,b from t where a=1", "oracle");
      app.stop();
      System.exit(0);
    }
  }

  private App() {
  }

  /** Runtime settings from environment variables. */
  public record Config(int port, Path dataDir, Path publicDir, String defaultName, String defaultUrl) {
    /** Set by the image build from the git tag (Dockerfile ARG APP_VERSION). Local runs: "dev". */
    static final String APP_VERSION = System.getenv().getOrDefault("APP_VERSION", "dev");

    static Config fromEnv() {
      return new Config(
          Integer.parseInt(env("PORT", "8484")),
          Path.of(env("DATA_DIR", "data")),
          Path.of(env("PUBLIC_DIR", "public")),
          env("DEFAULT_NAME", "local"),
          env("DEFAULT_URL", ""));
    }

    private static String env(String key, String def) {
      String v = System.getenv(key);
      return v == null || v.isBlank() ? def : v;
    }
  }
}
