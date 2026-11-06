'use strict';
const db = require('../config/database');
const { str, toInt } = require('../utils/validators');
const { FORMS, validateForm } = require('../../shared/validation');

// Every website form that creates a lead, and the rules for its contact fields
const SOURCES = ['search', 'property-enquiry', 'site-visit', 'search-alert', 'list-property', 'investment-enquiry', 'contact', 'register'];

const CSV_COLUMNS = [
  ['ID', r => r.id], ['Email', r => r.email], ['Phone', r => r.phone], ['Name', r => r.name],
  ['City', r => r.search_city], ['Type', r => r.search_type], ['Budget', r => r.search_budget],
  ['BHK', r => r.search_bhk], ['Source', r => r.source], ['Property ID', r => r.property_id],
  ['Message', r => r.message], ['Device', r => r.device_type], ['IP Address', r => r.ip_address],
  ['Timezone', r => r.timezone], ['Screen', r => (r.screen_w && r.screen_h ? `${r.screen_w}x${r.screen_h}` : '')],
  ['Session ID', r => r.session_id], ['Referrer', r => r.referrer], ['Language', r => r.language],
  ['Created At (UTC)', r => r.created_at],
];

function detectDevice(ua) {
  if (!ua) return 'unknown';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/tablet/i.test(ua)) return 'tablet';
  if (/mobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

// Prevents spreadsheet formula injection (=, +, -, @ at the start of a cell)
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

const Lead = {
  SOURCES,

  /**
   * Cleans visitor input using the same rules as the browser (shared/validation.js):
   * each form ("source") has its own required fields; email, mobile and name are always
   * format-checked and normalised. Numeric fields are forced to integers.
   * Returns { data } or { error, fields } where fields maps field name → message.
   */
  validate(b = {}) {
    const source = str(b.source, 40) || 'search';
    if (!SOURCES.includes(source)) return { error: 'Unknown form', fields: {} };

    // Form-specific rules, plus format checks for contact fields every form may send
    // ("register" leads are created by the server after the account form was already validated)
    const form = { name: ['name', {}], email: ['email', {}], phone: ['phone', {}], ...(source === 'register' ? {} : FORMS[source]) };
    const { valid, values, errors } = validateForm(form, b);
    if (!valid) return { error: Object.values(errors)[0], fields: errors };

    // The contact form's subject is stored at the start of the message
    let message = str(values.message ?? b.message, 2000);
    if (source === 'contact' && b.subject) message = `[${str(b.subject, 60)}] ${message}`;

    return {
      data: {
        email:         values.email,
        phone:         values.phone,
        name:          values.name,
        search_city:   str(values.search_city ?? b.search_city, 80),
        search_type:   str(b.search_type, 40),
        search_budget: str(b.search_budget, 60),
        search_bhk:    str(b.search_bhk, 20),
        source,
        property_id:   toInt(b.property_id),
        message,
        referrer:      str(b.referrer, 500),
        screen_w:      toInt(b.screen_w),
        screen_h:      toInt(b.screen_h),
        session_id:    str(b.session_id, 60),
        timezone:      str(b.timezone, 60),
        language:      str(b.language, 20),
      },
    };
  },

  create(data, { ip = '', userAgent = '' } = {}) {
    const row = { ...data, ip_address: str(ip, 60), user_agent: str(userAgent, 500), device_type: detectDevice(userAgent) };
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO leads (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map(c => row[c]));
  },

  list(limit = 500) {
    const n = Math.min(Math.max(toInt(limit) || 500, 1), 50000);
    return db.prepare('SELECT * FROM leads ORDER BY created_at DESC, id DESC LIMIT ?').all(n);
  },

  toCSV(rows) {
    const header = CSV_COLUMNS.map(([h]) => csvCell(h)).join(',');
    return [header, ...rows.map(r => CSV_COLUMNS.map(([, get]) => csvCell(get(r))).join(','))].join('\n');
  },

  stats() {
    return {
      total: db.prepare('SELECT COUNT(*) AS n FROM leads').get().n,
      today: db.prepare("SELECT COUNT(*) AS n FROM leads WHERE date(created_at)=date('now')").get().n,
      bySource: db.prepare('SELECT source, COUNT(*) AS n FROM leads GROUP BY source ORDER BY n DESC').all(),
      latest: db.prepare('SELECT * FROM leads ORDER BY created_at DESC, id DESC LIMIT 5').all(),
    };
  },

  remove(id) {
    return db.prepare('DELETE FROM leads WHERE id=?').run(id).changes;
  },

  removeByEmail(email) {
    return db.prepare('DELETE FROM leads WHERE lower(email)=lower(?)').run(email).changes;
  },

  /**
   * Data retention: blanks IP / browser details after ipDays, deletes leads after leadDays.
   * Returns how many rows were changed.
   */
  applyRetention(leadDays, ipDays) {
    const deleted = db.prepare("DELETE FROM leads WHERE created_at<=datetime('now',?)").run(`-${leadDays} days`).changes;
    const anonymised = db.prepare(`UPDATE leads SET ip_address='', user_agent='', screen_w=NULL, screen_h=NULL, timezone='', referrer=''
      WHERE created_at<=datetime('now',?) AND (ip_address<>'' OR user_agent<>'')`).run(`-${ipDays} days`).changes;
    return { deleted, anonymised };
  },
};

module.exports = Lead;
