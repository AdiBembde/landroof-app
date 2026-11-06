'use strict';
// The admin account. The username comes from .env (ADMIN_USER). The password is ADMIN_PASS
// from .env until it is changed from the dashboard; after that a scrypt hash in the database wins.
const crypto = require('crypto');
const db = require('../config/database');
const { ADMIN_USER, ADMIN_PASS, ADMIN_TOTP_SECRET } = require('../config/env');
const { hashPassword, checkHash } = require('./User');
const TOTP = require('../services/totp');

let lastOtpStep = -1; // a code can be used only once

// Constant-time comparison (hashing first makes the lengths equal)
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const storedHash = () => db.prepare('SELECT pass_hash FROM admin_credentials WHERE id=1').get()?.pass_hash || '';

// Short fingerprint of the current credentials. It is embedded in every admin token,
// so changing the username or password signs every admin out automatically.
const fingerprintOf = secret => crypto.createHash('sha256').update(`${ADMIN_USER}:${secret}`).digest('hex').slice(0, 16);

// A good admin password: 12+ characters with letters and numbers (same rule as ADMIN_PASS)
function passwordProblem(password) {
  const p = String(password || '');
  if (p.length < 12) return 'Use at least 12 characters';
  if (p.length > 128) return 'Use at most 128 characters';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Use both letters and numbers';
  return '';
}

const Admin = {
  username: ADMIN_USER,
  role: 'admin',

  get fingerprint() {
    return fingerprintOf(storedHash() || ADMIN_PASS);
  },

  async checkCredentials(username, password) {
    // Evaluate both so timing doesn't reveal which one was wrong
    const userOk = safeEqual(username, ADMIN_USER);
    const hash = storedHash();
    const passOk = hash ? await checkHash(password, hash) : safeEqual(password, ADMIN_PASS);
    return userOk && passOk;
  },

  passwordProblem,

  /** Saves a new password; every existing admin token stops working (the fingerprint changes) */
  async setPassword(password) {
    const hash = await hashPassword(password);
    db.prepare(`INSERT INTO admin_credentials (id, pass_hash, updated_at) VALUES (1, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET pass_hash=excluded.pass_hash, updated_at=excluded.updated_at`).run(hash);
  },

  /** 2-step login is on when ADMIN_TOTP_SECRET is set in .env */
  otpEnabled: !!ADMIN_TOTP_SECRET,

  /** Checks a 6-digit authenticator code; each code works only once */
  checkOtp(code) {
    const s = TOTP.verify(ADMIN_TOTP_SECRET, String(code || '').replace(/\s/g, ''));
    if (s === null || s <= lastOtpStep) return false;
    lastOtpStep = s;
    return true;
  },
};

module.exports = Admin;
