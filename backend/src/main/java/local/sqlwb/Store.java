package local.sqlwb;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.HexFormat;

/**
 * App users and their saved workspaces (tabs, SQL, cursor, connection profiles without passwords). SQLite file in DATA_DIR.
 */
final class Store {
  private static final int ITER = 120_000;
  private final java.util.concurrent.CompletableFuture<Connection> dbF;

  /** Opens the SQLite file in the background (loading the native library takes ~1 s); the first call waits. */
  Store(Path dataDir) throws Exception {
    Files.createDirectories(dataDir);
    dbF = java.util.concurrent.CompletableFuture.supplyAsync(() -> {
      try {
        Connection c = DriverManager.getConnection("jdbc:sqlite:" + dataDir.resolve("sqlwb.db"));
        try (Statement s = c.createStatement()) {
          s.execute("PRAGMA journal_mode=WAL");
          s.execute("create table if not exists app_user(name text primary key, salt text not null, hash text not null, created integer not null)");
          s.execute("create table if not exists workspace(name text primary key, json text not null, updated integer not null)");
          s.execute("create table if not exists profiles(name text primary key, json text not null, updated integer not null)");
          s.execute("create table if not exists app_session(id_hash text primary key, name text not null, key_enc text, expires integer not null)");
          if (!hasColumn(c, "workspace", "ver")) s.execute("alter table workspace add column ver integer not null default 0");
        }
        return c;
      } catch (SQLException e) {
        throw new IllegalStateException("Cannot open the store in " + dataDir, e);
      }
    });
  }

  private Connection db() {
    return dbF.join();
  }

  private static boolean hasColumn(Connection c, String table, String col) throws SQLException {
    try (ResultSet rs = c.getMetaData().getColumns(null, null, table, col)) {
      return rs.next();
    }
  }
  /** Checks the password. Creates the user at the first login (self sign-up, unless SIGNUP=false). Returns false for a wrong password. */
  synchronized boolean login(String name, String password) throws Exception {
    try (PreparedStatement ps = db().prepareStatement("select salt, hash from app_user where name = ?")) {
      ps.setString(1, name);
      try (ResultSet rs = ps.executeQuery()) {
        if (rs.next()) {
          byte[] salt = HexFormat.of().parseHex(rs.getString(1));
          return MessageDigest.isEqual(hash(password, salt), HexFormat.of().parseHex(rs.getString(2)));
        }
      }
    }
    if (!Policy.SIGNUP) return false;
    byte[] salt = new byte[16];
    new SecureRandom().nextBytes(salt);
    try (PreparedStatement ps = db().prepareStatement("insert into app_user(name, salt, hash, created) values (?,?,?,?)")) {
      ps.setString(1, name);
      ps.setString(2, HexFormat.of().formatHex(salt));
      ps.setString(3, HexFormat.of().formatHex(hash(password, salt)));
      ps.setLong(4, System.currentTimeMillis());
      ps.executeUpdate();
    }
    return true;
  }

  /** Key for saved DB passwords: derived from the app password, kept only in the session memory. */
  static javax.crypto.SecretKey profileKey(String name, String password) throws Exception {
    byte[] salt = MessageDigest.getInstance("SHA-256").digest(("sqlwb-profiles:" + name).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    byte[] k = hash(password, salt);
    return new javax.crypto.spec.SecretKeySpec(k, "AES");
  }

  static String encrypt(javax.crypto.SecretKey key, String plain) throws Exception {
    byte[] iv = new byte[12];
    new SecureRandom().nextBytes(iv);
    javax.crypto.Cipher c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
    c.init(javax.crypto.Cipher.ENCRYPT_MODE, key, new javax.crypto.spec.GCMParameterSpec(128, iv));
    byte[] ct = c.doFinal(plain.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    return "gcm:" + HexFormat.of().formatHex(iv) + ":" + java.util.Base64.getEncoder().encodeToString(ct);
  }

  /** Returns null when the value cannot be decrypted (for example after an app password change). */
  static String decrypt(javax.crypto.SecretKey key, String enc) {
    try {
      String[] p = enc.split(":", 3);
      javax.crypto.Cipher c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
      c.init(javax.crypto.Cipher.DECRYPT_MODE, key, new javax.crypto.spec.GCMParameterSpec(128, HexFormat.of().parseHex(p[1])));
      return new String(c.doFinal(java.util.Base64.getDecoder().decode(p[2])), java.nio.charset.StandardCharsets.UTF_8);
    } catch (Exception e) {
      return null;
    }
  }

  synchronized String loadProfiles(String name) throws SQLException {
    try (PreparedStatement ps = db().prepareStatement("select json from profiles where name = ?")) {
      ps.setString(1, name);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next() ? rs.getString(1) : null;
      }
    }
  }

  synchronized void saveProfiles(String name, String json) throws SQLException {
    try (PreparedStatement ps = db().prepareStatement(
        "insert into profiles(name, json, updated) values (?,?,?) on conflict(name) do update set json = excluded.json, updated = excluded.updated")) {
      ps.setString(1, name);
      ps.setString(2, json);
      ps.setLong(3, System.currentTimeMillis());
      ps.executeUpdate();
    }
  }

  record Workspace(String json, long ver) {}

  /** Returns null when the user has no saved workspace. */
  synchronized Workspace loadWorkspace(String name) throws SQLException {
    try (PreparedStatement ps = db().prepareStatement("select json, ver from workspace where name = ?")) {
      ps.setString(1, name);
      try (ResultSet rs = ps.executeQuery()) {
        return rs.next() ? new Workspace(rs.getString(1), rs.getLong(2)) : null;
      }
    }
  }

  /**
   * Saves when the stored version is {@code expect} (negative = always). Returns the new version,
   * or -1 when another browser tab saved a newer version first.
   */
  synchronized long saveWorkspace(String name, String json, long expect) throws SQLException {
    Workspace cur = loadWorkspace(name);
    long ver = cur == null ? 0 : cur.ver();
    if (expect >= 0 && expect != ver) return -1;
    try (PreparedStatement ps = db().prepareStatement(
        "insert into workspace(name, json, updated, ver) values (?,?,?,?) on conflict(name) do update set json = excluded.json, updated = excluded.updated, ver = excluded.ver")) {
      ps.setString(1, name);
      ps.setString(2, json);
      ps.setLong(3, System.currentTimeMillis());
      ps.setLong(4, ver + 1);
      ps.executeUpdate();
    }
    return ver + 1;
  }

  // ---- Persistent app sessions ----
  // The row holds a hash of the cookie value, never the value. The profile key is encrypted with a key
  // derived from the cookie value, so the DB file alone cannot decrypt saved DB passwords.

  record SessionRow(String name, javax.crypto.SecretKey profileKey, long expires) {}

  synchronized void saveSession(String sid, String name, javax.crypto.SecretKey key, long expires) throws Exception {
    try (PreparedStatement ps = db().prepareStatement(
        "insert into app_session(id_hash, name, key_enc, expires) values (?,?,?,?) on conflict(id_hash) do update set name = excluded.name, key_enc = excluded.key_enc, expires = excluded.expires")) {
      ps.setString(1, sidHash(sid));
      ps.setString(2, name);
      ps.setString(3, key == null ? null : encrypt(sidKey(sid), java.util.Base64.getEncoder().encodeToString(key.getEncoded())));
      ps.setLong(4, expires);
      ps.executeUpdate();
    }
  }

  /** Returns null for an unknown or expired session. The key is null when it cannot be decrypted. */
  synchronized SessionRow loadSession(String sid) throws Exception {
    try (PreparedStatement ps = db().prepareStatement("select name, key_enc, expires from app_session where id_hash = ?")) {
      ps.setString(1, sidHash(sid));
      try (ResultSet rs = ps.executeQuery()) {
        if (!rs.next() || rs.getLong(3) < System.currentTimeMillis()) return null;
        String enc = rs.getString(2);
        String raw = enc == null ? null : decrypt(sidKey(sid), enc);
        javax.crypto.SecretKey key = raw == null ? null : new javax.crypto.spec.SecretKeySpec(java.util.Base64.getDecoder().decode(raw), "AES");
        return new SessionRow(rs.getString(1), key, rs.getLong(3));
      }
    }
  }

  synchronized void touchSession(String sid, long expires) throws SQLException {
    try (PreparedStatement ps = db().prepareStatement("update app_session set expires = ? where id_hash = ?")) {
      ps.setLong(1, expires);
      ps.setString(2, sidHash(sid));
      ps.executeUpdate();
    }
  }

  synchronized void deleteSession(String sid) throws SQLException {
    try (PreparedStatement ps = db().prepareStatement("delete from app_session where id_hash = ?")) {
      ps.setString(1, sidHash(sid));
      ps.executeUpdate();
    }
  }

  synchronized void purgeSessions() throws SQLException {
    try (PreparedStatement ps = db().prepareStatement("delete from app_session where expires < ?")) {
      ps.setLong(1, System.currentTimeMillis());
      ps.executeUpdate();
    }
  }

  private static byte[] sha256(String s) throws Exception {
    return MessageDigest.getInstance("SHA-256").digest(s.getBytes(java.nio.charset.StandardCharsets.UTF_8));
  }

  private static String sidHash(String sid) throws SQLException {
    try {
      return HexFormat.of().formatHex(sha256("sqlwb-sid:" + sid));
    } catch (Exception e) {
      throw new SQLException(e);
    }
  }

  private static javax.crypto.SecretKey sidKey(String sid) throws Exception {
    return new javax.crypto.spec.SecretKeySpec(sha256("sqlwb-sid-key:" + sid), "AES");
  }

  private static byte[] hash(String password, byte[] salt) throws Exception {
    PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITER, 256);
    return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
  }
}
