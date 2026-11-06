'use strict';
// Listing documents. Files live in DOCS_DIR (never in the public folder) and are private by default:
// only staff can download them until an admin marks one as public (e.g. a brochure).
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { DOCS_DIR } = require('../config/env');

fs.mkdirSync(DOCS_DIR, { recursive: true });

const KINDS = ['brochure', 'layout', 'approval', 'title', 'other'];

const PropertyDocument = {
  KINDS,

  create({ propertyId, kind, title, file, uploadedBy }) {
    const r = db.prepare(`INSERT INTO property_documents (property_id,kind,title,filename,original_name,mime,size,uploaded_by)
        VALUES (?,?,?,?,?,?,?,?)`)
      .run(propertyId, KINDS.includes(kind) ? kind : 'other', String(title || file.originalname || '').slice(0, 120),
        file.filename, String(file.originalname || '').slice(0, 200), file.mimetype, file.size, uploadedBy);
    return this.find(r.lastInsertRowid);
  },

  find(id) {
    return db.prepare('SELECT * FROM property_documents WHERE id=?').get(id);
  },

  forProperty(propertyId, { publicOnly = false } = {}) {
    return db.prepare(`SELECT * FROM property_documents WHERE property_id=? ${publicOnly ? 'AND is_public=1' : ''} ORDER BY created_at DESC, id DESC`)
      .all(propertyId);
  },

  update(id, { is_public, title, kind }) {
    const doc = this.find(id);
    if (!doc) return null;
    db.prepare('UPDATE property_documents SET is_public=?, title=?, kind=? WHERE id=?').run(
      is_public === undefined ? doc.is_public : (is_public ? 1 : 0),
      title === undefined ? doc.title : String(title).slice(0, 120),
      KINDS.includes(kind) ? kind : doc.kind, id);
    return this.find(id);
  },

  remove(id) {
    const doc = this.find(id);
    if (!doc) return null;
    db.prepare('DELETE FROM property_documents WHERE id=?').run(id);
    this.deleteFile(doc.filename);
    return doc;
  },

  removeForProperty(propertyId) {
    this.forProperty(propertyId).forEach(d => this.deleteFile(d.filename));
    db.prepare('DELETE FROM property_documents WHERE property_id=?').run(propertyId);
  },

  /** basename() keeps every path inside DOCS_DIR */
  filePath(filename) {
    return path.join(DOCS_DIR, path.basename(String(filename)));
  },

  deleteFile(filename) {
    try { fs.unlinkSync(this.filePath(filename)); } catch { /* already gone */ }
  },

  /** Fields safe to show on the website */
  publicView: d => ({ id: d.id, kind: d.kind, title: d.title || d.original_name, mime: d.mime, size: d.size, url: `/api/documents/${d.id}` }),
};

module.exports = PropertyDocument;
