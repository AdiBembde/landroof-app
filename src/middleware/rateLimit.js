'use strict';
// Fixed-window rate limiter backed by SQLite, so counters survive restarts and are shared by
// every process that uses the same database file.
//
// Keys are usually the client IP (req.ip). Behind nginx or a load balancer set TRUST_PROXY=1,
// otherwise every visitor appears to come from the proxy's IP.
const db = require('../config/database');

const getStmt = db.prepare('SELECT count, window_start FROM rate_limits WHERE key=?');
const upsert = db.prepare(`INSERT INTO rate_limits (key,count,window_start) VALUES (?,?,?)
  ON CONFLICT(key) DO UPDATE SET count=excluded.count, window_start=excluded.window_start`);
const delStmt = db.prepare('DELETE FROM rate_limits WHERE key=?');

function createLimiter({ name, max, windowMs, message = 'Too many requests. Please try again later.' }) {
  const k = key => `${name}:${key}`;

  function current(key) {
    const row = getStmt.get(k(key));
    if (!row || Date.now() - row.window_start > windowMs) return { count: 0, start: Date.now() };
    return { count: row.count, start: row.window_start };
  }

  return {
    message,
    isBlocked: key => current(key).count >= max,
    hit(key) {
      const c = current(key);
      upsert.run(k(key), c.count + 1, c.start);
    },
    reset: key => { delStmt.run(k(key)); },
    /** Middleware that counts every request from an IP */
    middleware() {
      return (req, res, next) => {
        const c = current(req.ip);
        if (c.count >= max) return res.status(429).json({ error: message });
        upsert.run(k(req.ip), c.count + 1, c.start);
        next();
      };
    },
  };
}

const MIN = 60 * 1000;
const limiters = {
  adminLogin:   createLimiter({ name: 'admin-login', max: 10, windowMs: 15 * MIN, message: 'Too many failed login attempts. Try again in 15 minutes.' }),
  // Counts failures from ALL IPs together, so a distributed password-guessing attack is also stopped
  adminAccount: createLimiter({ name: 'admin-account', max: 30, windowMs: 15 * MIN, message: 'The admin account is temporarily locked after many failed logins. Try again in 15 minutes.' }),
  userLogin:    createLimiter({ name: 'user-login', max: 15, windowMs: 15 * MIN, message: 'Too many failed sign-in attempts. Try again in 15 minutes.' }),
  register:     createLimiter({ name: 'register', max: 10, windowMs: 60 * MIN }),
  emailLinks:   createLimiter({ name: 'email-links', max: 5, windowMs: 60 * MIN, message: 'Too many email requests. Please try again in an hour.' }),
  refresh:      createLimiter({ name: 'refresh', max: 120, windowMs: 15 * MIN }),
  leads:        createLimiter({ name: 'leads', max: 30, windowMs: 10 * MIN }),
};

// Housekeeping: drop expired counters every 10 minutes
setInterval(() => {
  try { db.prepare('DELETE FROM rate_limits WHERE window_start < ?').run(Date.now() - 2 * 60 * MIN); } catch { /* db closed */ }
}, 10 * MIN).unref();

module.exports = { createLimiter, limiters };
