'use strict';
// Website visitor accounts and their saved (wishlist) properties.
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('../config/database');

const scrypt = promisify(crypto.scrypt);
const ROLES = ['user'];

// scrypt cost: N = 2^17 (OWASP recommendation). Tests may lower it with PASSWORD_HASH_COST.
const COST = Math.min(Math.max(parseInt(process.env.PASSWORD_HASH_COST, 10) || 17, 10), 20);
const PARAMS = { N: 2 ** COST, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

/** Hash format: scrypt$<log2 N>$<r>$<p>$<salt hex>$<hash hex> */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, 64, PARAMS);
  return `scrypt$${COST}$${PARAMS.r}$${PARAMS.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function checkPassword(password, stored) {
  const s = String(stored || '');
  let salt, expected, params;
  if (s.startsWith('scrypt$')) {
    const [, cost, r, p, saltHex, hashHex] = s.split('$');
    params = { N: 2 ** Number(cost), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 };
    salt = Buffer.from(saltHex, 'hex'); expected = Buffer.from(hashHex, 'hex');
  } else {
    // Older "salt:hash" format (Node's default scrypt cost); upgraded on the next successful sign-in
    const [saltStr, hashHex] = s.split(':');
    if (!saltStr || !hashHex) return false;
    params = {}; salt = saltStr; expected = Buffer.from(hashHex, 'hex');
  }
  const actual = await scrypt(String(password), salt, expected.length, params);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const needsRehash = stored => !String(stored).startsWith(`scrypt$${COST}$`);

// Used to spend the same time on unknown emails as on real ones, so response times
// don't reveal which emails have accounts
let dummyHash;
async function burnTime(password) {
  dummyHash ||= await hashPassword('dummy-password-for-timing-1');
  await checkPassword(password, dummyHash);
}

// What may leave the server (never the password hash)
const publicFields = u => (u ? {
  id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role,
  email_verified: !!u.email_verified_at, created_at: u.created_at,
  // approved "List your property" request → may add listings from the website
  is_owner: !!db.prepare("SELECT 1 FROM listing_requests WHERE email=? AND status='approved'").get(u.email),
} : null);

const User = {
  ROLES,
  publicFields,
  burnTime,
  hashPassword,
  checkHash: checkPassword, // (password, stored hash)

  findById(id) {
    return db.prepare('SELECT * FROM users WHERE id=?').get(id);
  },

  findByEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email=?').get(String(email).toLowerCase());
  },

  async create({ name, email, phone, password }) {
    const hash = await hashPassword(password);
    const r = db.prepare("INSERT INTO users (name,email,phone,pass_hash,email_verified_at) VALUES (?,?,?,?,datetime('now'))")
      .run(name, String(email).toLowerCase(), phone, hash);
    return this.findById(r.lastInsertRowid);
  },

  /**
   * Returns the full user row when the credentials are correct, otherwise null.
   * Takes the same time whether or not the email exists.
   */
  async verify(email, password) {
    const u = this.findByEmail(email);
    if (!u) { await burnTime(password); return null; }
    if (!(await checkPassword(password, u.pass_hash))) return null;
    if (needsRehash(u.pass_hash)) {
      db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(await hashPassword(password), u.id);
    }
    return u;
  },

  checkPassword(user, password) {
    return checkPassword(password, user.pass_hash);
  },

  /** Changes the password and invalidates every existing token of this user */
  async changePassword(id, newPassword) {
    const hash = await hashPassword(newPassword);
    db.prepare('UPDATE users SET pass_hash=?, token_version=token_version+1 WHERE id=?').run(hash, id);
    return this.findById(id);
  },

  markVerified(id) {
    db.prepare("UPDATE users SET email_verified_at=COALESCE(email_verified_at, datetime('now')) WHERE id=?").run(id);
    return this.findById(id);
  },

  /** Invalidates every access token issued so far ("sign out everywhere") */
  bumpTokenVersion(id) {
    db.prepare('UPDATE users SET token_version=token_version+1 WHERE id=?').run(id);
    return this.findById(id);
  },

  remove(id) {
    return db.prepare('DELETE FROM users WHERE id=?').run(id).changes;
  },

  list() {
    return db.prepare(`SELECT u.id,u.name,u.email,u.phone,u.role,u.created_at,u.email_verified_at,
      (SELECT COUNT(*) FROM wishlist w WHERE w.user_id=u.id) AS saved
      FROM users u ORDER BY u.created_at DESC, u.id DESC`).all();
  },

  count() {
    return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  },

  // ── Wishlist ──
  wishlist(userId) {
    return db.prepare('SELECT property_id FROM wishlist WHERE user_id=?').all(userId).map(r => r.property_id);
  },

  setWishlist(userId, ids) {
    const clean = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))].slice(0, 500);
    db.transaction(() => {
      db.prepare('DELETE FROM wishlist WHERE user_id=?').run(userId);
      // INSERT ... SELECT skips ids of properties that no longer exist
      const ins = db.prepare('INSERT OR IGNORE INTO wishlist (user_id,property_id) SELECT ?, id FROM properties WHERE id=?');
      clean.forEach(id => ins.run(userId, id));
    })();
    return this.wishlist(userId);
  },
};

module.exports = User;
