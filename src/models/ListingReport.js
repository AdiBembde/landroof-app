'use strict';
// "Report this listing" — visitors flag wrong or misleading information
const db = require('../config/database');
const { str, isEmail } = require('../utils/validators');

const REASONS = ['Wrong price', 'Already sold or rented', 'Wrong location', 'Photos do not match', 'Fake or duplicate listing', 'Owner or agent not reachable', 'Other'];

const ListingReport = {
  REASONS,

  validate(b = {}) {
    const reason = str(b.reason, 60);
    if (!REASONS.includes(reason)) return { error: 'Please choose what is wrong', fields: { reason: 'Please choose what is wrong' } };
    const details = str(b.details, 1000);
    if (reason === 'Other' && details.length < 10) return { error: 'Please tell us what is wrong', fields: { details: 'Please tell us what is wrong (at least 10 characters)' } };
    const email = str(b.email, 254).toLowerCase();
    if (email && !isEmail(email)) return { error: 'Enter a valid email address', fields: { email: 'Enter a valid email address' } };
    return { data: { reason, details, email } };
  },

  create(propertyId, d, ip) {
    db.prepare('INSERT INTO listing_reports (property_id,reason,details,email,ip_address) VALUES (?,?,?,?,?)')
      .run(propertyId, d.reason, d.details, d.email, str(ip, 60));
  },

  list(status = '') {
    return db.prepare(`SELECT r.*, p.title AS property_title FROM listing_reports r LEFT JOIN properties p ON p.id=r.property_id
        ${status ? 'WHERE r.status=?' : ''} ORDER BY r.created_at DESC, r.id DESC LIMIT 500`).all(...(status ? [status] : []));
  },

  openCount() {
    return db.prepare("SELECT COUNT(*) AS n FROM listing_reports WHERE status='open'").get().n;
  },

  decide(id, status, note) {
    if (!['open', 'resolved', 'dismissed'].includes(status)) return null;
    const r = db.prepare(`UPDATE listing_reports SET status=?, admin_note=?, resolved_at=${status === 'open' ? 'NULL' : 'CURRENT_TIMESTAMP'} WHERE id=?`)
      .run(status, str(note, 500) || null, id);
    return r.changes ? db.prepare('SELECT * FROM listing_reports WHERE id=?').get(id) : null;
  },

  removeByEmail(email) {
    return db.prepare('DELETE FROM listing_reports WHERE lower(email)=lower(?)').run(email).changes;
  },
};

module.exports = ListingReport;
