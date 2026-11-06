'use strict';
// One-time tokens sent by email: email verification and password reset.
// Only a SHA-256 hash is stored; each token works once and expires.
const crypto = require('crypto');
const db = require('../config/database');

const TTL_MINUTES = { verify: 24 * 60, reset: 30 };
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');

const UserToken = {
  /** Creates a token, invalidating earlier unused tokens of the same purpose. Returns the raw token. */
  create(userId, purpose) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.transaction(() => {
      db.prepare("UPDATE user_tokens SET used_at=datetime('now') WHERE user_id=? AND purpose=? AND used_at IS NULL").run(userId, purpose);
      db.prepare(`INSERT INTO user_tokens (user_id,purpose,token_hash,expires_at) VALUES (?,?,?,datetime('now',?))`)
        .run(userId, purpose, hash(token), `+${TTL_MINUTES[purpose]} minutes`);
    })();
    return token;
  },

  /** The user a still-valid token belongs to, without using the token up (or null) */
  peekUser(token, purpose) {
    if (!token || typeof token !== 'string' || token.length > 100) return null;
    return db.prepare(`SELECT u.* FROM user_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.purpose=?
      AND t.used_at IS NULL AND t.expires_at>datetime('now')`).get(hash(token), purpose) || null;
  },

  /** Uses up a token. Returns the user id, or null if the token is unknown, used or expired. */
  consume(token, purpose) {
    if (!token || typeof token !== 'string' || token.length > 100) return null;
    const row = db.prepare(`SELECT * FROM user_tokens WHERE token_hash=? AND purpose=?
      AND used_at IS NULL AND expires_at>datetime('now')`).get(hash(token), purpose);
    if (!row) return null;
    const r = db.prepare("UPDATE user_tokens SET used_at=datetime('now') WHERE id=? AND used_at IS NULL").run(row.id);
    return r.changes === 1 ? row.user_id : null; // guards against two simultaneous uses
  },

  purge() {
    db.prepare("DELETE FROM user_tokens WHERE expires_at<=datetime('now','-1 day') OR used_at<=datetime('now','-1 day')").run();
  },
};

module.exports = UserToken;
