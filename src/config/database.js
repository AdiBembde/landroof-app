'use strict';
// Opens the SQLite database, creates tables and applies migrations.
// Existing databases from earlier versions are upgraded in place — no data is lost.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH, UPLOAD_DIR } = require('./env');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS properties (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    type        TEXT    NOT NULL DEFAULT 'buy',
    subtype     TEXT,
    price_label TEXT    NOT NULL,
    price_val   INTEGER NOT NULL DEFAULT 0,
    emi_label   TEXT,
    area        TEXT,
    area_sqft   INTEGER,
    beds        INTEGER DEFAULT 0,
    baths       INTEGER DEFAULT 0,
    status      TEXT    DEFAULT 'Ready to Move',
    city        TEXT    NOT NULL,
    locality    TEXT,
    description TEXT,
    image       TEXT,
    rera        TEXT,
    is_featured INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS leads (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT,
    phone         TEXT,
    name          TEXT,
    search_city   TEXT,
    search_type   TEXT,
    search_budget TEXT,
    search_bhk    TEXT,
    source        TEXT    DEFAULT 'search',
    property_id   INTEGER,
    message       TEXT,
    ip_address    TEXT,
    user_agent    TEXT,
    device_type   TEXT,
    referrer      TEXT,
    screen_w      INTEGER,
    screen_h      INTEGER,
    session_id    TEXT,
    timezone      TEXT,
    language      TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS testimonials (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    role        TEXT,
    city        TEXT,
    rating      INTEGER DEFAULT 5,
    text        TEXT    NOT NULL,
    is_active   INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    role        TEXT    NOT NULL,
    bio         TEXT,
    image       TEXT,
    email       TEXT,
    phone       TEXT,
    order_idx   INTEGER DEFAULT 0,
    is_active   INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    state       TEXT,
    image       TEXT,
    order_idx   INTEGER DEFAULT 0,
    is_active   INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    description TEXT,
    event_date  TEXT,
    location    TEXT,
    image       TEXT,
    is_active   INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    body        TEXT,
    type        TEXT    DEFAULT 'info',
    is_active   INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS schemes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    description TEXT,
    valid_until TEXT,
    image       TEXT,
    is_active   INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Admin password set from the dashboard (overrides ADMIN_PASS in .env). One row at most.
  CREATE TABLE IF NOT EXISTS admin_credentials (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    pass_hash   TEXT    NOT NULL,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS site_config (
    key         TEXT    PRIMARY KEY,
    value       TEXT,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS social_posts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    platform    TEXT    NOT NULL DEFAULT 'instagram',
    caption     TEXT,
    url         TEXT,
    image       TEXT,
    is_active   INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS media_gallery (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    filename    TEXT    NOT NULL,
    caption     TEXT,
    category    TEXT    DEFAULT 'general',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT,
    email         TEXT    NOT NULL UNIQUE,
    phone         TEXT,
    pass_hash     TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'user',
    token_version INTEGER NOT NULL DEFAULT 0,   -- bumped to invalidate every token of this user
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Refresh tokens (stored only as SHA-256 hashes). Access tokens are stateless JWTs.
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash  TEXT    NOT NULL UNIQUE,
    audience    TEXT    NOT NULL,              -- 'admin' or 'user'
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    family      TEXT    NOT NULL,              -- all rotations of one login share a family
    expires_at  DATETIME NOT NULL,
    revoked_at  DATETIME,
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_refresh_family ON refresh_tokens(family);
  CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

  -- One-time links sent by email (verify address, reset password). Only hashes are stored.
  CREATE TABLE IF NOT EXISTS user_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     TEXT    NOT NULL,              -- 'verify' or 'reset'
    token_hash  TEXT    NOT NULL UNIQUE,
    expires_at  DATETIME NOT NULL,
    used_at     DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Security-relevant events: admin logins and every admin change, account security events
  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    actor       TEXT    NOT NULL,              -- 'admin:<name>', 'user:<id>' or 'anonymous'
    action      TEXT    NOT NULL,
    target      TEXT,
    target_id   TEXT,
    ip_address  TEXT,
    user_agent  TEXT,
    details     TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

  -- Rate-limit counters (kept in the database so a restart doesn't reset them)
  CREATE TABLE IF NOT EXISTS rate_limits (
    key          TEXT    PRIMARY KEY,
    count        INTEGER NOT NULL,
    window_start INTEGER NOT NULL             -- ms since epoch
  );

  -- Opaque session tables from the previous version are replaced by JWT + refresh tokens
  DROP TABLE IF EXISTS user_sessions;
  DROP TABLE IF EXISTS admin_sessions;

  -- "List your property" requests; an approved email may add listings ("owner")
  CREATE TABLE IF NOT EXISTS listing_requests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT,
    email         TEXT    NOT NULL,
    phone         TEXT,
    city          TEXT,
    property_type TEXT,
    message       TEXT,
    status        TEXT    NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
    decided_at    DATETIME,
    link_hash     TEXT,                                 -- one-time sign-in link from the approval email (hash only)
    link_expires  DATETIME,
    link_used_at  DATETIME,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_listreq_email ON listing_requests(email);

  CREATE TABLE IF NOT EXISTS wishlist (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, property_id)
  );
`);

// ── Migrations for databases created by older versions ──────────────────
function addColumnIfMissing(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
[
  ['ip_address','TEXT'], ['user_agent','TEXT'], ['device_type','TEXT'], ['referrer','TEXT'],
  ['screen_w','INTEGER'], ['screen_h','INTEGER'], ['session_id','TEXT'], ['timezone','TEXT'], ['language','TEXT'],
].forEach(([c, t]) => addColumnIfMissing('leads', c, t));
addColumnIfMissing('properties', 'subtype', 'TEXT');
addColumnIfMissing('properties', 'area_sqft', 'INTEGER');
addColumnIfMissing('properties', 'gallery', 'TEXT'); // JSON list of extra photos (project brochures)
// Listings added by owners from the website wait for an admin review
addColumnIfMissing('properties', 'owner_id', 'INTEGER');
addColumnIfMissing('properties', 'review_status', "TEXT NOT NULL DEFAULT 'approved'"); // pending | approved | rejected
addColumnIfMissing('properties', 'review_note', 'TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_properties_owner ON properties(owner_id)');
// Listing details, lifecycle and verification
[
  ['updated_at', 'DATETIME'], ['furnishing', 'TEXT'], ['possession', 'TEXT'], ['age_band', 'TEXT'],
  ['amenities', 'TEXT'],                       // comma-separated
  ['video_url', 'TEXT'], ['tour_url', 'TEXT'], ['floor_plan', 'TEXT'],
  ['lat', 'REAL'], ['lng', 'REAL'],
  ['listed_by', "TEXT NOT NULL DEFAULT 'landroof'"], // landroof | owner | agent | developer
  ['developer_name', 'TEXT'],
  ['listing_status', "TEXT NOT NULL DEFAULT 'active'"], // active | sold | rented | expired | withdrawn
  ['submitted_at', 'DATETIME'], ['published_at', 'DATETIME'], ['expires_at', 'DATETIME'],
  ['verified_at', 'DATETIME'], ['verified_by', 'TEXT'], ['verify_scope', 'TEXT'],
  ['rera_verified', 'INTEGER NOT NULL DEFAULT 0'],
  ['is_project', 'INTEGER NOT NULL DEFAULT 0'],
  ['duplicate_of', 'TEXT'],                    // ids of listings that look the same, found at submission
].forEach(([c, t]) => addColumnIfMissing('properties', c, t));
db.exec("UPDATE properties SET updated_at = created_at WHERE updated_at IS NULL");
db.exec("UPDATE properties SET published_at = created_at WHERE published_at IS NULL AND review_status='approved'");
db.exec("UPDATE properties SET listed_by='owner' WHERE owner_id IS NOT NULL AND listed_by='landroof'");

db.exec(`
  -- Every step in a listing's life: submitted, reviewed, corrections asked, verified, sold, plot status changes…
  CREATE TABLE IF NOT EXISTS listing_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL,
    actor       TEXT    NOT NULL,              -- 'admin:<name>', 'owner:<id>' or 'system'
    action      TEXT    NOT NULL,
    from_status TEXT,
    to_status   TEXT,
    note        TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_events_property ON listing_events(property_id);

  -- Brochures, approvals, title papers… Stored outside the public folder; private unless an admin publishes one.
  CREATE TABLE IF NOT EXISTS property_documents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id   INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    kind          TEXT    NOT NULL DEFAULT 'other',  -- brochure | layout | approval | title | other
    title         TEXT,
    filename      TEXT    NOT NULL,
    original_name TEXT,
    mime          TEXT,
    size          INTEGER,
    is_public     INTEGER NOT NULL DEFAULT 0,
    uploaded_by   TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- "Report this listing" from visitors
  CREATE TABLE IF NOT EXISTS listing_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL,
    reason      TEXT    NOT NULL,
    details     TEXT,
    email       TEXT,
    status      TEXT    NOT NULL DEFAULT 'open',   -- open | resolved | dismissed
    admin_note  TEXT,
    ip_address  TEXT,
    resolved_at DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Plot inventory of a project
  CREATE TABLE IF NOT EXISTS plots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    plot_no     TEXT    NOT NULL,
    block       TEXT,
    area_sqft   INTEGER,
    rate_sqft   INTEGER,
    total_price INTEGER,
    facing      TEXT,
    frontage    TEXT,
    status      TEXT    NOT NULL DEFAULT 'available', -- available | hold | booked | sold
    sort_idx    INTEGER DEFAULT 0,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_plots_property ON plots(property_id);

  -- NA order, land-use, layout approval, MahaRERA… shown on the website only after staff reviewed them
  CREATE TABLE IF NOT EXISTS project_approvals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL,              -- na | landuse | layout | rera | other
    reference   TEXT,
    authority   TEXT,
    issued_on   TEXT,
    document_id INTEGER,
    reviewed_by TEXT,
    reviewed_at DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
addColumnIfMissing('users', 'role', "TEXT NOT NULL DEFAULT 'user'");
addColumnIfMissing('users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');
// 1 = revoked because it was exchanged for a newer token (rotation), 0 = revoked by sign-out / theft detection
addColumnIfMissing('refresh_tokens', 'rotated', 'INTEGER NOT NULL DEFAULT 0');
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'email_verified_at')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verified_at DATETIME');
}
// Email confirmation is no longer required — activate any accounts still waiting for it
db.exec('UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL');

module.exports = db;
