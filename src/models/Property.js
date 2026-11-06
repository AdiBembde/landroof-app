'use strict';
const db = require('../config/database');
const { sanitize, toInt } = require('../utils/validators');
const { uploadUrl } = require('../utils/files');

const TYPES = ['buy', 'rent', 'plots', 'commercial'];
const FURNISHING = ['', 'Furnished', 'Semi-Furnished', 'Unfurnished'];
const AGE_BANDS = ['', 'New / Under construction', 'Less than 1 year', '1-5 years', '5-10 years', '10+ years'];
const LISTED_BY = ['landroof', 'owner', 'agent', 'developer'];
// review_status: draft → pending (submitted) → under_review → approved | rejected | changes (corrections asked)
const REVIEW_STATUSES = ['draft', 'pending', 'under_review', 'changes', 'approved', 'rejected'];
// listing_status of a published listing; only 'active' ones appear in search
const LISTING_STATUSES = ['active', 'sold', 'rented', 'expired', 'withdrawn'];
const AMENITIES = ['Lift', 'Parking', 'Power Backup', 'Security', 'Gym', 'Swimming Pool', 'Club House', 'Garden',
  "Children's Play Area", 'Gated Community', '24x7 Water', 'Air Conditioning', 'Modular Kitchen', 'Balcony',
  'Pet Friendly', 'Internal Roads', 'Compound Wall', 'Street Lights', 'Electricity', 'Drainage'];

const SCHEMA = {
  title:          { type: 'text', max: 200, required: true, label: 'Title' },
  type:           { type: 'enum', values: TYPES, default: 'buy' },
  subtype:        { type: 'text', max: 60 },
  price_label:    { type: 'text', max: 60, required: true, label: 'Price label' },
  price_val:      { type: 'int', min: 0, default: 0 },
  emi_label:      { type: 'text', max: 100 },
  area:           { type: 'text', max: 60 },
  beds:           { type: 'int', min: 0, max: 50, default: 0 },
  baths:          { type: 'int', min: 0, max: 50, default: 0 },
  status:         { type: 'text', max: 60, default: 'Ready to Move' },
  city:           { type: 'text', max: 80, required: true, label: 'City' },
  locality:       { type: 'text', max: 120 },
  description:    { type: 'text', max: 5000 },
  rera:           { type: 'text', max: 60 },
  is_featured:    { type: 'bool', default: 0 },
  furnishing:     { type: 'enum', values: FURNISHING, default: '' },
  possession:     { type: 'text', max: 60 },
  age_band:       { type: 'enum', values: AGE_BANDS, default: '' },
  amenities:      { type: 'text', max: 1000 },
  video_url:      { type: 'url', max: 300 },
  tour_url:       { type: 'url', max: 300 },
  lat:            { type: 'text', max: 20 },
  lng:            { type: 'text', max: 20 },
  listed_by:      { type: 'enum', values: LISTED_BY, default: 'landroof' },
  developer_name: { type: 'text', max: 120 },
  is_project:     { type: 'bool', default: 0 },
  rera_verified:  { type: 'bool', default: 0 },
};

// Only staff may set these; owners' values are ignored
const ADMIN_ONLY = ['is_featured', 'is_project', 'rera_verified', 'listed_by'];

// "1,480 sq ft" → 1480
function parseSqft(area) {
  const m = String(area || '').replace(/,/g, '').match(/\d+(\.\d+)?/);
  return m ? Math.round(parseFloat(m[0])) : null;
}

function galleryList(json) {
  try { return (JSON.parse(json || '[]') || []).filter(Boolean); } catch { return []; }
}

const isLeaseRow = p => p.type === 'rent' || /\/\s*mo|\/\s*month/i.test(p.price_label || '');
const listingCode = id => `LR${String(id).padStart(5, '0')}`;

function toJSON(row) {
  if (!row) return row;
  const rate = !isLeaseRow(row) && row.price_val > 0 && row.area_sqft > 0 ? Math.round(row.price_val / row.area_sqft) : null;
  return {
    ...row,
    listing_code: listingCode(row.id),
    image_url: uploadUrl(row.image),
    gallery_urls: galleryList(row.gallery).map(uploadUrl).filter(Boolean),
    floor_plan_url: uploadUrl(row.floor_plan),
    amenities_list: String(row.amenities || '').split(',').map(s => s.trim()).filter(Boolean),
    rate_sqft: rate,
    is_live: row.review_status === 'approved' && row.listing_status === 'active',
  };
}

// What visitors may see: no internal review notes, owner ids or staff names
const PRIVATE_FIELDS = ['owner_id', 'review_note', 'verified_by', 'duplicate_of', 'submitted_at', 'gallery', 'image', 'floor_plan'];
function publicJSON(row) {
  if (!row) return row;
  const out = { ...row };
  PRIVATE_FIELDS.forEach(k => delete out[k]);
  return out;
}

// "5000000-10000000" → [5000000, 10000000]; "50000000+" → [50000000, null]
function parseRange(v) {
  if (!v) return [null, null];
  const s = String(v);
  if (s.endsWith('+')) return [toInt(s.slice(0, -1)), null];
  const [a, b] = s.split('-').map(toInt);
  return [a, b];
}

const LIVE = "review_status='approved' AND listing_status='active'";
const SORTS = {
  newest:     'COALESCE(published_at, created_at) DESC, id DESC',
  price_asc:  'CASE WHEN price_val>0 THEN 0 ELSE 1 END, price_val ASC, id DESC',
  price_desc: 'price_val DESC, id DESC',
  area_desc:  'COALESCE(area_sqft,0) DESC, id DESC',
};

/**
 * WHERE clause for the listing filters. All filters are optional.
 * type, city, locality, q, featured, ids, budget/area/rate ("min-max" | "min+"), bhk ("2 BHK" | "4+ BHK"),
 * subtype, furnishing, possession ("ready" | "under-construction"), age (age band), amenities (comma list,
 * all required), transaction ("buy" | "lease"), verified, bounds ("south,west,north,east" for the map)
 */
function where(f, all) {
  // The public site only sees reviewed, active listings. Saved-list lookups (ids) also return sold/rented
  // ones so the visitor learns what happened to them. The admin panel passes { all: true }.
  let sql = all ? '1=1' : (f.ids ? "review_status='approved'" : LIVE);
  const p = [];

  // One type, or several ("buy,rent" = all residential)
  const types = String(f.type || '').split(',').filter(t => TYPES.includes(t));
  if (types.length) { sql += ` AND type IN (${types.map(() => '?').join(',')})`; p.push(...types); }
  if (f.city) { sql += ' AND city LIKE ?'; p.push(`%${f.city}%`); }
  if (f.locality) { sql += ' AND locality LIKE ?'; p.push(`%${f.locality}%`); }
  if (f.featured) sql += ' AND is_featured=1';
  if (f.project) sql += ' AND is_project=1';
  if (f.verified) sql += ' AND verified_at IS NOT NULL';
  if (f.q) {
    const q = `%${f.q}%`;
    const code = /^lr0*(\d+)$/i.exec(String(f.q).trim()); // "LR00012" finds listing 12
    sql += ` AND (title LIKE ? OR locality LIKE ? OR city LIKE ? OR description LIKE ? OR subtype LIKE ?${code ? ' OR id=?' : ''})`;
    p.push(q, q, q, q, q, ...(code ? [Number(code[1])] : []));
  }
  if (f.ids) {
    const ids = String(f.ids).split(',').map(Number).filter(Number.isInteger).slice(0, 200);
    sql += ids.length ? ` AND id IN (${ids.map(() => '?').join(',')})` : ' AND 0';
    p.push(...ids);
  }
  const range = (col, v) => {
    const [a, b] = parseRange(v);
    if (a !== null) { sql += ` AND ${col}>=?`; p.push(a); }
    if (b !== null) { sql += ` AND ${col}<=?`; p.push(b); }
  };
  range('price_val', f.budget);
  range('area_sqft', f.area);
  if (f.rate) {
    sql += " AND price_val>0 AND area_sqft>0 AND type<>'rent'";
    range('(price_val*1.0/area_sqft)', f.rate);
  }

  if (f.bhk) {
    const n = toInt(f.bhk);
    if (n !== null) {
      if (String(f.bhk).includes('+')) { sql += ' AND beds>=?'; p.push(n); }
      else { sql += ' AND beds=?'; p.push(n); }
    }
  }
  if (f.subtype) {
    // Exact match on the subtype column; listings without a subtype fall back to a keyword match
    const keyword = String(f.subtype).split('/')[0].trim();
    sql += " AND (subtype=? OR (COALESCE(subtype,'')='' AND (title LIKE ? OR description LIKE ?)))";
    p.push(f.subtype, `%${keyword}%`, `%${keyword}%`);
  }
  // Furnishing has its own field now; older listings kept it in "status"
  const furnish = { Furnished: ['Furnished', 'Fully Furnished'], 'Semi-Furnished': ['Semi-Furnished'], Unfurnished: ['Unfurnished'] }[f.furnishing];
  if (furnish) {
    sql += ` AND (furnishing=? OR (COALESCE(furnishing,'')='' AND status IN (${furnish.map(() => '?').join(',')})))`;
    p.push(f.furnishing, ...furnish);
  }
  if (f.possession === 'ready') sql += " AND (possession LIKE 'Ready%' OR (COALESCE(possession,'')='' AND status IN ('Ready to Move','Ready','Fully Furnished','Semi-Furnished','Unfurnished','Furnished')))";
  else if (f.possession === 'under-construction') sql += " AND (possession LIKE '%construction%' OR possession LIKE 'Possession%' OR (COALESCE(possession,'')='' AND status IN ('Under Construction','Pre-Launch','New Launch')))";
  if (f.age && AGE_BANDS.includes(f.age)) { sql += ' AND age_band=?'; p.push(f.age); }
  if (f.amenities) {
    String(f.amenities).split(',').map(s => s.trim()).filter(Boolean).slice(0, 10).forEach(a => {
      sql += " AND (','||REPLACE(COALESCE(amenities,''),', ',',')||',') LIKE ?"; p.push(`%,${a},%`);
    });
  }

  if (f.transaction === 'lease') sql += " AND (type='rent' OR price_label LIKE '%/mo%' OR price_label LIKE '%/month%')";
  else if (f.transaction === 'buy') sql += " AND type<>'rent' AND price_label NOT LIKE '%/mo%' AND price_label NOT LIKE '%/month%'";

  if (f.bounds) {
    const b = String(f.bounds).split(',').map(Number);
    if (b.length === 4 && b.every(Number.isFinite)) {
      sql += ' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?';
      p.push(b[0], b[2], b[1], b[3]);
    }
  }
  return { sql, p };
}

function orderBy(f) {
  if (SORTS[f.sort]) return SORTS[f.sort];
  // Relevance: title / locality matches first, then featured and verified listings, then newest
  if (f.q) {
    return { sql: '(title LIKE ?)*3 + (locality LIKE ?)*2 + is_featured + (verified_at IS NOT NULL) DESC, COALESCE(published_at, created_at) DESC, id DESC', p: [`%${f.q}%`, `%${f.q}%`] };
  }
  return 'is_featured DESC, (verified_at IS NOT NULL) DESC, COALESCE(published_at, created_at) DESC, id DESC';
}

const Property = {
  TYPES, FURNISHING, AGE_BANDS, LISTED_BY, REVIEW_STATUSES, LISTING_STATUSES, AMENITIES, ADMIN_ONLY,
  listingCode, publicJSON,

  validate(input, partial) {
    const out = sanitize(SCHEMA, input, { partial });
    if (out.error) return out;
    const d = out.data;
    // Map pin: numbers inside India's rough bounds, or empty
    for (const [k, min, max] of [['lat', 6, 37], ['lng', 68, 98]]) {
      if (d[k] === undefined) continue;
      const n = parseFloat(d[k]);
      d[k] = Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 1e6) / 1e6 : null;
    }
    if (d.amenities !== undefined) {
      d.amenities = [...new Set(String(d.amenities).split(',').map(s => s.trim().slice(0, 40)).filter(Boolean))].slice(0, 30).join(', ');
    }
    return out;
  },

  /** Listings as an array (admin panel, sitemap, tests) */
  search(f = {}, { all = false } = {}) {
    return this.searchPage(f, { all }).data;
  },

  /** { data, total } for one page of results. Paging with limit + offset. */
  searchPage(f = {}, { all = false } = {}) {
    const w = where(f, all);
    const o = orderBy(f);
    const limit = Math.min(Math.max(toInt(f.limit) || 50, 1), 500);
    const offset = Math.max(toInt(f.offset) || 0, 0);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM properties WHERE ${w.sql}`).get(...w.p).n;
    const data = db.prepare(`SELECT * FROM properties WHERE ${w.sql} ORDER BY ${o.sql || o} LIMIT ? OFFSET ?`)
      .all(...w.p, ...(o.p || []), limit, offset).map(toJSON);
    return { data, total };
  },

  find(id) {
    return toJSON(db.prepare('SELECT * FROM properties WHERE id=?').get(id));
  },

  /** A listing visitors may open: reviewed (sold / rented / expired ones are shown as such) */
  findLive(id) {
    return toJSON(db.prepare("SELECT * FROM properties WHERE id=? AND review_status='approved'").get(id));
  },

  /** Up to 4 live listings like this one: same type and city, similar price, nearest locality first */
  similar(p, limit = 4) {
    const lo = p.price_val ? Math.round(p.price_val * 0.6) : 0;
    const hi = p.price_val ? Math.round(p.price_val * 1.5) : Number.MAX_SAFE_INTEGER;
    return db.prepare(`SELECT * FROM properties WHERE ${LIVE} AND id<>? AND type=? AND city=?
        ORDER BY (locality=?) DESC, (price_val BETWEEN ? AND ?) DESC, ABS(price_val-?) ASC LIMIT ?`)
      .all(p.id, p.type, p.city, p.locality || '', lo, hi, p.price_val || 0, limit).map(toJSON);
  },

  /** Localities with live listings in a city, and cities with listings of a type — for the "no results" state */
  suggestions({ city = '', type = '' } = {}) {
    const t = TYPES.includes(type) ? type : null;
    const localities = city ? db.prepare(`SELECT locality AS name, COUNT(*) AS n FROM properties
        WHERE ${LIVE} AND city LIKE ? AND COALESCE(locality,'')<>'' ${t ? 'AND type=?' : ''} GROUP BY locality ORDER BY n DESC LIMIT 8`)
      .all(`%${city}%`, ...(t ? [t] : [])) : [];
    const cities = db.prepare(`SELECT city AS name, COUNT(*) AS n FROM properties WHERE ${LIVE} ${t ? 'AND type=?' : ''}
        GROUP BY city ORDER BY n DESC LIMIT 8`).all(...(t ? [t] : []));
    return { localities, cities };
  },

  /** Listings that look like the same property (same city and title, or same locality, size and price) */
  duplicates(d, excludeId = 0) {
    const area = parseSqft(d.area);
    return db.prepare(`SELECT id, title, review_status, listing_status FROM properties
        WHERE id<>? AND city=? AND review_status NOT IN ('rejected','draft') AND (
          lower(trim(title))=lower(trim(?))
          OR (COALESCE(locality,'')<>'' AND lower(locality)=lower(?) AND area_sqft=? AND price_val>0 AND ABS(price_val-?) <= price_val*0.05)
        ) LIMIT 5`)
      .all(excludeId, d.city || '', d.title || '', d.locality || '', area ?? -1, d.price_val || 0);
  },

  ownedBy(userId) {
    return db.prepare('SELECT * FROM properties WHERE owner_id=? ORDER BY created_at DESC, id DESC').all(userId).map(toJSON);
  },

  /** Keeps the listings of a deleted account, without an owner */
  clearOwner(userId) {
    db.prepare('UPDATE properties SET owner_id=NULL WHERE owner_id=?').run(userId);
  },

  cityCounts() {
    const out = {};
    db.prepare(`SELECT city, COUNT(*) AS n FROM properties WHERE ${LIVE} GROUP BY city`).all().forEach(r => { out[r.city] = r.n; });
    return out;
  },

  cities() {
    return db.prepare(`SELECT DISTINCT city FROM properties WHERE ${LIVE} ORDER BY city`).all().map(r => r.city);
  },

  create(data, image) {
    const row = { ...data, image: image || null, area_sqft: parseSqft(data.area), updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19) };
    if ((row.review_status || 'approved') === 'approved' && !row.published_at) row.published_at = row.updated_at;
    const cols = Object.keys(row);
    const r = db.prepare(`INSERT INTO properties (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map(c => row[c]));
    return this.find(r.lastInsertRowid);
  },

  update(id, data, image) {
    const row = { ...data };
    if (image) row.image = image;
    if (row.area !== undefined) row.area_sqft = parseSqft(row.area);
    // Required fields may not be blanked by an update
    for (const k of ['title', 'price_label', 'city']) if (row[k] === '') delete row[k];
    const cols = Object.keys(row);
    if (cols.length) {
      db.prepare(`UPDATE properties SET ${cols.map(c => `${c}=?`).join(',')}, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(...cols.map(c => row[c]), id);
    }
    return this.find(id);
  },

  gallery(id) {
    return galleryList(db.prepare('SELECT gallery FROM properties WHERE id=?').get(id)?.gallery);
  },

  setGallery(id, files) {
    db.prepare('UPDATE properties SET gallery=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(JSON.stringify(files.slice(0, 30)), id);
  },

  remove(id) {
    const row = db.prepare('SELECT * FROM properties WHERE id=?').get(id);
    if (row) db.prepare('DELETE FROM properties WHERE id=?').run(id);
    return row && { ...row, gallery_files: galleryList(row.gallery) };
  },

  /** Marks live listings whose end date passed as expired. Returns their ids. */
  expireOld() {
    const rows = db.prepare(`SELECT id FROM properties WHERE ${LIVE} AND expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP`).all();
    const upd = db.prepare("UPDATE properties SET listing_status='expired', updated_at=CURRENT_TIMESTAMP WHERE id=?");
    rows.forEach(r => upd.run(r.id));
    return rows.map(r => r.id);
  },

  stats() {
    return {
      total: db.prepare(`SELECT COUNT(*) AS n FROM properties WHERE ${LIVE}`).get().n,
      pending: db.prepare("SELECT COUNT(*) AS n FROM properties WHERE review_status IN ('pending','under_review')").get().n,
    };
  },

  parseSqft,
  isLease: isLeaseRow,
};

module.exports = Property;
