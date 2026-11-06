'use strict';
// Generic model for the simple admin-managed content tables
// (testimonials, team, events, announcements, schemes, social posts, media).
const db = require('../config/database');
const { sanitize } = require('../utils/validators');
const { uploadUrl } = require('../utils/files');

class ContentModel {
  /**
   * @param {object} opts
   * @param {string} opts.table      SQL table name
   * @param {object} opts.schema     field rules (see utils/validators.js)
   * @param {string} opts.orderBy    ORDER BY clause
   * @param {string} [opts.imageField] column holding an uploaded filename
   * @param {boolean} [opts.imageRequired] creation needs an image (media gallery)
   * @param {boolean} [opts.hasActive] table has an is_active column (default true)
   * @param {number} [opts.publicLimit] max rows returned to the public site
   */
  constructor({ table, schema, orderBy, imageField = null, imageRequired = false, hasActive = true, publicLimit = 100 }) {
    Object.assign(this, { table, schema, orderBy, imageField, imageRequired, hasActive, publicLimit });
  }

  toJSON(row) {
    if (!row) return row;
    return this.imageField ? { ...row, image_url: uploadUrl(row[this.imageField]) } : row;
  }

  all() {
    return db.prepare(`SELECT * FROM ${this.table} ORDER BY ${this.orderBy}`).all().map(r => this.toJSON(r));
  }

  allPublic() {
    const where = this.hasActive ? 'WHERE is_active=1' : '';
    return db.prepare(`SELECT * FROM ${this.table} ${where} ORDER BY ${this.orderBy} LIMIT ?`)
      .all(this.publicLimit).map(r => this.toJSON(r));
  }

  find(id) {
    return this.toJSON(db.prepare(`SELECT * FROM ${this.table} WHERE id=?`).get(id));
  }

  validate(input, partial) {
    return sanitize(this.schema, input, { partial });
  }

  create(data) {
    const cols = Object.keys(data);
    const r = db.prepare(`INSERT INTO ${this.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map(c => data[c]));
    return this.find(r.lastInsertRowid);
  }

  update(id, data) {
    const cols = Object.keys(data);
    if (cols.length) {
      db.prepare(`UPDATE ${this.table} SET ${cols.map(c => `${c}=?`).join(',')} WHERE id=?`)
        .run(...cols.map(c => data[c]), id);
    }
    return this.find(id);
  }

  remove(id) {
    const row = db.prepare(`SELECT * FROM ${this.table} WHERE id=?`).get(id);
    if (row) db.prepare(`DELETE FROM ${this.table} WHERE id=?`).run(id);
    return row;
  }
}

module.exports = ContentModel;
