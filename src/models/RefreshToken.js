'use strict';
// Refresh tokens. Only a SHA-256 hash of each token is stored, so a leaked
// database can't be used to sign in.
const crypto = require('crypto');
const db = require('../config/database');

const hash = token => crypto.createHash('sha256').update(String(token)).digest('hex');

const RefreshToken = {
  hash,

  create({ token, audience, userId = null, family, expiresAt, ip = '', userAgent = '' }) {
    db.prepare(`INSERT INTO refresh_tokens (token_hash,audience,user_id,family,expires_at,ip_address,user_agent)
      VALUES (?,?,?,?,?,?,?)`).run(hash(token), audience, userId, family, expiresAt, String(ip).slice(0, 60), String(userAgent).slice(0, 300));
  },

  findByToken(token) {
    return db.prepare('SELECT * FROM refresh_tokens WHERE token_hash=?').get(hash(token));
  },

  revoke(id) {
    db.prepare("UPDATE refresh_tokens SET revoked_at=datetime('now') WHERE id=? AND revoked_at IS NULL").run(id);
  },

  /** Marks a token as used up because it was exchanged for a newer one */
  markRotated(id) {
    db.prepare("UPDATE refresh_tokens SET revoked_at=datetime('now'), rotated=1 WHERE id=? AND revoked_at IS NULL").run(id);
  },

  /** True if the family still has a live token (i.e. the login hasn't been ended) */
  familyActive(family) {
    return !!db.prepare("SELECT 1 FROM refresh_tokens WHERE family=? AND revoked_at IS NULL AND expires_at>datetime('now')").get(family);
  },

  revokeFamily(family) {
    db.prepare("UPDATE refresh_tokens SET revoked_at=datetime('now') WHERE family=? AND revoked_at IS NULL").run(family);
  },

  revokeAllForUser(userId) {
    db.prepare("UPDATE refresh_tokens SET revoked_at=datetime('now') WHERE user_id=? AND revoked_at IS NULL").run(userId);
  },

  revokeAllAdmin() {
    db.prepare("UPDATE refresh_tokens SET revoked_at=datetime('now') WHERE audience='admin' AND revoked_at IS NULL").run();
  },

  /** Removes rows that can no longer be used (expired, or revoked more than a day ago) */
  purge() {
    db.prepare(`DELETE FROM refresh_tokens WHERE expires_at<=datetime('now')
      OR (revoked_at IS NOT NULL AND revoked_at<=datetime('now','-1 day'))`).run();
  },
};

module.exports = RefreshToken;
