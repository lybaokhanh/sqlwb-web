package local.sqlwb;

import java.io.IOException;
import java.net.JarURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.jar.Attributes;
import java.util.jar.JarFile;

/**
 * Thin access layer to the SQL Workbench/J jar (the engine).
 */
public final class WbEngine {
  private static String build = "unknown";
  private static String buildDate = "";
  private static java.util.concurrent.CompletableFuture<Void> READY = java.util.concurrent.CompletableFuture.completedFuture(null);

  /** Waits until the engine is ready (only the first request waits). */
  static void awaitReady() {
    READY.join();
  }

  /** Prepares the headless engine and reads the build number of the loaded jar. */
  static void init(App.Config cfg) {
    Path conf = cfg.dataDir().resolve("wbconfig");
    try {
      Files.createDirectories(conf);
    } catch (IOException e) {
      throw new IllegalStateException("Cannot create " + conf, e);
    }
    System.setProperty("java.awt.headless", "true");
    System.setProperty("workbench.configdir", conf.toAbsolutePath().toString());
    System.setProperty("workbench.log.console", "false");
    readManifest();
    // The engine init takes ~1 s: run it after the HTTP server starts
    READY = java.util.concurrent.CompletableFuture.runAsync(workbench.WbManager::prepareForEmbedded);
  }

  static String buildNumber() {
    return build;
  }

  static String buildDate() {
    return buildDate;
  }

  private static void readManifest() {
    URL url = WbEngine.class.getClassLoader().getResource("workbench/WbManager.class");
    if (url == null || !"jar".equals(url.getProtocol())) {
      return;
    }
    try {
      JarURLConnection con = (JarURLConnection) url.openConnection();
      con.setUseCaches(false);
      try (JarFile jar = con.getJarFile()) {
        Attributes a = jar.getManifest().getMainAttributes();
        build = a.getValue("WbBuild-Number");
        buildDate = a.getValue("WbBuild-Date");
      }
    } catch (IOException e) {
      System.err.println("Cannot read the SQL Workbench/J manifest: " + e.getMessage());
    }
  }

  private WbEngine() {
  }
}
