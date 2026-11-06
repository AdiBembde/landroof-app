'use strict';
// End-to-end API tests. Run with:  npm test
// Each run uses a fresh temporary database and upload folder — your real data is never touched.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'landroof-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.DOCS_DIR = path.join(tmp, 'documents');
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'test-password-123';
process.env.SITE_URL = 'https://example.test';

process.env.JWT_SECRET = 'test-secret-'.padEnd(64, 'x');
process.env.NODE_ENV = 'test';
process.env.PASSWORD_HASH_COST = '12'; // fast hashing for tests (production uses 17)
// Never send real email from tests, even when .env has SMTP settings: emails go to the outbox folder.
// (dotenv doesn't override variables that are already set, even to an empty string.)
process.env.SMTP_HOST = '';
process.env.ADMIN_EMAIL = '';

const jwt = require('jsonwebtoken');
const app = require('../src/app');
const SECRET = require('../src/config/jwtSecret');
const OUTBOX = path.join(tmp, 'outbox');
let server, base, adminToken;

/** The newest email saved for an address (no SMTP in tests → data/outbox) */
function lastEmail(to) {
  if (!fs.existsSync(OUTBOX)) return null;
  const files = fs.readdirSync(OUTBOX).filter(f => f.includes(to.replace(/[^a-z0-9@._-]/gi, '_'))).sort();
  return files.length ? fs.readFileSync(path.join(OUTBOX, files[files.length - 1]), 'utf8') : null;
}
const linkToken = (html, param) => (html && html.match(new RegExp(`\\?${param}=([A-Za-z0-9_-]+)`)) || [])[1];
const waitFor = async fn => { for (let i = 0; i < 50; i++) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 20)); } return null; };

/** Registers a visitor; registration signs them straight in and returns the sign-in response */
async function registerVerified(name, email, password, extra = {}) {
  const r = await req('POST', '/api/auth/register', { body: { name, email, password, ...extra } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r;
}

// Smallest valid PNG (1×1 pixel)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function req(method, url, { body, token, form, cookie } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + url, { method, headers, body: payload });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  const setCookies = res.headers.getSetCookie();
  // "name=value" of the first cookie set, ready to send back
  const cookieOut = setCookies.length ? setCookies[0].split(';')[0] : '';
  return { status: res.status, data, headers: res.headers, setCookies, cookie: cookieOut };
}

before(async () => {
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await req('POST', '/api/admin/auth/login', { body: { username: 'admin', password: 'test-password-123' } });
  adminToken = r.data.accessToken;
});

after(() => {
  server.close();
  require('../src/config/database').close(); // release the file lock (needed on Windows)
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Pages ────────────────────────────────────────────────────────────────
test('homepage renders with SITE_URL and current year filled in', async () => {
  const r = await req('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.data, /https:\/\/example\.test\//);
  assert.match(r.data, new RegExp(`© ${new Date().getFullYear()} Landroof`));
  assert.doesNotMatch(r.data, /\{\{/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('admin page is served and marked noindex', async () => {
  const r = await req('GET', '/admin');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('unknown pages get an HTML 404, unknown API routes get JSON', async () => {
  const page = await req('GET', '/about-us');
  assert.equal(page.status, 404);
  assert.match(page.data, /This page doesn't exist/);
  const api = await req('GET', '/api/does-not-exist');
  assert.deepEqual(api.data, { error: 'Not found' });
});

test('robots.txt allows photos and sitemap lists real listing pages', async () => {
  const robots = await req('GET', '/robots.txt');
  assert.doesNotMatch(robots.data, /Disallow: \/uploads/);
  const sitemap = await req('GET', '/sitemap.xml');
  assert.match(sitemap.data, /\?type=buy&amp;city=Pune/);
  assert.doesNotMatch(sitemap.data, /city=Delhi/); // no listings there → not in sitemap
});

// ── Listings + search filters ────────────────────────────────────────────
test('seeded listings are available', async () => {
  const r = await req('GET', '/api/properties');
  assert.equal(r.data.total, 10);
  assert.ok(!r.data.data.some(p => p.title === 'Agricultural Land' || p.title === 'Residential NA Plot'));
  const plots = (await req('GET', '/api/properties?type=plots')).data.data;
  assert.deepEqual(plots.map(p => p.title), ['Codename Nature Vailly', 'Water Front – Resort Living', 'Royal Estate', 'Mount View – Luxury Plots']);
  const nv = plots[0];
  assert.equal(nv.image_url, '/images/projects/nature-vailly-cover.jpg');
  assert.equal(nv.gallery_urls.length, 5);
  assert.equal(nv.area_sqft, 10890);
  assert.equal((await req('GET', nv.gallery_urls[0])).status, 200);
});

test('search filters: type, budget, BHK, area, subtype, furnishing, transaction', async () => {
  const titles = async q => (await req('GET', '/api/properties?' + q)).data.data.map(p => p.title).sort();
  assert.deepEqual(await titles('type=buy&bhk=3%20BHK&budget=10000000-20000000'), ['Spacious 3 BHK Apartment']);
  assert.deepEqual(await titles('type=buy&bhk=4%2B%20BHK'), []);
  assert.deepEqual(await titles('type=plots&area=10000%2B'), ['Codename Nature Vailly']);
  assert.deepEqual(await titles('type=plots&area=1000-2500'), []);
  assert.deepEqual(await titles('type=rent&subtype=Villa%20%2F%20Bungalow'), ['Furnished 4 BHK Villa']);
  assert.deepEqual(await titles('type=rent&furnishing=Furnished'), []);
  assert.deepEqual(await titles('type=rent&furnishing=Semi-Furnished').then(t => t.length), 2);
  assert.deepEqual(await titles('type=commercial&transaction=lease'), []);
  assert.deepEqual(await titles('type=commercial&transaction=buy'), ['Prime Office Space']);
  assert.deepEqual(await titles('city=Mumbai'), ['Luxury 3 BHK Sea View']);
  assert.deepEqual(await titles('type=rent&city=Hyderabad'), []);
});

test('city counts reflect real listings', async () => {
  const r = await req('GET', '/api/city-counts');
  assert.deepEqual(r.data.data, { Bangalore: 1, Mumbai: 1, Pune: 8 });
});

// ── Leads ────────────────────────────────────────────────────────────────
test('lead form rejects a malformed email', async () => {
  const r = await req('POST', '/api/leads', { body: { email: 'not-an-email' } });
  assert.equal(r.status, 400);
  assert.ok(r.data.fields.email);
});

// ── Validation (shared rules, enforced by the server) ─────────────────────
test('mobile numbers: letters, wrong length and fake numbers are rejected; valid ones are normalised', async () => {
  const send = phone => req('POST', '/api/leads', { body: { source: 'investment-enquiry', name: 'Asha Rao', email: 'asha@test.in', phone } });
  for (const bad of ['hukkah', '12345', '5876543210', '9999999999', '98765432101234567', '+91 abc']) {
    const r = await send(bad);
    assert.equal(r.status, 400, `"${bad}" should be rejected`);
    assert.ok(r.data.fields.phone, `"${bad}" should name the phone field`);
  }
  for (const good of ['9876543211', '098765 43211', '+91 98765-43211', '+447911123456']) {
    assert.equal((await send(good)).status, 200, `"${good}" should be accepted`);
  }
  const leads = (await req('GET', '/api/admin/leads', { token: adminToken })).data.data;
  assert.ok(leads.some(l => l.phone === '+919876543211'));
  assert.ok(leads.some(l => l.phone === '+447911123456'));
});

test('email addresses: malformed ones are rejected; valid ones are trimmed and lower-cased', async () => {
  for (const bad of ['a@b', 'a..b@x.com', '.a@x.com', 'a b@x.com', 'name@domain', 'no-at.com', 'x@y.c']) {
    const r = await req('POST', '/api/leads', { body: { email: bad, phone: '9823456781' } });
    assert.equal(r.status, 400, `"${bad}" should be rejected`);
  }
  assert.equal((await req('POST', '/api/leads', { body: { email: '  Mixed.Case@Example.CO.IN ', phone: '9823456781' } })).status, 200);
  const leads = (await req('GET', '/api/admin/leads', { token: adminToken })).data.data;
  assert.ok(leads.some(l => l.email === 'mixed.case@example.co.in'));
});

test('each form enforces its own required fields', async () => {
  const cases = [
    [{ source: 'list-property', name: 'Ravi K', email: 'ravi@test.in' }, 'phone'],           // mobile required
    [{ source: 'list-property', name: 'Ravi K', email: 'ravi@test.in', phone: '9876543211', search_city: 'Atlantis' }, 'search_city'],
    [{ source: 'contact', name: 'Ravi K', email: 'ravi@test.in', message: 'hi' }, 'message'], // too short
    [{ source: 'contact', email: 'ravi@test.in', message: 'Please call me back' }, 'name'],
    [{ source: 'investment-enquiry', name: 'Ravi K' }, 'email'],
    [{ source: 'property-enquiry', name: 'R2D2', email: 'ravi@test.in' }, 'name'],          // digits in name
    [{ source: 'made-up' }, null],
  ];
  for (const [body, field] of cases) {
    const r = await req('POST', '/api/leads', { body });
    assert.equal(r.status, 400, JSON.stringify(body));
    if (field) assert.ok(r.data.fields[field], `expected an error on ${field}: ${JSON.stringify(r.data)}`);
  }
  const ok = await req('POST', '/api/leads', { body: { source: 'contact', subject: 'Careers', name: "Anne-Marie D'Souza", email: 'am@test.in', message: 'I would like to apply.' } });
  assert.equal(ok.status, 200);
  const leads = (await req('GET', '/api/admin/leads', { token: adminToken })).data.data;
  assert.ok(leads.some(l => l.message === '[Careers] I would like to apply.'));
});

test('registration enforces password, email, name and mobile rules', async () => {
  const reg = body => req('POST', '/api/auth/register', { body: { name: 'Priya Shah', email: 'priya@test.in', password: 'Garden2026', ...body } });
  const expectField = async (body, field) => {
    const r = await reg(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok(r.data.fields[field], `${field}: ${JSON.stringify(r.data)}`);
  };
  await expectField({ password: 'short1' }, 'password');
  await expectField({ password: 'abcdefgh' }, 'password');          // no number
  await expectField({ password: 'has space1' }, 'password');
  await expectField({ password: 'password123' }, 'password');       // too common
  await expectField({ password: 'priya2026' }, 'password');         // contains email name
  await expectField({ email: 'priya@test' }, 'email');
  await expectField({ name: 'P' }, 'name');
  await expectField({ phone: 'hukkah' }, 'phone');
  await expectField({ interest: 'hacking' }, 'interest');

  const ok = await registerVerified('Priya Shah', 'priya@test.in', 'Garden2026', { phone: '98765 43212' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.phone, '+919876543212');

  const login = await req('POST', '/api/auth/login', { body: { email: 'not-an-email', password: 'x' } });
  assert.equal(login.status, 400);
  assert.ok(login.data.fields.email);
});

test('admin team member email and mobile are validated', async () => {
  const bad = await req('POST', '/api/admin/team', { token: adminToken, body: { name: 'Ravi', role: 'Advisor', phone: 'call me' } });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.fields.phone);
  const ok = await req('POST', '/api/admin/team', { token: adminToken, body: { name: 'Ravi', role: 'Advisor', phone: '9876543213', email: 'RAVI@Test.in' } });
  assert.equal(ok.data.data.phone, '+919876543213');
  assert.equal(ok.data.data.email, 'ravi@test.in');
  await req('DELETE', `/api/admin/team/${ok.data.id}`, { token: adminToken });
});

test('lead fields cannot carry HTML into number columns (stored XSS fix)', async () => {
  await req('POST', '/api/leads', { body: { email: 'xss@test.in', phone: '9823456781', screen_w: '<img src=x onerror=alert(1)>', screen_h: '900' } });
  const leads = await req('GET', '/api/admin/leads', { token: adminToken });
  const lead = leads.data.data.find(l => l.email === 'xss@test.in');
  assert.equal(lead.screen_w, null);
  assert.equal(lead.screen_h, 900);
});

test('CSV export neutralises spreadsheet formulas', async () => {
  await req('POST', '/api/leads', { body: { message: '=HYPERLINK("http://evil")', email: 'csv@test.in', phone: '9823456781' } });
  const r = await req('GET', '/api/admin/leads?csv=1', { token: adminToken });
  assert.match(r.data, /"'=HYPERLINK/);
});

// ── Admin auth (JWT) ─────────────────────────────────────────────────────
test('admin login returns a JWT access token and an httpOnly refresh cookie', async () => {
  const r = await req('POST', '/api/admin/auth/login', { body: { username: 'admin', password: 'test-password-123' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.tokenType, 'Bearer');
  assert.equal(r.data.expiresIn, 15 * 60);
  const claims = jwt.decode(r.data.accessToken);
  assert.equal(claims.role, 'admin');
  assert.equal(claims.aud, 'landroof-admin');
  assert.equal(claims.iss, 'landroof');
  const cookie = r.setCookies[0];
  assert.match(cookie, /^lr_admin_rt=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api\/admin\/auth/);
  assert.doesNotMatch(JSON.stringify(r.data), /lr_admin_rt|refresh/i); // refresh token never in the body
});

test('admin API requires a valid admin JWT', async () => {
  assert.equal((await req('GET', '/api/admin/stats')).status, 401);
  assert.equal((await req('GET', '/api/admin/stats', { token: 'bogus' })).status, 401);
  const ok = await req('GET', '/api/admin/stats', { token: adminToken });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.data.total_properties, 10);
  assert.equal((await req('GET', '/api/admin/auth/me', { token: adminToken })).data.user.role, 'admin');
});

test('forged, tampered, expired and wrong-audience tokens are rejected', async () => {
  const claims = { role: 'admin', pv: jwt.decode(adminToken).pv };
  const opts = { issuer: 'landroof', audience: 'landroof-admin', subject: 'admin' };

  const otherKey = jwt.sign(claims, 'x'.repeat(48), { ...opts, expiresIn: '5m' });
  assert.equal((await req('GET', '/api/admin/stats', { token: otherKey })).data.code, 'invalid_token');

  const [h, , s] = adminToken.split('.');
  const payload = Buffer.from(JSON.stringify({ ...jwt.decode(adminToken), sub: 'hacker' })).toString('base64url');
  assert.equal((await req('GET', '/api/admin/stats', { token: `${h}.${payload}.${s}` })).status, 401);

  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${adminToken.split('.')[1]}.`;
  assert.equal((await req('GET', '/api/admin/stats', { token: none })).status, 401);

  const expired = jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 10 }, SECRET, opts);
  const r = await req('GET', '/api/admin/stats', { token: expired });
  assert.equal(r.status, 401);
  assert.equal(r.data.code, 'token_expired');

  // Valid signature but issued for the website, not the admin panel
  const webToken = jwt.sign(claims, SECRET, { ...opts, audience: 'landroof-web', expiresIn: '5m' });
  assert.equal((await req('GET', '/api/admin/stats', { token: webToken })).status, 401);
});

test('authorization: a valid admin-panel token without the admin role gets 403', async () => {
  const token = jwt.sign({ role: 'user', pv: jwt.decode(adminToken).pv }, SECRET,
    { issuer: 'landroof', audience: 'landroof-admin', subject: 'someone', expiresIn: '5m' });
  const r = await req('GET', '/api/admin/stats', { token });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'forbidden');
});

test('admin refresh rotates the cookie, reuse is detected, logout revokes', async () => {
  const login = await req('POST', '/api/admin/auth/login', { body: { username: 'admin', password: 'test-password-123' } });
  const first = login.cookie;

  const r1 = await req('POST', '/api/admin/auth/refresh', { cookie: first });
  assert.equal(r1.status, 200);
  assert.ok(r1.data.accessToken);
  assert.notEqual(r1.cookie, first); // rotated
  assert.equal((await req('GET', '/api/admin/stats', { token: r1.data.accessToken })).status, 200);

  // A second tab presenting the just-rotated cookie within 30 s is fine (no logout)
  const tab2 = await req('POST', '/api/admin/auth/refresh', { cookie: first });
  assert.equal(tab2.status, 200);

  // Re-using an old cookie later looks like theft → the whole login is revoked
  const db = require('../src/config/database');
  db.prepare("UPDATE refresh_tokens SET revoked_at=datetime('now','-2 minutes') WHERE revoked_at IS NOT NULL").run();
  const replay = await req('POST', '/api/admin/auth/refresh', { cookie: first });
  assert.equal(replay.data.code, 'refresh_token_reused');
  assert.equal((await req('POST', '/api/admin/auth/refresh', { cookie: r1.cookie })).status, 401);
  assert.equal((await req('POST', '/api/admin/auth/refresh', { cookie: tab2.cookie })).status, 401);

  // Normal logout
  const login2 = await req('POST', '/api/admin/auth/login', { body: { username: 'admin', password: 'test-password-123' } });
  await req('POST', '/api/admin/auth/logout', { cookie: login2.cookie });
  assert.equal((await req('POST', '/api/admin/auth/refresh', { cookie: login2.cookie })).status, 401);
  assert.equal((await req('POST', '/api/admin/auth/refresh')).data.code, 'no_refresh_token');
});

// ── Admin content management ─────────────────────────────────────────────
test('property edit can clear optional fields and set numbers to 0', async () => {
  const created = await req('POST', '/api/admin/properties', { token: adminToken,
    body: { title: 'Test Flat', price_label: '₹50 Lac', city: 'Pune', beds: 2, rera: 'P123', description: 'x' } });
  assert.equal(created.status, 200);
  const id = created.data.id;
  await req('PUT', `/api/admin/properties/${id}`, { token: adminToken, body: { beds: 0, rera: '', description: '', title: '' } });
  const p = (await req('GET', `/api/properties/${id}`)).data.data;
  assert.equal(p.beds, 0);
  assert.equal(p.rera, '');
  assert.equal(p.description, '');
  assert.equal(p.title, 'Test Flat'); // required field can't be blanked
  assert.equal((await req('DELETE', `/api/admin/properties/${id}`, { token: adminToken })).status, 200);
});

test('property create validates required fields', async () => {
  const r = await req('POST', '/api/admin/properties', { token: adminToken, body: { title: 'No price' } });
  assert.equal(r.status, 400);
});

test('every content type supports create, list, update and delete', async () => {
  const cases = [
    ['testimonials', { name: 'Asha', text: 'Great service', rating: 4 }, { text: 'Updated' }],
    ['team', { name: 'Ravi', role: 'Advisor' }, { role: 'Senior Advisor' }],
    ['events', { title: 'Expo', event_date: '2026-12-01', location: 'Pune' }, { location: 'Mumbai' }],
    ['announcements', { title: 'Diwali offer', type: 'promo' }, { body: 'Zero fees' }],
    ['schemes', { title: '5% off', valid_until: '2099-01-01' }, { description: 'Limited' }],
    ['social-posts', { platform: 'instagram', url: 'https://instagram.com/p/1', caption: 'Hi' }, { caption: 'Hello' }],
  ];
  for (const [path, createBody, updateBody] of cases) {
    const c = await req('POST', `/api/admin/${path}`, { token: adminToken, body: createBody });
    assert.equal(c.status, 200, `${path} create: ${JSON.stringify(c.data)}`);
    const u = await req('PUT', `/api/admin/${path}/${c.data.id}`, { token: adminToken, body: updateBody });
    assert.equal(u.status, 200, `${path} update`);
    const [k, v] = Object.entries(updateBody)[0];
    assert.equal(u.data.data[k], v, `${path} updated value`);
    const pub = await req('GET', `/api/${path}`);
    assert.ok(pub.data.data.some(r => r.id === c.data.id), `${path} visible on public API`);
    assert.equal((await req('DELETE', `/api/admin/${path}/${c.data.id}`, { token: adminToken })).status, 200);
  }
});

test('hidden content is not shown on the public site', async () => {
  const c = await req('POST', '/api/admin/testimonials', { token: adminToken, body: { name: 'Hidden', text: 'x', is_active: '0' } });
  const pub = await req('GET', '/api/testimonials');
  assert.ok(!pub.data.data.some(r => r.id === c.data.id));
  await req('DELETE', `/api/admin/testimonials/${c.data.id}`, { token: adminToken });
});

test('image upload: images accepted, other files rejected, files cleaned up on delete', async () => {
  const bad = new FormData();
  bad.set('image', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'evil.html');
  const rejected = await req('POST', '/api/admin/media', { token: adminToken, form: bad });
  assert.equal(rejected.status, 400);
  assert.doesNotMatch(JSON.stringify(rejected.data), /[A-Z]:\\|\/home\/|node_modules/); // no path leaks

  // HTML that claims to be a PNG is caught by the content (magic number) check and deleted
  const disguised = new FormData();
  disguised.set('image', new Blob(['<html><script>alert(1)</script></html>'], { type: 'image/png' }), 'x.png');
  const before = fs.readdirSync(process.env.UPLOAD_DIR).length;
  const fake = await req('POST', '/api/admin/media', { token: adminToken, form: disguised });
  assert.equal(fake.status, 400);
  assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, before);

  const good = new FormData();
  good.set('image', new Blob([PNG], { type: 'image/png' }), 'photo.html'); // misleading name
  good.set('caption', 'Site visit');
  const created = await req('POST', '/api/admin/media', { token: adminToken, form: good });
  assert.equal(created.status, 200);
  const filename = created.data.data.filename;
  assert.match(filename, /\.png$/); // extension comes from the MIME type, not the filename
  assert.ok(fs.existsSync(path.join(process.env.UPLOAD_DIR, filename)));

  const img = await fetch(base + created.data.data.image_url);
  assert.equal(img.headers.get('content-type'), 'image/png');

  await req('DELETE', `/api/admin/media/${created.data.id}`, { token: adminToken });
  assert.ok(!fs.existsSync(path.join(process.env.UPLOAD_DIR, filename)));
});

test('media upload requires an image', async () => {
  const r = await req('POST', '/api/admin/media', { token: adminToken, body: { caption: 'x' } });
  assert.equal(r.status, 400);
});

test('site numbers saved in admin are served to the website', async () => {
  assert.equal((await req('GET', '/api/site-config')).data.data.whatsapp_number, '918862019122'); // Landroof's WhatsApp by default
  const bad = await req('PUT', '/api/admin/site-config', { token: adminToken, body: { satisfaction_rate: '150' } });
  assert.equal(bad.status, 400);
  const r = await req('PUT', '/api/admin/site-config', { token: adminToken,
    body: { cities_covered: '25', whatsapp_number: '+91 98765 43210', unknown_key: 'ignored' } });
  assert.equal(r.status, 200);
  const pub = (await req('GET', '/api/site-config')).data.data;
  assert.equal(pub.cities_covered, '25');
  assert.equal(pub.whatsapp_number, '919876543210');
  assert.equal(pub.unknown_key, undefined);
});

// ── Visitor accounts (JWT) + wishlist ─────────────────────────────────────
test('visitor can register, sign in, save properties and sign out', async () => {
  const weak = await req('POST', '/api/auth/register', { body: { name: 'U', email: 'u@test.in', password: 'short' } });
  assert.equal(weak.status, 400);

  const reg = await registerVerified('Uma', 'U@Test.in', 'Sunrise2026', { interest: 'buy' });
  assert.equal(reg.status, 200);
  assert.equal(reg.data.user.email, 'u@test.in');
  assert.equal(reg.data.user.pass_hash, undefined);
  assert.equal(jwt.decode(reg.data.accessToken).aud, 'landroof-web');
  assert.match(reg.setCookies[0], /^lr_rt=.*HttpOnly.*/);

  assert.equal((await req('POST', '/api/auth/login', { body: { email: 'u@test.in', password: 'wrong-pass' } })).status, 401);
  const login = await req('POST', '/api/auth/login', { body: { email: 'u@test.in', password: 'Sunrise2026' } });
  const token = login.data.accessToken;
  assert.equal((await req('GET', '/api/auth/me', { token })).data.user.name, 'Uma');

  const saved = await req('PUT', '/api/wishlist', { token, body: { ids: [1, 2, 9999] } });
  assert.deepEqual(saved.data.data.sort(), [1, 2]); // unknown property ignored
  assert.equal((await req('PUT', '/api/wishlist', { body: { ids: [1] } })).status, 401); // no token

  const users = await req('GET', '/api/admin/users', { token: adminToken });
  assert.equal(users.data.data.find(u => u.email === 'u@test.in').saved, 2);

  // Refresh gives a new access token; logout revokes the refresh cookie
  const refreshed = await req('POST', '/api/auth/refresh', { cookie: login.cookie });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.data.user.email, 'u@test.in');
  await req('POST', '/api/auth/logout', { cookie: refreshed.cookie });
  assert.equal((await req('POST', '/api/auth/refresh', { cookie: refreshed.cookie })).status, 401);
});

test('visitor and admin tokens cannot be swapped', async () => {
  const login = await req('POST', '/api/auth/login', { body: { email: 'u@test.in', password: 'Sunrise2026' } });
  assert.equal((await req('GET', '/api/admin/stats', { token: login.data.accessToken })).status, 401);
  assert.equal((await req('GET', '/api/auth/me', { token: adminToken })).status, 401);
  // A visitor refresh cookie is useless on the admin refresh endpoint
  const cookieAsAdmin = login.cookie.replace(/^lr_rt=/, 'lr_admin_rt=');
  assert.equal((await req('POST', '/api/admin/auth/refresh', { cookie: cookieAsAdmin })).status, 401);
});

test('sign out everywhere and password change invalidate existing access tokens', async () => {
  await registerVerified('Vik', 'v@test.in', 'Sunrise2026');
  const a = await req('POST', '/api/auth/login', { body: { email: 'v@test.in', password: 'Sunrise2026' } });
  const b = await req('POST', '/api/auth/login', { body: { email: 'v@test.in', password: 'Sunrise2026' } });

  // Device A changes the password → device B's JWT and refresh cookie stop working
  const bad = await req('POST', '/api/auth/change-password', { token: a.data.accessToken, body: { currentPassword: 'nope', newPassword: 'Monsoon2027' } });
  assert.equal(bad.status, 400);
  const changed = await req('POST', '/api/auth/change-password', { token: a.data.accessToken, body: { currentPassword: 'Sunrise2026', newPassword: 'Monsoon2027' } });
  assert.equal(changed.status, 200);
  assert.equal((await req('GET', '/api/auth/me', { token: b.data.accessToken })).data.code, 'token_revoked');
  assert.equal((await req('POST', '/api/auth/refresh', { cookie: b.cookie })).status, 401);
  assert.equal((await req('GET', '/api/auth/me', { token: changed.data.accessToken })).status, 200);
  assert.equal((await req('POST', '/api/auth/login', { body: { email: 'v@test.in', password: 'Sunrise2026' } })).status, 401);

  // Sign out everywhere
  const c = await req('POST', '/api/auth/login', { body: { email: 'v@test.in', password: 'Monsoon2027' } });
  assert.equal((await req('POST', '/api/auth/logout-all', { token: c.data.accessToken })).status, 200);
  assert.equal((await req('GET', '/api/auth/me', { token: c.data.accessToken })).status, 401);
  assert.equal((await req('GET', '/api/auth/me', { token: changed.data.accessToken })).status, 401);
  assert.equal((await req('POST', '/api/auth/refresh', { cookie: c.cookie })).status, 401);
});

// ── Email verification, password reset, enumeration ──────────────────────
test('new accounts are signed in straight away, with no confirmation email', async () => {
  const r = await req('POST', '/api/auth/register', { body: { name: 'Nina Rao', email: 'nina@test.in', password: 'Lantern2026' } });
  assert.equal(r.status, 200);
  assert.ok(r.data.accessToken);
  assert.equal(r.data.user.email_verified, true);
  assert.equal(lastEmail('nina@test.in'), null); // nothing to confirm
  assert.equal((await req('POST', '/api/auth/login', { body: { email: 'nina@test.in', password: 'Lantern2026' } })).status, 200);
  assert.equal((await req('POST', '/api/auth/verify-email', { body: { token: 'x' } })).status, 404);
});

test('registering an existing email is refused; forgot-password never reveals whether an email exists', async () => {
  const existing = await req('POST', '/api/auth/register', { body: { name: 'Uma Again', email: 'u@test.in', password: 'Another2026' } });
  assert.equal(existing.status, 409);
  assert.equal(existing.data.code, 'email_taken');
  assert.ok(existing.data.fields.email);

  const f1 = await req('POST', '/api/auth/forgot-password', { body: { email: 'u@test.in' } });
  const f2 = await req('POST', '/api/auth/forgot-password', { body: { email: 'ghost@test.in' } });
  assert.equal(f1.status, f2.status);
  assert.deepEqual(f1.data, f2.data);
  assert.equal(lastEmail('ghost@test.in'), null);

  // Sign-in takes about as long for unknown emails as for real ones
  const time = async email => { const t = Date.now(); await req('POST', '/api/auth/login', { body: { email, password: 'WrongPass99' } }); return Date.now() - t; };
  let known = 0, unknown = 0;
  for (let i = 0; i < 3; i++) { known += await time('u@test.in'); unknown += await time('nobody-here@test.in'); }
  assert.ok(unknown >= known * 0.4, `unknown ${unknown}ms vs known ${known}ms`);
});

test('password reset link sets a new password, works once and signs other devices out', async () => {
  const other = await req('POST', '/api/auth/login', { body: { email: 'nina@test.in', password: 'Lantern2026' } });
  await req('POST', '/api/auth/forgot-password', { body: { email: 'nina@test.in' } });
  const token = await waitFor(() => linkToken(lastEmail('nina@test.in'), 'reset'));
  assert.ok(token);

  const weak = await req('POST', '/api/auth/reset-password', { body: { token, password: 'short' } });
  assert.equal(weak.status, 400);
  assert.ok(weak.data.fields.password);
  const ok = await req('POST', '/api/auth/reset-password', { body: { token, password: 'Compass2027' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.accessToken);
  assert.equal((await req('POST', '/api/auth/reset-password', { body: { token, password: 'Compass2028' } })).status, 400); // used
  assert.equal((await req('GET', '/api/auth/me', { token: other.data.accessToken })).status, 401);
  assert.equal((await req('POST', '/api/auth/login', { body: { email: 'nina@test.in', password: 'Compass2027' } })).status, 200);
  assert.match(await waitFor(() => lastEmail('nina@test.in')), /password was changed/i);
});

test('passwords use strong scrypt hashes; old-format hashes are upgraded on sign-in', async () => {
  const db = require('../src/config/database');
  assert.match(db.prepare("SELECT pass_hash FROM users WHERE email='nina@test.in'").get().pass_hash, /^scrypt\$12\$8\$1\$/);

  // Simulate an account created by the previous version (salt:hash with default cost)
  const crypto = require('crypto');
  const salt = crypto.randomBytes(16).toString('hex');
  const legacy = `${salt}:${crypto.scryptSync('Legacy2026', salt, 64).toString('hex')}`;
  db.prepare("INSERT INTO users (name,email,pass_hash,email_verified_at) VALUES ('Old User','old@test.in',?,datetime('now'))").run(legacy);
  assert.equal((await req('POST', '/api/auth/login', { body: { email: 'old@test.in', password: 'Legacy2026' } })).status, 200);
  assert.match(db.prepare("SELECT pass_hash FROM users WHERE email='old@test.in'").get().pass_hash, /^scrypt\$/);
});

// ── Security headers & strict CSP ─────────────────────────────────────────
test('pages send a strict Content-Security-Policy and contain no inline handlers', async () => {
  for (const page of ['/', '/admin']) {
    const r = await req('GET', page);
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-(inline|eval)/);
    assert.match(csp, /object-src 'none'/);
    assert.match(r.headers.get('permissions-policy'), /camera=\(\)/);
    assert.doesNotMatch(r.data, /\son(click|submit|input|change|error|load)=/i);
    assert.doesNotMatch(r.data, /<script>(?!\s*$)/); // no inline <script> blocks
  }
});

test('cookie endpoints reject cross-site requests (CSRF defence in depth)', async () => {
  const login = await req('POST', '/api/admin/auth/login', { body: { username: 'admin', password: 'test-password-123' } });
  const cross = await fetch(base + '/api/admin/auth/refresh', { method: 'POST', headers: { Cookie: login.cookie, Origin: 'https://evil.example' } });
  assert.equal(cross.status, 403);
  const fetchMeta = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(fetchMeta.status, 403);
  const same = await fetch(base + '/api/admin/auth/refresh', { method: 'POST', headers: { Cookie: login.cookie, Origin: base } });
  assert.equal(same.status, 200);
});

// ── Admin activity log & privacy tools ────────────────────────────────────
test('admin changes, exports and failed sign-ins are recorded in the activity log', async () => {
  await req('POST', '/api/admin/auth/login', { body: { username: 'admin', password: 'nope' } });
  const t = await req('POST', '/api/admin/testimonials', { token: adminToken, body: { name: 'Audit Test', text: 'Logged' } });
  await req('GET', '/api/admin/leads?csv=1', { token: adminToken });
  const log = (await req('GET', '/api/admin/audit', { token: adminToken })).data.data;
  assert.ok(log.some(a => a.action === 'admin.login_failed'));
  assert.ok(log.some(a => a.action === 'create' && a.target === 'testimonials' && a.details === 'Audit Test'));
  assert.ok(log.some(a => a.action === 'export' && a.target === 'leads'));
  assert.ok(log.some(a => a.action === 'admin.login'));
  await req('DELETE', `/api/admin/testimonials/${t.data.id}`, { token: adminToken });
  assert.equal((await req('GET', '/api/admin/audit')).status, 401); // admin only
});

test('right to erasure removes every lead and the account for an email', async () => {
  await req('POST', '/api/leads', { body: { source: 'contact', name: 'Erase Me', email: 'erase@test.in', message: 'Please call me back soon' } });
  await registerVerified('Erase Me', 'erase@test.in', 'Garden2026x');
  const r = await req('POST', '/api/admin/privacy/erase', { token: adminToken, body: { email: 'ERASE@test.in' } });
  assert.equal(r.status, 200);
  assert.ok(r.data.data.leads >= 2); // contact form + registration
  assert.equal(r.data.data.accounts, 1);
  const leads = (await req('GET', '/api/admin/leads', { token: adminToken })).data.data;
  assert.ok(!leads.some(l => l.email === 'erase@test.in'));
  assert.equal((await req('POST', '/api/auth/login', { body: { email: 'erase@test.in', password: 'Garden2026x' } })).status, 401);
});

test('data retention blanks old IP addresses and deletes very old leads', async () => {
  const db = require('../src/config/database');
  const Lead = require('../src/models/Lead');
  db.prepare("INSERT INTO leads (email,ip_address,user_agent,source,created_at) VALUES ('old-ip@test.in','1.2.3.4','UA','search',datetime('now','-100 days'))").run();
  db.prepare("INSERT INTO leads (email,ip_address,source,created_at) VALUES ('ancient@test.in','5.6.7.8','search',datetime('now','-800 days'))").run();
  Lead.applyRetention(730, 90);
  assert.equal(db.prepare("SELECT ip_address FROM leads WHERE email='old-ip@test.in'").get().ip_address, '');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM leads WHERE email='ancient@test.in'").get().n, 0);
});

test('production refuses to start with a weak admin password or no JWT secret', () => {
  const { spawnSync } = require('child_process');
  const run = extra => spawnSync(process.execPath, ['-e', "require('./src/app')"], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production', DB_PATH: path.join(tmp, 'prod.db'), ...extra },
  });
  const weak = run({ ADMIN_PASS: 'landroof2024' });
  assert.notEqual(weak.status, 0);
  assert.match(weak.stderr, /ADMIN_PASS/);
  const noSecret = run({ ADMIN_PASS: 'Long-Unique-Pass-2026', JWT_SECRET: '' });
  assert.notEqual(noSecret.status, 0);
  assert.match(noSecret.stderr, /JWT_SECRET/);
  const good = run({ ADMIN_PASS: 'Long-Unique-Pass-2026' });
  assert.equal(good.status, 0, good.stderr);
});

test('cities are managed from the admin panel, with a photo', async () => {
  const pub = await req('GET', '/api/cities');
  assert.deepEqual(pub.data.data.map(c => c.name), ['Pune', 'Mumbai', 'Bangalore', 'Hyderabad', 'Delhi NCR', 'Chennai']);
  assert.equal(pub.data.data[0].image_url, '/images/cities/pune.jpg');

  assert.equal((await req('POST', '/api/admin/cities', { body: { name: 'Nashik' } })).status, 401);
  assert.equal((await req('POST', '/api/admin/cities', { token: adminToken, body: { state: 'Maharashtra' } })).status, 400);

  const form = new FormData();
  form.set('name', 'Nashik'); form.set('state', 'Maharashtra'); form.set('order_idx', '7');
  form.set('image', new Blob([PNG], { type: 'image/png' }), 'nashik.png');
  const created = await req('POST', '/api/admin/cities', { token: adminToken, form });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const nashik = (await req('GET', '/api/cities')).data.data.find(c => c.name === 'Nashik');
  assert.equal(nashik.state, 'Maharashtra');
  assert.match(nashik.image_url, /^\/uploads\//);

  // Hidden cities are not shown on the website
  await req('PUT', `/api/admin/cities/${nashik.id}`, { token: adminToken, body: { is_active: 0 } });
  assert.ok(!(await req('GET', '/api/cities')).data.data.some(c => c.name === 'Nashik'));
  assert.equal((await req('DELETE', `/api/admin/cities/${nashik.id}`, { token: adminToken })).status, 200);
});

// A listing form with a photo, as the website sends it
function listingForm(data, photo = true) {
  const f = new FormData();
  Object.entries(data).forEach(([k, v]) => f.set(k, String(v)));
  if (photo) f.set('image', new Blob([PNG], { type: 'image/png' }), 'home.png');
  return f;
}

test('list property → admin approval → owner adds listings that go live after review', async () => {
  // Earlier tests used up this IP's form and sign-up allowance
  const { limiters } = require('../src/middleware/rateLimit');
  ['::ffff:127.0.0.1', '127.0.0.1', '::1'].forEach(ip => { limiters.leads.reset(ip); limiters.register.reset(ip); });
  const outbox = (to, subject) => waitFor(() => {
    const html = lastEmail(to);
    return html && (!subject || html.includes(subject)) ? html : null;
  });
  const listReq = email => req('POST', '/api/leads', { body: { source: 'list-property', name: 'Owner Olivia', email, phone: '9823456781', search_city: 'Pune', search_type: 'buy', message: '2 BHK in Baner' } });

  // 1. Request: saved once, admin notified
  const first = await listReq('olivia@test.in');
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.deepEqual(first.data.listing, { status: 'pending', existing: false });
  assert.ok(await outbox('info@landroof.com', 'New listing request'));
  assert.equal((await listReq('olivia@test.in')).data.listing.existing, true);
  const requests = (await req('GET', '/api/admin/listing-requests', { token: adminToken })).data.data;
  const olivia = requests.find(r => r.email === 'olivia@test.in');
  assert.equal(olivia.status, 'pending');
  assert.ok(!('link_hash' in olivia));
  assert.ok((await req('GET', '/api/admin/stats', { token: adminToken })).data.data.pending_requests >= 1);

  // 2. Not approved yet → no listings
  const signup = await registerVerified('Olivia', 'olivia@test.in', 'Garden-Path-2026');
  let ownerToken = signup.data.accessToken;
  assert.equal(signup.data.user.is_owner, false);
  const listing = { title: 'Sunny 2 BHK in Baner', type: 'buy', subtype: 'Apartment', price_label: '₹85 Lakh', price_val: 8500000, city: 'Pune', locality: 'Baner', area: '950 sq ft', beds: 2, baths: 2, is_featured: 1,
    description: 'Bright 2 BHK on the 5th floor, east facing, two balconies and covered parking.' };
  assert.equal((await req('POST', '/api/owner/properties', { token: ownerToken, body: listing })).status, 403);

  // 3. Admin approves → email with a one-time link that signs the owner in
  assert.equal((await req('POST', `/api/admin/listing-requests/${olivia.id}/decision`, { token: adminToken, body: { status: 'approved' } })).status, 200);
  const link = linkToken(await outbox('olivia@test.in', 'is approved'), 'owner');
  assert.ok(link);
  const viaLink = await req('POST', '/api/auth/owner-link', { body: { token: link } });
  assert.equal(viaLink.status, 200);
  assert.equal(viaLink.data.user.is_owner, true);
  ownerToken = viaLink.data.accessToken;
  assert.equal((await req('POST', '/api/auth/owner-link', { body: { token: link } })).data.code, 'link_invalid'); // used once

  // 4. Owner adds a listing → waits for review, hidden from the public, admin notified
  // Mandatory details are checked before a listing goes to review
  const incomplete = await req('POST', '/api/owner/properties', { token: ownerToken, body: { ...listing, description: 'Nice' } });
  assert.equal(incomplete.status, 400);
  assert.ok(incomplete.data.fields.description && incomplete.data.fields.image);
  const created = await req('POST', '/api/owner/properties', { token: ownerToken, form: listingForm(listing) });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const pid = created.data.data.id;
  assert.equal(created.data.data.review_status, 'pending');
  assert.equal(created.data.data.is_featured, 0); // featuring is the admin's decision
  assert.ok(await outbox('info@landroof.com', 'listing to review'));
  const publicTitles = async () => (await req('GET', '/api/properties?limit=500')).data.data.map(p => p.title);
  assert.ok(!(await publicTitles()).includes(listing.title));
  assert.equal((await req('GET', `/api/properties/${pid}`)).status, 404);
  const adminProps = (await req('GET', '/api/admin/properties', { token: adminToken })).data.data;
  assert.equal(adminProps.find(p => p.id === pid).owner.email, 'olivia@test.in');

  // 5. Admin approves the listing → live, owner emailed
  await req('POST', `/api/admin/properties/${pid}/review`, { token: adminToken, body: { status: 'approved' } });
  assert.ok((await publicTitles()).includes(listing.title));
  assert.ok(await outbox('olivia@test.in', 'Your listing is live'));

  // 6. An edit goes back to review; nobody else can touch the listing
  const edited = await req('PUT', `/api/owner/properties/${pid}`, { token: ownerToken, body: { price_label: '₹82 Lakh' } });
  assert.equal(edited.data.data.review_status, 'pending');
  assert.ok(!(await publicTitles()).includes(listing.title));
  const stranger = (await registerVerified('Sam', 'sam.stranger@test.in', 'Blue-River-2026')).data.accessToken;
  assert.equal((await req('DELETE', `/api/owner/properties/${pid}`, { token: stranger })).status, 404);
  assert.equal((await req('GET', '/api/owner/properties', { token: ownerToken })).data.data.length, 1);

  // 7. Owners page counts the owner's listings
  const owners = (await req('GET', '/api/admin/owners', { token: adminToken })).data.data;
  assert.deepEqual((({ total, live, pending }) => ({ total, live, pending }))(owners.find(o => o.email === 'olivia@test.in')), { total: 1, live: 0, pending: 1 });

  // 8. Someone without an account: the link asks for a password, then signs them in
  await listReq('newowner@test.in');
  const nr = (await req('GET', '/api/admin/listing-requests', { token: adminToken })).data.data.find(r => r.email === 'newowner@test.in');
  await req('POST', `/api/admin/listing-requests/${nr.id}/decision`, { token: adminToken, body: { status: 'approved' } });
  const newLink = linkToken(await outbox('newowner@test.in', 'is approved'), 'owner');
  const ask = await req('POST', '/api/auth/owner-link', { body: { token: newLink } });
  assert.deepEqual([ask.data.needsPassword, ask.data.email], [true, 'newowner@test.in']);
  assert.equal((await req('POST', '/api/auth/owner-link', { body: { token: newLink, password: 'short' } })).status, 400);
  const made = await req('POST', '/api/auth/owner-link', { body: { token: newLink, password: 'Green-Field-2026' } });
  assert.equal(made.status, 200);
  assert.equal(made.data.user.is_owner, true);

  // 9. Rejection: polite email, no owner rights
  await listReq('rejected.owner@test.in');
  const rr = (await req('GET', '/api/admin/listing-requests', { token: adminToken })).data.data.find(r => r.email === 'rejected.owner@test.in');
  await req('POST', `/api/admin/listing-requests/${rr.id}/decision`, { token: adminToken, body: { status: 'rejected' } });
  assert.ok(await outbox('rejected.owner@test.in', 'unable to approve'));
  const rejectedUser = (await registerVerified('Rex', 'rejected.owner@test.in', 'Quiet-Hill-2026')).data;
  assert.equal(rejectedUser.user.is_owner, false);
});

test('admin can change the password from the dashboard', async () => {
  const change = (token, currentPassword, newPassword, cookie) =>
    req('POST', '/api/admin/auth/change-password', { token, cookie, body: { currentPassword, newPassword } });
  const login = password => req('POST', '/api/admin/auth/login', { body: { username: 'admin', password } });

  assert.equal((await change(undefined, 'test-password-123', 'New-Admin-Pass-2026')).status, 401);
  const wrong = await change(adminToken, 'not-my-password', 'New-Admin-Pass-2026');
  assert.equal(wrong.status, 400);
  assert.ok(wrong.data.fields.currentPassword);
  assert.ok((await change(adminToken, 'test-password-123', 'short1')).data.fields.newPassword);
  assert.ok((await change(adminToken, 'test-password-123', 'onlyletterslong')).data.fields.newPassword);

  const session = await login('test-password-123');
  const ok = await change(adminToken, 'test-password-123', 'New-Admin-Pass-2026', session.cookie);
  assert.equal(ok.status, 200);
  assert.ok(ok.data.accessToken);

  // Old tokens and the old refresh cookie stop working; the new token works
  assert.equal((await req('GET', '/api/admin/stats', { token: adminToken })).status, 401);
  assert.equal((await req('POST', '/api/admin/auth/refresh', { cookie: session.cookie })).status, 401);
  assert.equal((await req('GET', '/api/admin/stats', { token: ok.data.accessToken })).status, 200);

  // Only the new password signs in
  assert.equal((await login('test-password-123')).status, 401);
  assert.equal((await login('New-Admin-Pass-2026')).status, 200);

  // Put the original password back for the remaining tests
  const back = await change(ok.data.accessToken, 'New-Admin-Pass-2026', 'test-password-123');
  assert.equal(back.status, 200);
  adminToken = back.data.accessToken;
});

test('listing pages have their own URL, title and share details', async () => {
  const add = await req('POST', '/api/admin/properties', { token: adminToken, body: { title: 'Riverside <b>Villa</b>', type: 'buy', price_label: '₹2 Cr', price_val: 20000000, city: 'Pune', locality: 'Aundh', area: '2000 sq ft', description: 'A quiet villa by the river.' } });
  const id = add.data.data.id;
  const page = await req('GET', `/property/${id}`);
  assert.equal(page.status, 200);
  assert.match(page.data, /<title>Riverside &lt;b&gt;Villa&lt;\/b&gt; — Aundh, Pune \| Landroof<\/title>/); // title is escaped
  assert.match(page.data, new RegExp(`rel="canonical" href="https://example.test/property/${id}"`));
  assert.match(page.data, /og:description" content="₹2 Cr\. A quiet villa by the river\./);
  assert.match(page.data, /"@type":"RealEstateListing"/);
  assert.doesNotMatch(page.data, /"name":"Riverside <b>/); // no HTML can break out of the JSON block
  assert.match(page.data, /href="\/\?type=buy"/);
  assert.equal((await req('GET', '/property/99999')).status, 404);
  assert.equal((await req('GET', '/property/abc')).status, 404);
  assert.match((await req('GET', '/sitemap.xml')).data, new RegExp(`/property/${id}<`));
  // Sold listings keep their page; drafts and pending ones have none
  await req('POST', `/api/admin/properties/${id}/listing-status`, { token: adminToken, body: { status: 'sold' } });
  assert.equal((await req('GET', `/property/${id}`)).status, 200);
  await req('POST', `/api/admin/properties/${id}/review`, { token: adminToken, body: { status: 'under_review' } });
  assert.equal((await req('GET', `/property/${id}`)).status, 404);
  await req('DELETE', `/api/admin/properties/${id}`, { token: adminToken });
});

test('search leads need a mobile number, and it reaches the admin', async () => {
  const { limiters } = require('../src/middleware/rateLimit');
  ['::ffff:127.0.0.1', '127.0.0.1', '::1'].forEach(ip => limiters.leads.reset(ip));
  const search = body => req('POST', '/api/leads', { body: { source: 'search', search_city: 'Pune', search_type: 'buy', ...body } });
  const missing = await search({});
  assert.equal(missing.status, 400);
  assert.ok(missing.data.fields.phone);
  assert.ok((await search({ phone: '123' })).data.fields.phone);
  assert.equal((await search({ phone: '98234 56799' })).status, 200);
  const lead = (await req('GET', '/api/admin/leads', { token: adminToken })).data.data.find(l => l.source === 'search' && l.phone === '+919823456799');
  assert.equal(lead.search_city, 'Pune');
});

test('search: filters, sort, paging, rate per sq ft, amenities, map area, suggestions', async () => {
  const add = body => req('POST', '/api/admin/properties', { token: adminToken, body });
  const base = { type: 'buy', subtype: 'Apartment', city: 'Testpur', beds: 2, description: 'Search test listing' };
  const a = (await add({ ...base, title: 'Alpha Flat', locality: 'North End', price_label: '₹50 Lakh', price_val: 5000000, area: '1000 sq ft', furnishing: 'Furnished', possession: 'Ready to Move', age_band: '1-5 years', amenities: 'Lift, Gym, Parking', lat: '18.50', lng: '73.80' })).data.data;
  const b = (await add({ ...base, title: 'Beta Flat', locality: 'South End', price_label: '₹90 Lakh', price_val: 9000000, area: '1000 sq ft', possession: 'Under Construction', amenities: 'Lift', lat: '19.10', lng: '72.90' })).data.data;
  const c = (await add({ ...base, title: 'Gamma Flat', locality: 'North End', price_label: '₹70 Lakh', price_val: 7000000, area: '1400 sq ft', amenities: 'Gym, Parking', beds: 3 })).data.data;
  const ids = async qs => { const r = await req('GET', `/api/properties?city=Testpur&${qs}`); assert.equal(r.status, 200); return r.data; };

  assert.equal(a.listing_code, `LR${String(a.id).padStart(5, '0')}`);
  assert.equal(a.rate_sqft, 5000);
  assert.deepEqual((await ids('sort=price_asc')).data.map(p => p.title), ['Alpha Flat', 'Gamma Flat', 'Beta Flat']);
  assert.deepEqual((await ids('sort=price_desc')).data.map(p => p.title), ['Beta Flat', 'Gamma Flat', 'Alpha Flat']);
  const page1 = await ids('sort=price_asc&limit=2'), page2 = await ids('sort=price_asc&limit=2&offset=2');
  assert.equal(page1.total, 3);
  assert.equal(page1.data.length, 2);
  assert.deepEqual(page2.data.map(p => p.title), ['Beta Flat']);
  assert.deepEqual((await ids('rate=0-5500')).data.map(p => p.title).sort(), ['Alpha Flat', 'Gamma Flat']); // Gamma = 5,000 / sq ft
  assert.deepEqual((await ids('amenities=Gym,Parking')).data.map(p => p.title).sort(), ['Alpha Flat', 'Gamma Flat']);
  assert.deepEqual((await ids('furnishing=Furnished')).data.map(p => p.title), ['Alpha Flat']);
  assert.deepEqual((await ids('possession=under-construction')).data.map(p => p.title), ['Beta Flat']);
  assert.deepEqual((await ids('age=1-5%20years')).data.map(p => p.title), ['Alpha Flat']);
  assert.deepEqual((await ids('locality=north&sort=newest')).data.map(p => p.title), ['Gamma Flat', 'Alpha Flat']);
  assert.deepEqual((await ids('bounds=18,73,19,74')).data.map(p => p.title), ['Alpha Flat']); // map area
  assert.deepEqual((await ids(`q=LR${String(b.id).padStart(5, '0')}`)).data.map(p => p.title), ['Beta Flat']); // by listing ID
  assert.ok(!('owner_id' in (await ids('')).data[0])); // internal fields stay private

  const sug = (await req('GET', '/api/property-suggestions?city=Testpur&type=buy')).data.data;
  assert.deepEqual(sug.localities.map(l => l.name), ['North End', 'South End']);
  const similar = (await req('GET', `/api/properties/${a.id}/similar`)).data.data.map(p => p.title);
  assert.equal(similar[0], 'Gamma Flat'); // same locality first
  assert.ok(!similar.includes('Alpha Flat'));

  // Sold listings leave the search, but their page says so
  await req('POST', `/api/admin/properties/${c.id}/listing-status`, { token: adminToken, body: { status: 'sold' } });
  assert.ok(!(await ids('')).data.some(p => p.id === c.id));
  assert.equal((await req('GET', `/api/properties/${c.id}`)).data.data.listing_status, 'sold');
  assert.equal((await req('GET', `/api/properties?ids=${c.id}`)).data.data[0].listing_status, 'sold'); // saved lists still show it
  for (const p of [a, b, c]) await req('DELETE', `/api/admin/properties/${p.id}`, { token: adminToken });
});

test('listing workflow: draft, corrections, verification, sold, expiry, documents, history', async () => {
  const { limiters } = require('../src/middleware/rateLimit');
  ['::ffff:127.0.0.1', '127.0.0.1', '::1'].forEach(ip => { limiters.leads.reset(ip); limiters.register.reset(ip); });
  // An approved owner
  await req('POST', '/api/leads', { body: { source: 'list-property', name: 'Willa Flow', email: 'willa@test.in', phone: '9823456700', search_city: 'Pune' } });
  const r = (await req('GET', '/api/admin/listing-requests', { token: adminToken })).data.data.find(x => x.email === 'willa@test.in');
  await req('POST', `/api/admin/listing-requests/${r.id}/decision`, { token: adminToken, body: { status: 'approved' } });
  const owner = (await registerVerified('Willa Flow', 'willa@test.in', 'Silver-Lake-2026')).data.accessToken;
  const own = (method, url, opts = {}) => req(method, url, { token: owner, ...opts });

  // Draft: saved without every detail, not sent to the team
  const draft = await own('POST', '/api/owner/properties', { form: listingForm({ title: 'Draft Villa', type: 'buy', price_label: '₹2 Cr', city: 'Pune', draft: '1' }, false) });
  assert.equal(draft.status, 200, JSON.stringify(draft.data));
  const id = draft.data.data.id;
  assert.equal(draft.data.data.review_status, 'draft');
  assert.equal((await own('PUT', `/api/owner/properties/${id}`, { body: { locality: 'Aundh' } })).status, 400); // submitting needs every detail

  // Submit with photos, a floor plan and a (private) document
  const form = listingForm({ subtype: 'Villa / Bungalow', price_val: 20000000, locality: 'Aundh', area: '3200 sq ft', beds: 4, description: 'Independent villa with a garden, four bedrooms and two car parks.', amenities: 'Garden, Parking' });
  form.append('gallery', new Blob([PNG], { type: 'image/png' }), 'g1.png');
  form.set('floor_plan', new Blob([PNG], { type: 'image/png' }), 'plan.png');
  form.append('documents', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), '7-12 extract.pdf');
  const sub = await own('PUT', `/api/owner/properties/${id}`, { form });
  assert.equal(sub.status, 200, JSON.stringify(sub.data));
  assert.equal(sub.data.data.review_status, 'pending');
  assert.equal(sub.data.data.gallery_urls.length, 1);
  assert.ok(sub.data.data.floor_plan_url);
  const fakeDoc = new FormData();
  fakeDoc.append('documents', new Blob(['<html>'], { type: 'application/pdf' }), 'x.pdf');
  assert.equal((await own('PUT', `/api/owner/properties/${id}`, { form: fakeDoc })).status, 400); // content check

  // Admin: under review → corrections asked (note required) → owner fixes → approved
  const review = (status, note) => req('POST', `/api/admin/properties/${id}/review`, { token: adminToken, body: { status, note } });
  assert.equal((await review('under_review')).data.data.review_status, 'under_review');
  assert.equal((await review('changes')).status, 400);
  assert.equal((await review('changes', 'Please add a photo of the kitchen')).data.data.review_status, 'changes');
  assert.ok((await waitFor(() => lastEmail('willa@test.in'))).includes('Please add a photo of the kitchen'));
  const mine = (await own('GET', '/api/owner/properties')).data.data.find(p => p.id === id);
  assert.equal(mine.review_note, 'Please add a photo of the kitchen');
  await own('PUT', `/api/owner/properties/${id}`, { body: { description: 'Independent villa with a garden, four bedrooms, a new kitchen and two car parks.' } });
  const approved = (await review('approved')).data.data;
  assert.equal(approved.review_status, 'approved');
  assert.ok(approved.published_at && approved.expires_at); // owner listings get an end date

  // Visitors: who listed it, without contact details; documents stay private
  const pub = (await req('GET', `/api/properties/${id}`)).data.data;
  assert.equal(pub.lister.kind, 'owner');
  assert.equal(pub.lister.name, 'Willa F.');
  assert.ok(!JSON.stringify(pub).includes('willa@test.in'));
  assert.deepEqual(pub.documents, []);
  const details = (await req('GET', `/api/admin/properties/${id}/details`, { token: adminToken })).data.data;
  const doc = details.documents[0];
  assert.equal(doc.is_public, 0);
  assert.equal((await req('GET', `/api/documents/${doc.id}`)).status, 404);
  assert.equal((await req('GET', `/api/admin/documents/${doc.id}/file`)).status, 401);
  const dl = await req('GET', `/api/admin/documents/${doc.id}/file`, { token: adminToken });
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /^attachment/);
  await req('PUT', `/api/admin/documents/${doc.id}`, { token: adminToken, body: { is_public: true, kind: 'brochure' } });
  assert.equal((await req('GET', `/api/properties/${id}`)).data.data.documents.length, 1);
  assert.equal((await req('GET', `/api/documents/${doc.id}`)).status, 200);

  // Verification: staff only, and it says what was checked
  assert.equal((await req('POST', `/api/admin/properties/${id}/verify`, { token: adminToken, body: { verified: true } })).status, 400);
  const ver = await req('POST', `/api/admin/properties/${id}/verify`, { token: adminToken, body: { verified: true, scope: ['Site visited by our team'] } });
  assert.ok(ver.data.data.verified_at);
  assert.equal((await req('GET', `/api/properties/${id}`)).data.data.verify_scope, 'Site visited by our team');

  // Owner marks it sold → out of the search; expiry also takes live listings out
  assert.equal((await own('POST', `/api/owner/properties/${id}/status`, { body: { status: 'rented' } })).status, 400); // not a rental
  assert.equal((await own('POST', `/api/owner/properties/${id}/status`, { body: { status: 'sold' } })).data.data.listing_status, 'sold');
  assert.ok(!(await req('GET', '/api/properties?limit=500')).data.data.some(p => p.id === id));
  await req('POST', `/api/admin/properties/${id}/listing-status`, { token: adminToken, body: { status: 'active', expires_at: '2020-01-01' } });
  require('../src/services/maintenance').runMaintenance();
  assert.equal((await req('GET', `/api/properties/${id}`)).data.data.listing_status, 'expired');

  // History: every step, without staff names for the owner
  const history = (await own('GET', `/api/owner/properties/${id}/history`)).data;
  for (const step of ['draft.saved', 'resubmitted', 'review.changes', 'review.approved', 'verified', 'listing.status']) {
    assert.ok(history.data.some(e => e.action === step), step);
  }
  assert.ok(!JSON.stringify(history).includes('admin:'));

  // Duplicate check: the same villa sent again is flagged for the team
  const dup = await own('POST', '/api/owner/properties', { form: listingForm({ title: 'Draft Villa', type: 'buy', subtype: 'Villa / Bungalow', price_label: '₹2 Cr', price_val: 20000000, city: 'Pune', locality: 'Aundh', area: '3200 sq ft', beds: 4, description: 'Same villa listed again by mistake, with a garden and parking.' }) });
  assert.equal(dup.data.possible_duplicate, true);
  const dupDetails = (await req('GET', `/api/admin/properties/${dup.data.data.id}/details`, { token: adminToken })).data.data;
  assert.equal(dupDetails.duplicates[0].id, id);

  // Deleting a listing deletes its documents too
  const docFiles = () => fs.readdirSync(process.env.DOCS_DIR).length;
  const before = docFiles();
  assert.equal((await own('DELETE', `/api/owner/properties/${id}`)).status, 200);
  assert.equal(docFiles(), before - 1);
  await own('DELETE', `/api/owner/properties/${dup.data.data.id}`);
});

test('plot projects: inventory, plot statuses, reviewed approvals only, reports', async () => {
  const proj = (await req('POST', '/api/admin/properties', { token: adminToken, body: { title: 'Test Meadows', type: 'plots', subtype: 'Residential Plot', price_label: '₹2,000 / sq ft', city: 'Pune', locality: 'Maan', is_project: 1 } })).data.data;
  const bulk = (await req('POST', `/api/admin/properties/${proj.id}/plots/bulk`, { token: adminToken, body: { from: 1, to: 12, area_sqft: 1500, rate_sqft: 2000 } })).data;
  assert.equal(bulk.added, 12);
  const list = (await req('GET', `/api/properties/${proj.id}/plots`)).data;
  assert.equal(list.data.length, 12);
  assert.equal(list.data[0].total_price, 3000000);
  assert.deepEqual(list.data.slice(0, 3).map(p => p.plot_no), ['1', '2', '3']);
  const p5 = list.data[4];
  assert.equal((await req('PUT', `/api/admin/plots/${p5.id}`, { body: { status: 'sold' } })).status, 401); // staff only
  await req('PUT', `/api/admin/plots/${p5.id}`, { token: adminToken, body: { status: 'booked' } });
  const counts = (await req('GET', `/api/properties/${proj.id}/plots`)).data.counts;
  assert.deepEqual([counts.available, counts.booked, counts.total], [11, 1, 12]);
  const events = (await req('GET', `/api/admin/properties/${proj.id}/details`, { token: adminToken })).data.data.events;
  assert.ok(events.some(e => e.action === 'plot.status' && e.note.startsWith('Plot 5: Available → Booked') && e.actor === 'admin:admin'));

  // Approvals appear only after staff reviewed them
  const ap = (await req('POST', `/api/admin/properties/${proj.id}/approvals`, { token: adminToken, body: { kind: 'na', reference: 'NA/2025/123', authority: 'Collector, Pune' } })).data.data;
  assert.deepEqual((await req('GET', `/api/properties/${proj.id}`)).data.data.approvals, []);
  await req('POST', `/api/admin/approvals/${ap.id}/review`, { token: adminToken, body: { reviewed: true } });
  const shown = (await req('GET', `/api/properties/${proj.id}`)).data.data;
  assert.equal(shown.approvals[0].reference, 'NA/2025/123');
  assert.equal(shown.plot_counts.total, 12);
  // Editing an approval needs a new review
  await req('PUT', `/api/admin/approvals/${ap.id}`, { token: adminToken, body: { kind: 'na', reference: 'NA/2025/124' } });
  assert.deepEqual((await req('GET', `/api/properties/${proj.id}`)).data.data.approvals, []);

  // Report a listing → admin resolves it
  const { limiters } = require('../src/middleware/rateLimit');
  ['::ffff:127.0.0.1', '127.0.0.1', '::1'].forEach(ip => limiters.leads.reset(ip));
  assert.equal((await req('POST', `/api/properties/${proj.id}/report`, { body: { reason: 'Nope' } })).status, 400);
  assert.equal((await req('POST', `/api/properties/${proj.id}/report`, { body: { reason: 'Wrong price', details: 'Rate is higher on the phone' } })).status, 200);
  const rep = (await req('GET', '/api/admin/reports?status=open', { token: adminToken })).data.data.find(x => x.property_id === proj.id);
  assert.equal(rep.reason, 'Wrong price');
  assert.ok((await req('GET', '/api/admin/stats', { token: adminToken })).data.data.open_reports >= 1);
  assert.equal((await req('POST', `/api/admin/reports/${rep.id}`, { token: adminToken, body: { status: 'resolved', note: 'Price corrected' } })).data.data.status, 'resolved');
  // Site-visit bookings need a mobile number; search alerts only an email
  const visit = body => req('POST', '/api/leads', { body: { source: 'site-visit', name: 'Vik Visitor', email: 'vik@test.in', property_id: proj.id, message: 'Site visit request: 2026-12-01', ...body } });
  assert.equal((await visit({})).status, 400);
  assert.equal((await visit({ phone: '9823456781' })).status, 200);
  assert.equal((await req('POST', '/api/leads', { body: { source: 'search-alert', email: 'alerts@test.in', message: 'Pune | 2 BHK' } })).status, 200);

  await req('DELETE', `/api/admin/properties/${proj.id}`, { token: adminToken });
  assert.equal((await req('GET', `/api/properties/${proj.id}/plots`)).status, 404);
});

test('admin can change the email (SMTP) settings; the password is encrypted and never returned', async () => {
  const put = body => req('PUT', '/api/admin/mail-settings', { token: adminToken, body });
  assert.equal((await req('GET', '/api/admin/mail-settings')).status, 401);
  assert.equal((await req('GET', '/api/admin/mail-settings', { token: adminToken })).data.data.source, 'env');
  assert.ok((await put({ host: 'bad host!', port: 465 })).data.fields.host);
  assert.ok((await put({ host: 'smtp.example.test', port: 0 })).data.fields.port);

  // An unreachable server, so nothing is really sent
  const saved = await put({ host: '127.0.0.1', port: 1, secure: true, user: 'me@example.test', pass: 'abcd efgh ijkl mnop', from: 'Landroof <me@example.test>', admin_email: 'boss@example.test' });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.data.has_password, true);
  assert.ok(!JSON.stringify(saved.data).includes('abcd'));
  const db = require('../src/config/database');
  const stored = db.prepare("SELECT value FROM site_config WHERE key='mail_settings'").get().value;
  assert.ok(!stored.includes('abcdefghijklmnop')); // encrypted at rest
  const MailSettings = require('../src/models/MailSettings');
  assert.equal(MailSettings.current().pass, 'abcdefghijklmnop'); // spaces from Gmail's display removed
  assert.equal(require('../src/services/notify').adminEmail(), 'boss@example.test');

  // An empty password keeps the saved one
  await put({ host: '127.0.0.1', port: 1, secure: true, user: 'me@example.test', pass: '', from: '', admin_email: '' });
  assert.equal(MailSettings.current().pass, 'abcdefghijklmnop');

  const test = await req('POST', '/api/admin/mail-settings/test', { token: adminToken, body: { to: 'someone@example.test' } });
  assert.equal(test.status, 400);
  assert.equal(test.data.code, 'smtp_failed');

  // Back to .env (no SMTP in tests) so the other tests keep using the outbox
  const reset = await req('DELETE', '/api/admin/mail-settings', { token: adminToken });
  assert.equal(reset.data.data.source, 'env');
  assert.equal(reset.data.data.configured, false);
});

// ── Rate limiting (keep last: it locks out this IP) ───────────────────────
test('admin login locks out after 10 failed attempts', async () => {
  for (let i = 0; i < 10; i++) {
    await req('POST', '/api/admin/auth/login', { body: { username: 'admin', password: 'wrong' } });
  }
  const r = await req('POST', '/api/admin/auth/login', { body: { username: 'admin', password: 'test-password-123' } });
  assert.equal(r.status, 429);
});

test('admin account locks after many failures from different IPs (distributed guessing)', async () => {
  const { limiters } = require('../src/middleware/rateLimit');
  limiters.adminLogin.reset('::ffff:127.0.0.1'); limiters.adminLogin.reset('127.0.0.1');
  for (let i = 0; i < 30; i++) limiters.adminAccount.hit('admin'); // as if 30 failures came from 30 IPs
  const r = await req('POST', '/api/admin/auth/login', { body: { username: 'admin', password: 'test-password-123' } });
  assert.equal(r.status, 429);
  assert.match(r.data.error, /account is temporarily locked/);
});
