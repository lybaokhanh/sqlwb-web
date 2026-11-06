package local.sqlwb;

import com.fasterxml.jackson.databind.JsonNode;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.LockSupport;
import java.util.function.Consumer;

/**
 * Load run: N parallel sessions run a script in a loop for a fixed time. Reports p50/p95/p99 every second.
 */
final class LoadRun {
  static final int MAX_SESSIONS = 20;
  static final int MAX_SECONDS = 600;
  private static final double STEP = Math.log(1.02); // 2% buckets
  private static final int BUCKETS = 1200;           // up to ~20 min

  private final AtomicBoolean stop = new AtomicBoolean();
  private final AtomicLong count = new AtomicLong();
  private final AtomicLong errors = new AtomicLong();
  private final java.util.concurrent.atomic.AtomicLongArray hist = new java.util.concurrent.atomic.AtomicLongArray(BUCKETS);
  private final AtomicLong maxMicros = new AtomicLong();
  private volatile String lastError;

  void stop() {
    stop.set(true);
  }

  /** Runs the load; blocks until the end. Sends "loadStats" every second and "loadEnd" at the end. */
  void run(JsonNode m, Consumer<Map<String, Object>> out) {
    JsonNode p = m.path("profile");
    int sessions = Math.max(1, Math.min(MAX_SESSIONS, m.path("sessions").asInt(5)));
    int seconds = Math.max(1, Math.min(MAX_SECONDS, m.path("seconds").asInt(30)));
    double rate = m.path("ratePerSec").asDouble(0); // 0 = as fast as possible
    List<String> stmts = SqlText.split(m.path("sql").asText(), 0, SqlText.parserFor(p.path("url").asText()))
        .stream().map(SqlText.Stmt::sql).toList();
    if (stmts.isEmpty()) {
      out.accept(map("type", "loadEnd", "error", "No statement"));
      return;
    }
    long t0 = System.nanoTime();
    long end = t0 + seconds * 1_000_000_000L;
    List<Thread> threads = new ArrayList<>();
    for (int i = 0; i < sessions; i++) {
      threads.add(Thread.ofVirtual().name("load-" + i).start(() -> worker(p, stmts, end, rate / sessions)));
    }
    long lastCount = 0;
    while (threads.stream().anyMatch(Thread::isAlive)) {
      LockSupport.parkNanos(1_000_000_000L);
      long c = count.get();
      Map<String, Object> s = stats((System.nanoTime() - t0) / 1_000_000);
      s.put("type", "loadStats");
      s.put("rps", c - lastCount);
      lastCount = c;
      out.accept(s);
    }
    Map<String, Object> s = stats((System.nanoTime() - t0) / 1_000_000);
    s.put("type", "loadEnd");
    s.put("sessions", sessions);
    out.accept(s);
  }

  private void worker(JsonNode p, List<String> stmts, long end, double ratePerSession) {
    Properties props = new Properties();
    props.setProperty("user", p.path("user").asText());
    props.setProperty("password", p.path("password").asText());
    props.setProperty("v$session.program", "sqlwb-web-load");
    long gapNanos = ratePerSession > 0 ? (long) (1_000_000_000L / ratePerSession) : 0;
    try (Connection con = open(p.path("url").asText(), props); Statement st = con.createStatement()) {
      con.setAutoCommit(p.path("autocommit").asBoolean(true));
      long next = System.nanoTime();
      while (!stop.get() && System.nanoTime() < end) {
        for (String sql : stmts) {
          if (stop.get() || System.nanoTime() >= end) break;
          if (gapNanos > 0) {
            next += gapNanos;
            long wait = next - System.nanoTime();
            if (wait > 0) LockSupport.parkNanos(wait);
          }
          long t = System.nanoTime();
          try {
            if (st.execute(sql)) {
              try (ResultSet rs = st.getResultSet()) {
                while (rs.next()) {
                  // read all rows: the time includes the fetch
                }
              }
            }
            record((System.nanoTime() - t) / 1000);
          } catch (Exception e) {
            errors.incrementAndGet();
            lastError = TabConn.message(e);
          }
        }
      }
      if (!con.getAutoCommit()) con.rollback();
    } catch (Exception e) {
      errors.incrementAndGet();
      lastError = "Connect failed: " + TabConn.message(e);
    }
  }

  private void record(long micros) {
    count.incrementAndGet();
    hist.incrementAndGet(bucket(micros));
    maxMicros.accumulateAndGet(micros, Math::max);
  }

  private static Connection open(String url, Properties props) throws java.sql.SQLException {
    Policy.checkUrl(url);
    return DriverManager.getConnection(url, props);
  }

  private static int bucket(long micros) {
    return micros <= 1 ? 0 : (int) Math.min(BUCKETS - 1, Math.log(micros) / STEP);
  }

  private Map<String, Object> stats(long elapsedMs) {
    long[] h = new long[BUCKETS];
    long n = 0;
    for (int i = 0; i < BUCKETS; i++) n += (h[i] = hist.get(i));
    Map<String, Object> s = map("elapsedMs", elapsedMs, "count", count.get(), "errors", errors.get(),
        "p50", pct(h, n, 0.50), "p95", pct(h, n, 0.95), "p99", pct(h, n, 0.99), "max", maxMicros.get() / 1000.0);
    if (lastError != null) s.put("lastError", lastError);
    return s;
  }

  /** Percentile in milliseconds (upper bound of the 2% bucket). */
  private static double pct(long[] h, long n, double q) {
    if (n == 0) return 0;
    long target = (long) Math.ceil(q * n);
    long seen = 0;
    for (int i = 0; i < h.length; i++) {
      seen += h[i];
      if (seen >= target) return Math.round(Math.exp((i + 1) * STEP) / 10.0) / 100.0;
    }
    return 0;
  }
  private static Map<String, Object> map(Object... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i + 1 < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
    return m;
  }
}
