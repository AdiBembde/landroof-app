'use strict';
// Append-only record of security-relevant events, shown in Admin → Activity Log.
const db = require('../config/database');

const s = (v, n) => String(v ?? '').slice(0, n);

const AuditLog = {
  /**
   * @param {object} e
   * @param {string} e.actor   'admin:<name>', 'user:<id>' or 'anonymous'
   * @param {string} e.action  e.g. 'admin.login', 'admin.login_failed', 'create', 'user.password_reset'
   * @param {import('express').Request} [e.req]  used for IP and browser
   */
  record({ actor, action, target = '', targetId = '', details = '', req }) {
    try {
      db.prepare(`INSERT INTO audit_log (actor,action,target,target_id,ip_address,user_agent,details)
        VALUES (?,?,?,?,?,?,?)`).run(s(actor, 80), s(action, 60), s(target, 60), s(targetId, 40),
        s(req?.ip, 60), s(req?.headers?.['user-agent'], 300), s(typeof details === 'string' ? details : JSON.stringify(details), 500));
    } catch (e) {
      console.error('Audit log write failed:', e.message);
    }
  },

  list({ limit = 200, action = '' } = {}) {
    const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 2000);
    if (action) return db.prepare('SELECT * FROM audit_log WHERE action LIKE ? ORDER BY id DESC LIMIT ?').all(`${action}%`, n);
    return db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(n);
  },

  purge(days = 365) {
    db.prepare("DELETE FROM audit_log WHERE created_at<=datetime('now',?)").run(`-${days} days`);
  },
};

module.exports = AuditLog;
