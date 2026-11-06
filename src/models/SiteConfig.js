'use strict';
// Admin-editable site-wide settings ("Site Numbers" page).
const db = require('../config/database');
const { str } = require('../utils/validators');

// key → default value. Only these keys can be stored.
const DEFAULTS = {
  active_listings:   '4200',
  cities_covered:    '18',
  happy_clients:     '1200',
  satisfaction_rate: '98',
  properties_sold:   '12000',
  years_experience:  '15',
  whatsapp_number:   '917083853002',
  contact_email:     'info@landroof.com',
  contact_phone:     '+91 70838 53002',
};

const NUMERIC = ['active_listings', 'cities_covered', 'happy_clients', 'satisfaction_rate', 'properties_sold', 'years_experience'];

const SiteConfig = {
  KEYS: Object.keys(DEFAULTS),

  seedDefaults() {
    const ins = db.prepare('INSERT OR IGNORE INTO site_config (key,value) VALUES (?,?)');
    Object.entries(DEFAULTS).forEach(([k, v]) => ins.run(k, v));
  },

  getAll() {
    const cfg = { ...DEFAULTS };
    db.prepare('SELECT key, value FROM site_config').all().forEach(r => {
      if (r.key in DEFAULTS) cfg[r.key] = r.value;
    });
    return cfg;
  },

  /** Validates and saves the given keys; unknown keys are ignored. Returns {error} or {data}. */
  update(input = {}) {
    const updates = {};
    for (const key of this.KEYS) {
      if (input[key] === undefined) continue;
      let v = str(input[key], 200);
      if (NUMERIC.includes(key)) {
        v = v.replace(/[^\d]/g, '');
        if (v === '') return { error: `${key.replace(/_/g, ' ')} must be a number` };
      }
      if (key === 'satisfaction_rate' && +v > 100) return { error: 'Satisfaction rate cannot be above 100' };
      if (key === 'whatsapp_number') {
        v = v.replace(/\D/g, '');
        if (v && (v.length < 10 || v.length > 15)) return { error: 'WhatsApp number must be country code + number, 10–15 digits' };
      }
      if (key === 'contact_email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { error: 'Contact email is not valid' };
      updates[key] = v;
    }
    const stmt = db.prepare(`INSERT INTO site_config (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`);
    db.transaction(() => Object.entries(updates).forEach(([k, v]) => stmt.run(k, v)))();
    return { data: this.getAll() };
  },
};

module.exports = SiteConfig;
