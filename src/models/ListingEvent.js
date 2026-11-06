'use strict';
// A listing's history: submitted, review decisions, corrections asked, verification, sold / rented,
// plot status changes. Kept with the listing so staff can see who changed what and why.
const db = require('../config/database');

const ListingEvent = {
  record(propertyId, actor, action, { from = null, to = null, note = null } = {}) {
    db.prepare('INSERT INTO listing_events (property_id,actor,action,from_status,to_status,note) VALUES (?,?,?,?,?,?)')
      .run(propertyId, actor, action, from, to, note ? String(note).slice(0, 1000) : null);
  },

  forProperty(propertyId, limit = 200) {
    return db.prepare('SELECT * FROM listing_events WHERE property_id=? ORDER BY created_at DESC, id DESC LIMIT ?').all(propertyId, limit);
  },

  /** The owner sees the steps but not which staff member took them */
  forOwner(propertyId) {
    return this.forProperty(propertyId, 50)
      .filter(e => !e.action.startsWith('plot.') && e.action !== 'admin.edit')
      .map(({ actor, ...e }) => ({ ...e, by: actor.startsWith('admin:') ? 'Landroof team' : actor === 'system' ? 'System' : 'You' }));
  },
};

module.exports = ListingEvent;
