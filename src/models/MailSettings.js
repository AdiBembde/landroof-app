'use strict';
// Outgoing email (SMTP) settings edited from the admin panel ("Email Settings").
// Saved settings take priority over SMTP_* / MAIL_FROM / ADMIN_EMAIL in .env; with nothing saved,
// the .env values are used. The SMTP password is stored encrypted (AES-256-GCM, key derived from
// the JWT secret) and is never sent back to the browser.
const crypto = require('crypto');
const db = require('../config/database');
const env = require('../config/env');
const SECRET = require('../config/jwtSecret');
const { str, isEmail } = require('../utils/validators');

const KEY = 'mail_settings'; // one JSON row in site_config (not part of the public site settings)
const cipherKey = crypto.createHash('sha256').update('landroof-mail:' + SECRET).digest();

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cipherKey, iv);
  const data = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}

function decrypt(blob) {
  try {
    const [iv, tag, data] = String(blob).split('.').map(s => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', cipherKey, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch { return ''; } // JWT secret changed: the password has to be entered again
}

function readSaved() {
  try { return JSON.parse(db.prepare('SELECT value FROM site_config WHERE key=?').get(KEY)?.value || 'null'); } catch { return null; }
}

const fromEnv = () => ({
  host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, user: env.SMTP_USER, pass: env.SMTP_PASS,
  from: env.MAIL_FROM, admin_email: env.ADMIN_EMAIL,
});

const MailSettings = {
  /** The settings the mailer uses right now, with the password; source: 'admin' | 'env' */
  current() {
    const saved = readSaved();
    if (!saved) return { ...fromEnv(), source: 'env' };
    return { ...saved, pass: saved.pass ? decrypt(saved.pass) : '', source: 'admin' };
  },

  /** Safe for the admin panel: no password */
  view() {
    const c = this.current();
    return {
      source: c.source, host: c.host || '', port: c.port || 587, secure: !!c.secure, user: c.user || '',
      has_password: !!c.pass, from: c.from || '', admin_email: c.admin_email || '', configured: !!c.host,
    };
  },

  /** Validates and saves. An empty password keeps the saved one. Returns {data} or {error, fields}. */
  save(b = {}) {
    const host = str(b.host, 120);
    const port = parseInt(b.port, 10);
    const user = str(b.user, 254);
    const from = str(b.from, 200);
    const adminEmail = str(b.admin_email, 254).toLowerCase();
    const fields = {};
    if (host && !/^[a-z0-9.-]+$/i.test(host)) fields.host = 'Enter a server name like smtp.gmail.com';
    if (!(port >= 1 && port <= 65535)) fields.port = 'Port must be a number, usually 465 or 587';
    if (from) {
      const addr = (/<([^>]+)>\s*$/.exec(from) || [, from])[1].trim();
      if (!isEmail(addr)) fields.from = 'Use "Name <email@example.com>" or just an email address';
    }
    if (adminEmail && !isEmail(adminEmail)) fields.admin_email = 'Enter a valid email address';
    if (Object.keys(fields).length) return { error: Object.values(fields)[0], fields };

    const prev = readSaved();
    const typed = typeof b.pass === 'string' ? b.pass.replace(/\s+/g, '') : ''; // Gmail shows app passwords in groups of 4
    let pass = prev?.pass || '';
    if (!prev && !typed && env.SMTP_PASS && (user || env.SMTP_USER) === env.SMTP_USER) pass = encrypt(env.SMTP_PASS); // first save keeps the .env password
    if (typed) pass = encrypt(typed);
    if (b.clear_password) pass = '';
    const value = { host, port, secure: b.secure === true || b.secure === '1' || b.secure === 'true', user, pass, from, admin_email: adminEmail };
    db.prepare(`INSERT INTO site_config (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(KEY, JSON.stringify(value));
    return { data: this.view() };
  },

  /** Forget the admin settings and go back to .env */
  reset() {
    db.prepare('DELETE FROM site_config WHERE key=?').run(KEY);
    return this.view();
  },
};

module.exports = MailSettings;
