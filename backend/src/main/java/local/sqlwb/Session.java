package local.sqlwb;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * One app login (cookie): the user, the key for saved passwords and the browser tabs (windows) of this login.
 */
final class Session {
  /** Window id of clients that do not send "hello" (old frontend). */
  static final String DEFAULT_WIN = "default";

  final String id;
  volatile String user;
  /** Key for saved DB passwords; exists only in memory while the user is logged in. */
  volatile javax.crypto.SecretKey profileKey;
  /** Last time the stored session expiry was renewed. */
  volatile long touched;
  private final Map<String, Win> wins = new ConcurrentHashMap<>();

  Session(String id) {
    this.id = id;
  }

  /** The window with this id; created on first use. */
  Win win(String winId) {
    String w = winId == null || !winId.matches("[A-Za-z0-9_-]{1,64}") ? DEFAULT_WIN : winId;
    return wins.computeIfAbsent(w, k -> new Win(k, this));
  }

  /** Window when it exists, else null (no new window for a read). */
  Win findWin(String winId) {
    return wins.get(winId == null || winId.isEmpty() ? DEFAULT_WIN : winId);
  }

  void flush() {
    wins.values().forEach(Win::flush);
  }

  /** Closes windows without a WebSocket for longer than idleMs. Returns true when no window is left. */
  boolean reap(long now, long idleMs) {
    wins.values().removeIf(w -> {
      long d = w.detachedSince();
      if (d > 0 && now - d > idleMs) {
        w.closeAll();
        return true;
      }
      return false;
    });
    return wins.isEmpty();
  }

  void closeAll() {
    wins.values().forEach(Win::closeAll);
    wins.clear();
  }
}
