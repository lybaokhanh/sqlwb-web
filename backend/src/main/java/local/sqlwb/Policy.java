package local.sqlwb;

import java.sql.SQLException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Security settings from the environment: allowed JDBC URLs, self sign-up, login rate limit.
 */
final class Policy {
  /**
   * JDBC URLs a user may open. H2, Derby, HSQLDB and similar embedded drivers can run Java code
   * inside the server (CREATE ALIAS, INIT=RUNSCRIPT), so the default allows only client/server drivers.
   */
  static final Pattern JDBC_ALLOW = Pattern.compile(
      env("JDBC_URL_ALLOW", "jdbc:(oracle|postgresql):.*"), Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
  /** First login with an unknown name creates the user. Off: only existing users can log in. */
  static final boolean SIGNUP = !"false".equalsIgnoreCase(env("SIGNUP", "true"));

  private static final Pattern JDBC_IN_TEXT = Pattern.compile("(?i)jdbc:[^\\s,\"';]+(;[^\\s,\"']*)?");
  private static final int MAX_FAILS = 5;
  private static final long LOCK_MS = 60_000;
  private static final Map<String, long[]> FAILS = new ConcurrentHashMap<>();

  private Policy() {
  }

  /** Throws when the URL is not allowed by JDBC_URL_ALLOW. */
  static void checkUrl(String url) throws SQLException {
    if (url == null || !JDBC_ALLOW.matcher(url.strip()).matches()) {
      throw new SQLException("JDBC URL not allowed on this server (JDBC_URL_ALLOW): " + url);
    }
  }

  /** First JDBC URL in a Wb command (for example -targetConnection="url=...") that is not allowed, or null. */
  static String badUrlIn(String sql) {
    Matcher m = JDBC_IN_TEXT.matcher(sql);
    while (m.find()) {
      if (!JDBC_ALLOW.matcher(m.group()).matches()) return m.group();
    }
    return null;
  }

  /** True while the key (name or client IP) has too many failed logins. */
  static boolean locked(String key) {
    long[] f = FAILS.get(key);
    return f != null && f[0] >= MAX_FAILS && System.currentTimeMillis() - f[1] < LOCK_MS;
  }

  static void failed(String key) {
    FAILS.compute(key, (k, f) -> {
      long now = System.currentTimeMillis();
      if (f == null || now - f[1] >= LOCK_MS) return new long[] {1, now};
      return new long[] {f[0] + 1, now};
    });
    if (FAILS.size() > 10_000) FAILS.clear();
  }

  static void succeeded(String key) {
    FAILS.remove(key);
  }

  private static String env(String key, String def) {
    String v = System.getenv(key);
    return v == null || v.isBlank() ? def : v;
  }
}
