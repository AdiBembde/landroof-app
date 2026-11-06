'use strict';
// NA order, land-use, layout approval and MahaRERA details of a project. The website shows one only
// after a staff member reviewed it against current documents (reviewed_at is set).
const db = require('../config/database');
const { str, toInt } = require('../utils/validators');

const KINDS = { na: 'NA (Non-Agricultural) order', landuse: 'Land-use / zone certificate', layout: 'Layout approval', rera: 'MahaRERA registration', other: 'Other approval' };

const ProjectApproval = {
  KINDS,

  clean(b = {}) {
    const kind = KINDS[b.kind] ? b.kind : null;
    if (!kind) return { error: 'Choose the approval type' };
    const reference = str(b.reference, 80);
    if (!reference) return { error: 'Enter the order / registration number' };
    return { data: { kind, reference, authority: str(b.authority, 120), issued_on: str(b.issued_on, 10), document_id: toInt(b.document_id) } };
  },

  forProperty(propertyId, { reviewedOnly = false } = {}) {
    return db.prepare(`SELECT * FROM project_approvals WHERE property_id=? ${reviewedOnly ? 'AND reviewed_at IS NOT NULL' : ''} ORDER BY id`).all(propertyId);
  },

  find(id) {
    return db.prepare('SELECT * FROM project_approvals WHERE id=?').get(id);
  },

  create(propertyId, d) {
    const r = db.prepare('INSERT INTO project_approvals (property_id,kind,reference,authority,issued_on,document_id) VALUES (?,?,?,?,?,?)')
      .run(propertyId, d.kind, d.reference, d.authority, d.issued_on, d.document_id);
    return this.find(r.lastInsertRowid);
  },

  /** Any change to the details clears the review; it must be reviewed again */
  update(id, d) {
    db.prepare('UPDATE project_approvals SET kind=?, reference=?, authority=?, issued_on=?, document_id=?, reviewed_at=NULL, reviewed_by=NULL WHERE id=?')
      .run(d.kind, d.reference, d.authority, d.issued_on, d.document_id, id);
    return this.find(id);
  },

  setReviewed(id, reviewed, by) {
    db.prepare(`UPDATE project_approvals SET reviewed_at=${reviewed ? 'CURRENT_TIMESTAMP' : 'NULL'}, reviewed_by=? WHERE id=?`).run(reviewed ? by : null, id);
    return this.find(id);
  },

  remove(id) {
    return db.prepare('DELETE FROM project_approvals WHERE id=?').run(id).changes;
  },

  publicView: a => ({ kind: a.kind, label: KINDS[a.kind], reference: a.reference, authority: a.authority, issued_on: a.issued_on,
    reviewed_at: a.reviewed_at, document_url: a.document_id ? `/api/documents/${a.document_id}` : null }),
};

module.exports = ProjectApproval;
