'use strict';
// Plot inventory of a project. Only staff change it; every status change is logged on the listing.
const db = require('../config/database');
const { str, toInt } = require('../utils/validators');

const STATUSES = ['available', 'hold', 'booked', 'sold'];

function clean(b = {}, partial = false) {
  const d = {};
  const set = (k, v) => { if (!partial || b[k] !== undefined) d[k] = v; };
  set('plot_no', str(b.plot_no, 20));
  set('block', str(b.block, 40));
  set('area_sqft', toInt(b.area_sqft));
  set('rate_sqft', toInt(b.rate_sqft));
  set('total_price', toInt(b.total_price));
  set('facing', str(b.facing, 30));
  set('frontage', str(b.frontage, 30));
  if (!partial || b.status !== undefined) d.status = STATUSES.includes(b.status) ? b.status : 'available';
  if (!partial && !d.plot_no) return { error: 'Plot number is required' };
  if (partial && d.plot_no === '') return { error: 'Plot number is required' };
  // Total = area × rate when not given
  if (d.total_price == null && d.area_sqft && d.rate_sqft) d.total_price = d.area_sqft * d.rate_sqft;
  return { data: d };
}

const Plot = {
  STATUSES,
  clean,

  forProperty(propertyId) {
    // Natural order: "2" before "10", then by block
    return db.prepare('SELECT * FROM plots WHERE property_id=? ORDER BY COALESCE(block,\'\'), sort_idx, CAST(plot_no AS INTEGER), plot_no').all(propertyId);
  },

  find(id) {
    return db.prepare('SELECT * FROM plots WHERE id=?').get(id);
  },

  create(propertyId, d) {
    const n = toInt(String(d.plot_no).replace(/\D/g, '')) || 0;
    const r = db.prepare(`INSERT INTO plots (property_id,plot_no,block,area_sqft,rate_sqft,total_price,facing,frontage,status,sort_idx)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(propertyId, d.plot_no, d.block || null, d.area_sqft, d.rate_sqft, d.total_price, d.facing || null, d.frontage || null, d.status, n);
    return this.find(r.lastInsertRowid);
  },

  update(id, d) {
    const cols = Object.keys(d);
    if (cols.length) db.prepare(`UPDATE plots SET ${cols.map(c => `${c}=?`).join(',')}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c => d[c]), id);
    return this.find(id);
  },

  remove(id) {
    return db.prepare('DELETE FROM plots WHERE id=?').run(id).changes;
  },

  counts(propertyId) {
    const out = { total: 0, available: 0, hold: 0, booked: 0, sold: 0 };
    db.prepare('SELECT status, COUNT(*) AS n FROM plots WHERE property_id=? GROUP BY status').all(propertyId)
      .forEach(r => { out[r.status] = r.n; out.total += r.n; });
    return out;
  },

  /** What visitors see (no internal ids beyond the row id) */
  publicView: p => ({ id: p.id, plot_no: p.plot_no, block: p.block, area_sqft: p.area_sqft, rate_sqft: p.rate_sqft,
    total_price: p.total_price, facing: p.facing, frontage: p.frontage, status: p.status, updated_at: p.updated_at }),
};

module.exports = Plot;
