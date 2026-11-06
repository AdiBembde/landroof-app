'use strict';
// "List your property" requests. An admin approves or rejects each one. An approved email is an
// "owner": it may add listings from the website, which still go live only after an admin review.
// Approving also creates a one-time link (emailed) that signs the owner straight in.
const crypto = require('crypto');
const db = require('../config/database');

const LINK_DAYS = 7;
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const norm = e => String(e || '').trim().toLowerCase();

// What may leave the server (never the link hash)
const publicRow = r => {
  if (!r) return r;
  const { link_hash, ...rest } = r;
  return rest;
};

const ListingRequest = {
  /** Saves a request unless this email already has one pending or approved. Returns { request, existing } */
  submit({ name, email, phone, city, type, message }) {
    const em = norm(email);
    const open = db.prepare("SELECT * FROM listing_requests WHERE email=? AND status IN ('pending','approved') ORDER BY id DESC").get(em);
    if (open) return { request: publicRow(open), existing: true };
    const r = db.prepare('INSERT INTO listing_requests (name,email,phone,city,property_type,message) VALUES (?,?,?,?,?,?)')
      .run(name || '', em, phone || '', city || '', type || '', message || '');
    return { request: this.find(r.lastInsertRowid), existing: false };
  },

  find(id) {
    return publicRow(db.prepare('SELECT * FROM listing_requests WHERE id=?').get(id));
  },

  /** Every request, pending first, with the matching account and how many listings it has */
  list() {
    return db.prepare(`SELECT r.*, u.id AS user_id,
        (SELECT COUNT(*) FROM properties p WHERE p.owner_id=u.id) AS properties
      FROM listing_requests r LEFT JOIN users u ON u.email=r.email
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC, r.id DESC`).all().map(publicRow);
  },

  pendingCount() {
    return db.prepare("SELECT COUNT(*) AS n FROM listing_requests WHERE status='pending'").get().n;
  },

  /** Approves or rejects a request. Approving returns a fresh one-time sign-in token for the email. */
  decide(id, status) {
    if (!['approved', 'rejected'].includes(status)) throw new Error('Unknown status');
    db.prepare("UPDATE listing_requests SET status=?, decided_at=datetime('now') WHERE id=?").run(status, id);
    if (status === 'rejected') {
      db.prepare('UPDATE listing_requests SET link_hash=NULL, link_expires=NULL WHERE id=?').run(id);
      return { request: this.find(id), token: null };
    }
    return { request: this.find(id), token: this.newLink(id) };
  },

  /** A new one-time sign-in link for an approved request (the previous one stops working) */
  newLink(id) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare(`UPDATE listing_requests SET link_hash=?, link_expires=datetime('now',?), link_used_at=NULL
      WHERE id=? AND status='approved'`).run(hash(token), `+${LINK_DAYS} days`, id);
    return token;
  },

  /** The approved request a still-valid link belongs to, without using the link up (or null) */
  peekLink(token) {
    if (!token || typeof token !== 'string' || token.length > 100) return null;
    return publicRow(db.prepare(`SELECT * FROM listing_requests WHERE link_hash=? AND status='approved'
      AND link_used_at IS NULL AND link_expires>datetime('now')`).get(hash(token))) || null;
  },

  /** Uses up a link. Returns true only for the first use. */
  useLink(token) {
    return db.prepare(`UPDATE listing_requests SET link_used_at=datetime('now')
      WHERE link_hash=? AND status='approved' AND link_used_at IS NULL AND link_expires>datetime('now')`).run(hash(token)).changes === 1;
  },

  isApproved(email) {
    return !!db.prepare("SELECT 1 FROM listing_requests WHERE email=? AND status='approved'").get(norm(email));
  },

  /** Approved owners with their account and listing counts (for the admin "Owners" page) */
  owners() {
    return db.prepare(`SELECT r.id AS request_id, r.name, r.email, r.phone, r.city, r.decided_at AS approved_at,
        u.id AS user_id, u.name AS account_name, u.created_at AS account_created,
        (SELECT COUNT(*) FROM properties p WHERE p.owner_id=u.id) AS total,
        (SELECT COUNT(*) FROM properties p WHERE p.owner_id=u.id AND p.review_status='approved') AS live,
        (SELECT COUNT(*) FROM properties p WHERE p.owner_id=u.id AND p.review_status='pending') AS pending,
        (SELECT COUNT(*) FROM properties p WHERE p.owner_id=u.id AND p.review_status='rejected') AS rejected
      FROM listing_requests r LEFT JOIN users u ON u.email=r.email
      WHERE r.status='approved' ORDER BY r.decided_at DESC, r.id DESC`).all();
  },

  removeByEmail(email) {
    return db.prepare('DELETE FROM listing_requests WHERE email=?').run(norm(email)).changes;
  },
};

module.exports = ListingRequest;
