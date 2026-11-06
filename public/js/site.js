/* Landroof public website — client-side controller for src/views/index.html */
'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let allProps = [];                // listings currently loaded in the grid
let currentPropId = null;         // property open in the detail modal
let activeSearchType = 'buy';     // active tab in the search box
let authMode = 'signin';
let siteConfig = {};
let user = null;
let wishlist = readJSON('lr_wishlist', []);

const TYPE_LABELS   = {buy:'Buy',rent:'Rent',plots:'Plots & Land',commercial:'Commercial'};
const TYPE_ICONS    = {buy:'home',rent:'key',plots:'plot',commercial:'building'};
const TYPE_BADGES   = {buy:'For Sale',rent:'For Rent',plots:'Plot',commercial:'Commercial'};
const TYPE_SECTION  = {buy:'Properties for Sale',rent:'Rental Properties',plots:'Plots & Land',commercial:'Commercial Properties'};
const TYPE_SUBTITLE = {
  buy:'Verified residential listings across top cities',
  rent:'Furnished & unfurnished homes, apartments and PGs',
  plots:'NA-approved, agricultural and farmhouse plots',
  commercial:'Offices, shops, warehouses and co-working spaces'
};
const TYPE_SEARCH_BTN = {buy:'Find Properties',rent:'Find Rentals',plots:'Find Plots',commercial:'Find Spaces'};
// Replaced by the admin "Cities" list once it loads (see loadCities)
const CITY_OPTIONS = ['All Cities','Pune','Mumbai','Bangalore','Hyderabad','Delhi NCR','Chennai'];

// ── Storage helpers (never throw in private mode) ─────────────────────────
function readJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function store(key, value) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch {}
}
function getSessionId() {
  try {
    let sid = sessionStorage.getItem('lr_sid');
    if (!sid) { sid = 'lr_' + Date.now() + '_' + Math.random().toString(36).slice(2,9); sessionStorage.setItem('lr_sid', sid); }
    return sid;
  } catch { return ''; }
}

// ── Auth tokens (JWT) ─────────────────────────────────────────────────────
// The JWT access token is kept only in memory. The refresh token is an httpOnly cookie
// that scripts can't read; it's exchanged for a new access token when one expires.
// "lr_signed_in" is just a hint (no secret) so anonymous visitors skip the refresh call.
let accessToken = '';

function setSignedIn(res) {
  accessToken = res.accessToken;
  user = res.user;
  store('lr_signed_in', '1');
}
function clearSignedIn() {
  accessToken = '';
  user = null;
  store('lr_signed_in', null);
}

let refreshing = null;
/** Gets a new access token from the refresh cookie. Resolves true/false; parallel calls share one request. */
function refreshAccessToken() {
  refreshing ||= fetch('/api/auth/refresh', {method: 'POST'})
    .then(async r => { if (!r.ok) { clearSignedIn(); return false; } setSignedIn(await r.json()); return true; })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

// ── API ────────────────────────────────────────────────────────────────────
/** Calls the API and returns the JSON body. Throws an Error with the server's message on failure. */
async function api(path, {method='GET', body} = {}) {
  const send = () => {
    const headers = {};
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
    return fetch(path, {method, headers, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body)});
  };
  // Sign-in endpoints don't use the access token, so a 401 there is never retried
  const isSignInCall = /^\/api\/auth\/(login|register|refresh|logout)$/.test(path);
  let r;
  try {
    r = await send();
    // Expired access token → refresh once and retry
    if (r.status === 401 && accessToken && !isSignInCall && await refreshAccessToken()) r = await send();
  } catch {
    throw new Error('Could not reach the server. Please check your connection and try again.');
  }
  let j = {};
  try { j = await r.json(); } catch {}
  if (r.status === 401 && user && !isSignInCall) { clearSignedIn(); renderAccount(); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong. Please try again.'), {status: r.status, fields: j.fields, code: j.code});
  return j;
}

// ── Form validation ───────────────────────────────────────────────────────
// Rules live in /shared/validation.js and are the same ones the server applies.
const V = window.LRValidation;

/** Shows (or clears, with '') an error message under an input */
function setFieldError(input, msg) {
  if (!input) return;
  // Password fields sit inside a .pw-wrap with the show/hide button — put the message after the wrapper
  const anchor = input.parentElement?.classList.contains('pw-wrap') ? input.parentElement : input;
  const holder = input.closest('.form-group, .sf-group') || anchor.parentElement;
  let el = anchor.nextElementSibling?.classList?.contains('field-error') ? anchor.nextElementSibling : null;
  if (!el && holder) el = holder.querySelector(`.field-error[data-for="${input.id}"]`);
  if (!el) {
    el = document.createElement('div');
    el.className = 'field-error';
    el.dataset.for = input.id;
    el.id = input.id + '-error';
    el.setAttribute('role', 'alert');
    anchor.insertAdjacentElement('afterend', el);
  }
  el.textContent = msg || '';
  if (msg) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', el.id); }
  else input.removeAttribute('aria-invalid');
}

function readFields(fieldMap) {
  const data = {};
  for (const [field, id] of Object.entries(fieldMap)) data[field] = document.getElementById(id)?.value ?? '';
  return data;
}

/**
 * Validates a form against LRValidation.FORMS[formName].
 * fieldMap maps rule field → input id. Returns cleaned values, or null after showing the errors
 * and focusing the first invalid input.
 */
function checkForm(formName, fieldMap, extra = {}) {
  const form = V.FORMS[formName];
  const data = {...extra, ...readFields(fieldMap)};
  const {valid, values, errors} = V.validateForm(form, data);
  let first = null;
  for (const [field, id] of Object.entries(fieldMap)) {
    if (!form[field]) continue;
    const input = document.getElementById(id);
    setFieldError(input, errors[field] || '');
    if (errors[field] && !first) first = input;
  }
  first?.focus();
  return valid ? values : null;
}

/** Shows the per-field messages the server returned (err.fields) */
function showServerErrors(fieldMap, err) {
  if (!err?.fields) return false;
  let shown = false, first = null;
  for (const [field, msg] of Object.entries(err.fields)) {
    const input = document.getElementById(fieldMap[field]);
    if (input) { setFieldError(input, msg); shown = true; first ||= input; }
  }
  first?.focus();
  return shown;
}

/** Validates single fields as the visitor leaves them, and re-checks while they fix an error */
function liveValidate(formName, fieldMap, extraFn = () => ({})) {
  const form = V.FORMS[formName];
  for (const [field, id] of Object.entries(fieldMap)) {
    const input = document.getElementById(id);
    if (!input || !form[field] || input.dataset.live === formName) continue;
    input.dataset.live = formName;
    const check = () => {
      if (!document.getElementById(id) || input.closest('[hidden]')) return;
      const r = V.validateField(form, field, {...extraFn(), ...readFields(fieldMap)});
      setFieldError(input, r.error || '');
    };
    input.addEventListener('blur', () => { if (input.value.trim() || input.getAttribute('aria-invalid')) check(); });
    input.addEventListener('input', () => { if (input.getAttribute('aria-invalid')) check(); });
    if (input.tagName === 'SELECT') input.addEventListener('change', check);
  }
}

function clearFieldErrors(container) {
  container.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; });
  container.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
}

const FIELDS = {
  register:  {name:'auth-name', email:'auth-email', password:'auth-password', phone:'auth-phone', interest:'auth-interest'},
  login:     {email:'auth-email', password:'auth-password'},
  changePassword: {currentPassword:'pw-current', newPassword:'pw-new'},
  enquiry:   {name:'enq-name', email:'enq-email', phone:'enq-phone', message:'enq-message'},
  list:      {name:'list-name', email:'list-email', phone:'list-phone', search_city:'list-city', message:'list-message'},
  invest:    {name:'inv-name', email:'inv-email', phone:'inv-phone'},
  contact:   {name:'contact-name', email:'contact-email', phone:'contact-phone', message:'contact-message'},
  search:    {phone:'sf-phone'},
  forgot:    {email:'auth-email'},
};

function setupValidation() {
  liveValidate('list-property', FIELDS.list);
  liveValidate('investment-enquiry', FIELDS.invest);
  liveValidate('contact', FIELDS.contact);
  liveValidate('changePassword', FIELDS.changePassword, () => ({email: user?.email || ''}));
  const pwNew = document.getElementById('pw-new'), pwConfirm = document.getElementById('pw-confirm');
  const checkConfirm = () => setFieldError(pwConfirm, pwConfirm.value && pwConfirm.value !== pwNew.value ? 'The passwords do not match' : '');
  pwConfirm.addEventListener('input', checkConfirm);
  pwNew.addEventListener('input', () => { if (pwConfirm.value) checkConfirm(); });
  document.getElementById('auth-password').addEventListener('input', updateStrength);
}

/** Password strength meter on the Register form */
function updateStrength() {
  const meter = document.getElementById('pw-strength');
  if (authMode !== 'register') { meter.hidden = true; return; }
  const pw = document.getElementById('auth-password').value;
  const score = V.passwordStrength(pw);
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  meter.hidden = !pw;
  meter.dataset.score = score;
  meter.querySelector('.pw-strength-label').textContent = pw ? labels[score] : '';
}

// ── Lead capture ──────────────────────────────────────────────────────────
function hasConsent() { return readJSON('lr_consent', null) === true; }

/**
 * Sends a lead. Returns true on success. On failure shows the server's messages under the
 * matching inputs (when fieldMap is given) or as a toast, and returns false.
 */
async function postLead(data, fieldMap) {
  const payload = {...data, session_id: getSessionId()};
  if (!payload.email && user) payload.email = user.email;
  if (hasConsent()) {
    payload.referrer = document.referrer || '';
    payload.screen_w = window.screen.width;
    payload.screen_h = window.screen.height;
    payload.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    payload.language = navigator.language || '';
  }
  try {
    return await api('/api/leads', {method:'POST', body: payload});
  } catch (e) {
    if (!(fieldMap && showServerErrors(fieldMap, e))) toast(e.message, 'err');
    return false;
  }
}

/** Disables a form's submit button while an async action runs */
async function withBusy(btn, fn) {
  if (!btn) return fn();
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Sending…';
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}

// ── Site config (numbers, WhatsApp, contact email) ────────────────────────
async function loadSiteConfig() {
  try {
    const {data} = await api('/api/site-config');
    siteConfig = data || {};
  } catch { siteConfig = {}; }

  document.querySelectorAll('.counter[data-cfg]').forEach(el => {
    const n = parseInt(String(siteConfig[el.dataset.cfg] || '').replace(/\D/g, ''), 10);
    if (Number.isFinite(n)) el.dataset.target = n;
  });
  document.querySelectorAll('[data-cfg-text]').forEach(el => {
    const digits = String(siteConfig[el.dataset.cfgText] || '').replace(/\D/g, '');
    if (digits) el.textContent = Number(digits).toLocaleString('en-IN');
  });

  const email = siteConfig.contact_email;
  if (email) {
    const a = document.getElementById('footer-email');
    a.href = 'mailto:' + email; a.querySelector('span').textContent = email;
    document.querySelectorAll('.cfg-email-link').forEach(l => { l.href = 'mailto:' + email; l.textContent = email; });
  }
  const phone = siteConfig.contact_phone;
  if (phone) {
    const a = document.getElementById('footer-phone');
    a.href = 'tel:' + phone.replace(/[^\d+]/g, ''); a.querySelector('span').textContent = phone; a.hidden = false;
    const call = document.getElementById('contact-call');
    call.href = a.href; call.querySelector('span span').textContent = phone;
  } else {
    document.getElementById('contact-call').hidden = true;
  }
  const wa = whatsAppUrl();
  document.getElementById('footer-wa').hidden = !wa;
  document.getElementById('fab-wa').hidden = !wa;
  if (wa) document.getElementById('footer-wa').href = wa;
}

function whatsAppUrl(text = 'Hi Landroof, I am looking for a property') {
  const num = String(siteConfig.whatsapp_number || '').replace(/\D/g, '');
  return num ? `https://wa.me/${num}?text=${encodeURIComponent(text)}` : '';
}
function openWhatsApp() {
  const url = whatsAppUrl();
  if (url) window.open(url, '_blank', 'noopener');
}

// ── Announcements ──────────────────────────────────────────────────────────
async function loadAnnouncements() {
  try {
    const {data} = await api('/api/announcements');
    const banner = document.getElementById('announcements-banner');
    if (!data || !data.length) return;
    const ann = data[0]; // latest active announcement
    let dismissed = [];
    try { dismissed = JSON.parse(sessionStorage.getItem('lr_ann_closed') || '[]'); } catch {}
    if (dismissed.includes(ann.id)) return;
    const type = ['info','promo','warning'].includes(ann.type) ? ann.type : 'info';
    banner.innerHTML = `<div class="ann-bar ${type}">
      <span><strong>${esc(ann.title)}</strong>${ann.body ? ' — ' + esc(ann.body) : ''}</span>
      <button class="ann-close" aria-label="Close">✕</button>
    </div>`;
    banner.querySelector('.ann-close').onclick = () => {
      banner.style.display = 'none';
      try { sessionStorage.setItem('lr_ann_closed', JSON.stringify([...dismissed, ann.id])); } catch {}
    };
    banner.style.display = 'block';
  } catch {}
}

// ── Testimonials ───────────────────────────────────────────────────────────
async function loadTestimonials() {
  const grid = document.getElementById('testi-grid');
  try {
    const {data} = await api('/api/testimonials');
    if (!data || !data.length) {
      grid.innerHTML = '<p style="color:var(--dim);text-align:center;grid-column:1/-1">Client testimonials coming soon.</p>';
      return;
    }
    const stars = n => { const r = Math.min(Math.max(n || 5, 1), 5); return '★'.repeat(r) + '☆'.repeat(5 - r); };
    grid.innerHTML = data.map(t => `
      <div class="testi-card">
        <div class="testi-stars">${stars(t.rating)}</div>
        <div class="testi-text">"${esc(t.text)}"</div>
        <div class="testi-author">
          <div class="testi-avatar">${esc((t.name||'?')[0].toUpperCase())}</div>
          <div>
            <div class="testi-name">${esc(t.name)}</div>
            <div class="testi-role">${esc(t.role||'')}${t.city ? ' · ' + esc(t.city) : ''}</div>
          </div>
        </div>
      </div>`).join('');
  } catch {
    document.getElementById('testimonials').hidden = true;
  }
}

// ── Offers, events, team, gallery, social ─────────────────────────────────
function imgOrIcon(url, alt, icon) {
  return url ? `<img src="${esc(url)}" alt="${esc(alt)}" loading="lazy">` : icon;
}
function fmtDay(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return isNaN(dt) ? esc(d) : dt.toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'});
}

async function loadOffers() {
  try {
    const {data} = await api('/api/schemes');
    const today = new Date().toISOString().slice(0, 10);
    const live = (data || []).filter(s => !s.valid_until || s.valid_until >= today);
    if (!live.length) return;
    document.getElementById('offers-grid').innerHTML = live.map(s => `
      <div class="c-card">
        <div class="c-card-img">${imgOrIcon(s.image_url, s.title, ico('gift'))}</div>
        <div class="c-card-body">
          <div class="c-card-title">${esc(s.title)}</div>
          ${s.valid_until ? `<div class="c-card-meta">Valid until ${fmtDay(s.valid_until)}</div>` : ''}
          ${s.description ? `<div class="c-card-desc">${esc(s.description)}</div>` : ''}
        </div>
      </div>`).join('');
    document.getElementById('offers').hidden = false;
  } catch {}
}

async function loadEvents() {
  try {
    const {data} = await api('/api/events');
    if (!data || !data.length) return;
    document.getElementById('events-grid').innerHTML = data.map(e => `
      <div class="c-card">
        <div class="c-card-img">${imgOrIcon(e.image_url, e.title, ico('calendar'))}</div>
        <div class="c-card-body">
          <div class="c-card-title">${esc(e.title)}</div>
          <div class="c-card-meta">${[fmtDay(e.event_date), esc(e.location || '')].filter(Boolean).join(' · ')}</div>
          ${e.description ? `<div class="c-card-desc">${esc(e.description)}</div>` : ''}
        </div>
      </div>`).join('');
    document.getElementById('events').hidden = false;
  } catch {}
}

async function loadTeam() {
  try {
    const {data} = await api('/api/team');
    document.getElementById('team-grid').innerHTML = (data || []).map(m => `
      <div class="team-card">
        <div class="team-photo">${imgOrIcon(m.image_url, m.name, esc((m.name||'?')[0].toUpperCase()))}</div>
        <div class="team-name">${esc(m.name)}</div>
        <div class="team-role">${esc(m.role)}</div>
        ${m.bio ? `<div class="team-bio">${esc(m.bio)}</div>` : ''}
      </div>`).join('');
  } catch {}
}

async function loadGallery() {
  try {
    const {data} = await api('/api/media');
    if (!data || !data.length) return;
    document.getElementById('gallery-grid').innerHTML = data.map(m => `
      <a class="g-item" href="${esc(m.image_url)}" target="_blank" rel="noopener">
        <img src="${esc(m.image_url)}" alt="${esc(m.caption || 'Landroof gallery image')}" loading="lazy">
        ${m.category && m.category !== 'general' ? `<span class="g-badge">${esc(m.category)}</span>` : ''}
        ${m.caption ? `<span class="g-cap">${esc(m.caption)}</span>` : ''}
      </a>`).join('');
    document.getElementById('gallery').hidden = false;
  } catch {}
}

async function loadSocial() {
  try {
    const {data} = await api('/api/social-posts');
    if (!data || !data.length) return;
    const icons = {instagram:'📸',facebook:'📘',linkedin:'💼',youtube:'▶️',twitter:'🐦'};
    document.getElementById('social-grid').innerHTML = data.map(s => {
      const inner = `${s.image_url ? `<img src="${esc(s.image_url)}" alt="${esc(s.caption || s.platform)}" loading="lazy">` : `<div class="c-card-img" style="height:100%">${icons[s.platform]||'🔗'}</div>`}
        <span class="g-badge">${icons[s.platform]||''} ${esc(s.platform)}</span>
        ${s.caption ? `<span class="g-cap">${esc(s.caption)}</span>` : ''}`;
      return s.url
        ? `<a class="g-item" href="${esc(s.url)}" target="_blank" rel="noopener">${inner}</a>`
        : `<div class="g-item">${inner}</div>`;
    }).join('');
    document.getElementById('social').hidden = false;
  } catch {}
}

const cityCardHTML = c => `
  <a class="city-card" href="?city=${encodeURIComponent(c.name)}" data-city="${esc(c.name)}" data-on-click="openCity(this);return false">
    ${c.image_url
      ? `<img src="${esc(c.image_url)}" alt="${esc(c.name)}" loading="lazy" width="800" height="600">`
      : `<span class="city-ph" aria-hidden="true">${esc(c.name.charAt(0).toUpperCase())}</span>`}
    <span class="city-info">
      ${c.state ? `<span class="city-state">${esc(c.state)}</span>` : ''}
      <span class="city-name">${esc(c.name)}</span>
      <span class="city-count" data-city="${esc(c.name)}"></span>
    </span>
    <span class="city-go">${ico('arrow')}</span>
  </a>`;

function openCity(el) { filterByCity(el.dataset.city); }

/** Uses the admin's Cities list for the search, "List your property" and owner-form city lists */
function setCityOptions(names) {
  if (!names.length) return;
  CITY_OPTIONS.splice(1, Infinity, ...names);
  const fill = (id, withAll) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = (withAll ? `<option value="">${esc(CITY_OPTIONS[0])}</option>` : '') + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    if (current && !names.includes(current)) sel.add(new Option(current, current)); // keep a choice made from a link
    sel.value = current;
    if (!withAll && !current) sel.selectedIndex = 0;
  };
  fill('sf-city', true);
  fill('list-city', false);
}

// "Explore by city" tiles come from the admin panel; the built-in tiles stay if that fails
async function loadCities() {
  const grid = document.getElementById('city-grid');
  try {
    const {data} = await api('/api/cities');
    if (!data.length) { grid.closest('section').hidden = true; return; }
    grid.innerHTML = data.map(cityCardHTML).join('');
    setCityOptions(data.map(c => c.name));
  } catch {}
  try {
    const {data} = await api('/api/city-counts');
    const counts = {};
    Object.entries(data).forEach(([k, v]) => { counts[k.toLowerCase()] = v; });
    grid.querySelectorAll('.city-count[data-city]').forEach(el => {
      const n = counts[el.dataset.city.toLowerCase()] || 0;
      el.textContent = n ? `${n} listing${n === 1 ? '' : 's'}` : 'Coming soon';
    });
  } catch {
    grid.querySelectorAll('.city-count[data-city]').forEach(el => { el.textContent = ''; });
  }
}

// ── On Load ────────────────────────────────────────────────────────────────
let siteConfigReady = Promise.resolve(); // phone / WhatsApp numbers used by the detail page
window.addEventListener('DOMContentLoaded', async () => {
  renderSearchForm('buy');
  setupValidation();
  setupFilterPills();
  setupScroll();
  updateSavedCount();
  renderCompareBar();
  initConsent();
  restoreSession().then(handleEmailLinks);
  siteConfigReady = loadSiteConfig();
  siteConfigReady.then(animateCounters);

  const shown = applyUrlParams();
  if (!shown) loadFeaturedProps();

  loadAnnouncements();
  loadOffers();
  loadTestimonials();
  loadEvents();
  loadTeam();
  loadGallery();
  loadSocial();
  loadCities();
});

// Links like /?type=rent&city=Pune&bhk=2%20BHK&sort=price_asc (sitemap, Google, shared searches),
// /?search=baner, /property/12 (a listing) and /project/9 (a project page). Older /?property=12 links still work.
function applyUrlParams() {
  const params = new URLSearchParams(location.search);
  const path = /^\/(property|project)\/(\d+)\/?$/.exec(location.pathname);
  const pageKind = path?.[1] || (params.get('project') ? 'project' : params.get('property') ? 'property' : '');
  const pageId = Number(path?.[2] || params.get('project') || params.get('property'));
  params.delete('property');
  params.delete('project');
  // A listing opened from a link sits on top of the home page, so Back shows the home page instead of leaving the site
  history.replaceState({depth: 0}, '', '/' + (params.toString() ? '?' + params : '') + location.hash);

  if (params.get('view') === 'map') setView('map', false);
  const f = filtersFromParams(params);
  const shown = Object.keys(f).some(k => k !== 'sort');
  if (f.sort) document.getElementById('sort-select').value = f.sort;
  if (shown) {
    if (f.type && TYPE_LABELS[f.type]) {
      activeSearchType = f.type;
      document.querySelectorAll('.search-tab').forEach(b => b.classList.toggle('on', b.dataset.type === f.type));
      renderSearchForm(f.type);
    }
    if (f.city) setCityOption(f.city);
    quietUrl = true;
    runListingQuery(f, headingFor(f), false);
    quietUrl = false;
  }
  if (pageId) { if (pageKind === 'project') openProject(pageId); else openDetail(pageId); }
  return shown;
}

// ── Property loading ───────────────────────────────────────────────────────
function showGridError(retry) {
  const grid = document.getElementById('prop-grid');
  grid.innerHTML = `<div class="load-error">${ico('alert')}We couldn't load properties right now.<br><button class="btn btn-or">Try again</button></div>`;
  grid.querySelector('button').onclick = retry;
}

async function loadFeaturedProps() {
  quietUrl = true;
  const done = runListingQuery({featured: '1', sort: new URLSearchParams(location.search).get('sort') || ''}, 'Featured Properties', false);
  quietUrl = false;
  await done;
}

// ── Listing search: filters live in the address bar, results load a page at a time ──
const PAGE_SIZE = 12;
// Filters that can appear in the address bar ("q" is written as "search" for older links)
const FILTER_KEYS = ['type', 'transaction', 'city', 'locality', 'q', 'budget', 'rate', 'area', 'bhk', 'subtype',
  'furnishing', 'possession', 'age', 'amenities', 'verified', 'bounds', 'sort'];
let listState = {filters: {}, heading: '', total: 0};
let listView = 'grid';

function filtersFromParams(params) {
  const f = {};
  FILTER_KEYS.forEach(k => { const v = params.get(k === 'q' ? 'search' : k); if (v) f[k] = v.slice(0, 200); });
  return f;
}

/** Writes the filters to the address bar (a new Back step per search), so a search can be shared or bookmarked */
function syncUrl(f) {
  if (quietUrl || layers.length) return;
  const u = new URL(location.href);
  [...FILTER_KEYS, 'search', 'view'].forEach(k => u.searchParams.delete(k));
  FILTER_KEYS.forEach(k => { if (f[k] && k !== 'q') u.searchParams.set(k, f[k]); });
  if (f.q) u.searchParams.set('search', f.q);
  if (listView === 'map') u.searchParams.set('view', 'map');
  const next = u.pathname + u.search + u.hash;
  if (next === location.pathname + location.search + location.hash) return;
  if (dropEntries > 0) { dropEntries--; history.replaceState({depth: 0}, '', next); } // reuse the step of the filters panel that just closed
  else history.pushState({depth: 0}, '', next);
}

/** Back / Forward landed on another search: show its results */
function restoreListing() {
  if (location.pathname !== '/') return;
  const params = new URLSearchParams(location.search);
  if ((params.get('view') === 'map') !== (listView === 'map')) setView(params.get('view') === 'map' ? 'map' : 'grid', false);
  const f = filtersFromParams(params);
  const same = (a, b) => {
    const keys = o => Object.keys(o).filter(k => o[k] && k !== 'featured').sort();
    return JSON.stringify(keys(a).map(k => [k, a[k]])) === JSON.stringify(keys(b).map(k => [k, b[k]]));
  };
  if (same(f, listState.filters)) return;
  if (Object.keys(f).some(k => k !== 'sort')) {
    quietUrl = true;
    runListingQuery(f, headingFor(f), false);
    quietUrl = false;
  } else loadFeaturedProps();
}

// ── Browser Back / Forward ────────────────────────────────────────────────
// Everything that opens on top of the page (popups, the mobile menu, confirm boxes, listing pages) is a
// "layer" with its own history step, so Back closes the top layer instead of leaving the site.
const layers = [];              // open layers, top last
let dropEntries = 0, dropTimer = null, closingFromHistory = false, quietUrl = false;

function pushLayer(layer, url = location.pathname + location.search + location.hash) {
  layers.push(layer);
  const state = {depth: layers.length, ...(layer.kind === 'page' ? {page: {page: layer.page, id: layer.id}} : {})};
  // A layer closed in this same step (one popup replaced by another) gives its history step to the new one
  if (dropEntries > 0) { dropEntries--; history.replaceState(state, '', url); }
  else history.pushState(state, '', url);
}

function dropLayer(layer) {
  const i = layers.indexOf(layer);
  if (i < 0) return;
  layers.splice(i, 1);
  if (closingFromHistory) return; // Back already removed its step
  dropEntries++;
  clearTimeout(dropTimer);
  dropTimer = setTimeout(() => { const n = dropEntries; dropEntries = 0; if (n) history.go(-n); });
}

function closeLayer(layer) {
  if (layer.kind === 'modal') closeModal(layer.id);
  else if (layer.kind === 'menu') setMenu(false);
  else if (layer.kind === 'dialog') dialogClose?.(false);
  dropLayer(layer); // pages, and anything the calls above left
}

window.addEventListener('popstate', e => {
  const state = e.state || {};
  const depth = state.depth || 0;
  closingFromHistory = true;
  while (layers.length > depth) closeLayer(layers[layers.length - 1]);
  closingFromHistory = false;
  if (state.page && layers.length === depth - 1) layers.push({kind: 'page', ...state.page}); // Forward to a listing page
  syncPageView();
  if (!layers.length) restoreListing();
});

function headingFor(f) {
  const kind = TYPE_SECTION[f.type] || (f.type === 'buy,rent' ? 'Residential Properties' : 'Properties');
  return `${kind}${f.locality ? ' in ' + f.locality : ''}${f.city ? (f.locality ? ', ' : ' in ') + f.city : ''}${f.q ? ` matching “${f.q}”` : ''}`;
}

/** Fetches the first page of listings for the given filters and renders them under a heading. */
async function runListingQuery(filters, heading, scroll = true) {
  const f = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v != null));
  listState = {filters: f, heading, total: 0};
  document.querySelector('#properties .section-title').textContent = heading;
  const summary = filterChips(f).filter(c => c.label !== 'Featured').map(c => c.label).join(' · ');
  document.getElementById('prop-subtitle').textContent = f.featured ? 'Handpicked listings across top locations' : summary || 'All listings';
  document.getElementById('prop-grid').innerHTML = SKELETONS;
  document.getElementById('sort-select').value = f.sort || '';
  setPill(f.featured ? 'all' : (f.type || 'all'));
  renderFilterChips();
  syncUrl(f);
  if (scroll) document.getElementById('properties').scrollIntoView({behavior:'smooth'});
  const ok = await fetchPage(true);
  if (listView === 'map') showMapResults();
  return ok ? allProps : null;
}

async function fetchPage(first) {
  const qs = new URLSearchParams({limit: String(PAGE_SIZE), offset: String(first ? 0 : allProps.length)});
  Object.entries(listState.filters).forEach(([k, v]) => qs.set(k, v));
  const filters = listState.filters;
  try {
    const res = await api('/api/properties?' + qs);
    if (filters !== listState.filters) return true; // a newer search started meanwhile
    allProps = first ? (res.data || []) : [...allProps, ...(res.data || [])];
    listState.total = res.total ?? allProps.length;
    renderProps(allProps);
    return true;
  } catch {
    if (first) showGridError(() => runListingQuery(listState.filters, listState.heading, false));
    else toast('Could not load more properties. Please try again.', 'err');
    return false;
  }
}

async function loadMore(btn) {
  btn.disabled = true;
  btn.textContent = 'Loading…';
  await fetchPage(false);
  btn.disabled = false;
  btn.textContent = 'Show more properties';
}

async function loadAllProperties() {
  document.getElementById('prop-subtitle').textContent = 'All listings';
  await runListingQuery({sort: listState.filters.sort}, 'All Properties');
}

function setPill(type) {
  document.querySelectorAll('#type-filters .pill').forEach(p => p.classList.toggle('on', p.dataset.type === type));
}

function renderProps(props) {
  const grid = document.getElementById('prop-grid');
  const total = listState.total || props.length;
  document.getElementById('result-count').textContent = props.length
    ? `Showing ${props.length} of ${total} ${total === 1 ? 'property' : 'properties'}` : '';
  const more = document.getElementById('load-more');
  more.hidden = props.length >= total;
  if (!props.length) {
    grid.innerHTML = noResultsHTML();
    loadSuggestions();
    return;
  }
  grid.innerHTML = props.map(propCardHTML).join('');
}

// Nothing found: nearby localities and cities that have listings, and an email alert
function noResultsHTML() {
  const filtered = Object.keys(listState.filters).some(k => k !== 'sort' && k !== 'featured');
  return `<div class="no-results nr-rich" style="grid-column:1/-1">
    <div class="no-results-icon">${ico('search')}</div>
    <p><strong>No properties match ${filtered ? 'these filters' : ''} yet.</strong><br>${filtered ? 'Try removing a filter, or look nearby:' : 'New listings are added every week.'}</p>
    <div class="nr-suggest" id="nr-suggest"></div>
    ${filtered ? `<button type="button" class="btn btn-ghost btn-sm" data-on-click="clearAllFilters()">Clear all filters</button>` : ''}
    <form class="nr-alert" id="nr-alert" novalidate data-on-submit="saveSearchAlert(event)">
      <label class="form-label" for="alert-email">${ico('mail')} Email me when a matching property is listed</label>
      <div class="nr-alert-row">
        <input class="form-control" id="alert-email" type="email" maxlength="254" placeholder="name@example.com" autocomplete="email" value="${esc(user?.email || '')}">
        <button type="submit" class="btn btn-or">Notify me</button>
      </div>
      <p class="form-note">We'll only use your email for this alert. <a href="#" data-on-click="openInfo('privacy');return false">Privacy Policy</a></p>
    </form>
    <p class="nr-help">Or <a href="#" data-on-click="openContact('General Enquiry');return false">ask our team</a> to find one for you.</p>
  </div>`;
}

async function loadSuggestions() {
  const box = document.getElementById('nr-suggest');
  if (!box) return;
  const f = listState.filters;
  const type = TYPE_LABELS[f.type] ? f.type : '';
  try {
    const {data} = await api(`/api/property-suggestions?city=${encodeURIComponent(f.city || '')}&type=${type}`);
    const locs = data.localities.filter(l => l.name.toLowerCase() !== String(f.locality || '').toLowerCase()).slice(0, 6);
    const cities = data.cities.filter(c => c.name !== f.city).slice(0, 5);
    box.innerHTML = locs.map(l => `<button type="button" class="chip-btn" data-value="${esc(l.name)}" data-on-click="tryNearby('locality',this)">${ico('pin')} ${esc(l.name)} <span>${Number(l.n)}</span></button>`).join('')
      + cities.map(c => `<button type="button" class="chip-btn" data-value="${esc(c.name)}" data-on-click="tryNearby('city',this)">${ico('building')} ${esc(c.name)} <span>${Number(c.n)}</span></button>`).join('');
  } catch { /* suggestions are optional */ }
}

function tryNearby(kind, btn) {
  const value = btn.dataset.value;
  const f = listState.filters;
  const next = kind === 'locality' ? {type: f.type, transaction: f.transaction, city: f.city, locality: value} : {type: f.type, transaction: f.transaction, city: value};
  runListingQuery(next, headingFor(next), false);
}

async function saveSearchAlert(e) {
  e.preventDefault();
  const values = checkForm('search-alert', {email: 'alert-email'});
  if (!values) return;
  const f = listState.filters;
  const ok = await withBusy(e.target.querySelector('[type="submit"]'), () => postLead({
    email: values.email, source: 'search-alert', search_city: f.city || '', search_type: f.type || '',
    search_budget: f.budget || '', search_bhk: f.bhk || '',
    message: filterChips(f).map(c => c.label).join(' | ') + ` | Link: ${location.href}`,
  }, {email: 'alert-email'}));
  if (!ok) return;
  e.target.innerHTML = `<p class="nr-done">${ico('check')} Done — we'll email ${esc(values.email)} when a matching property is listed.</p>`;
}

const CATEGORY = {buy:'Residential', rent:'Residential', plots:'Land', commercial:'Commercial'};

function propCardHTML(p) {
  const id = Number(p.id);
  const liked = wishlist.includes(id);
  const category = [p.subtype, CATEGORY[p.type]].filter((v, i, arr) => v && arr.indexOf(v) === i).join(' · ');
  const rooms = p.beds ? `${Number(p.beds)} BHK${p.baths ? ` · ${Number(p.baths)} Bath` : ''}` : (p.baths ? `${Number(p.baths)} Bath` : '');
  const meta = [
    rooms && `<span class="prop-meta-item">${ico(p.beds ? 'bed' : 'bath')} ${rooms}</span>`,
    p.area && `<span class="prop-meta-item">${ico('area')} ${esc(p.area)}</span>`,
    p.rera && `<span class="prop-meta-item prop-rera" title="RERA ${esc(p.rera)}">${ico('shield')} RERA</span>`,
  ].filter(Boolean).join('');
  return `<article class="prop-card" data-on-click="openDetail(${id})">
    <div class="prop-img">
      ${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.title)}" loading="lazy">` : `<div class="prop-img-ph">${ico(TYPE_ICONS[p.type] || 'home')}</div>`}
      <div class="prop-badges">
        <span class="prop-badge prop-badge-type">${esc(TYPE_BADGES[p.type] || p.type)}</span>
        ${p.status ? `<span class="prop-badge">${esc(p.status)}</span>` : ''}
      </div>
      <button type="button" class="prop-heart ${liked ? 'liked' : ''}" data-heart="${id}" data-on-click="toggleWishlist(event,${id})" aria-label="Save property" aria-pressed="${liked}" title="Save">${ico('heart')}</button>
    </div>
    <div class="prop-body">
      ${category ? `<div class="prop-cat">${esc(category)}</div>` : ''}
      <h3 class="prop-name">${esc(p.title)}</h3>
      <div class="prop-loc">${ico('pin')}<span>${esc([p.locality, p.city].filter(Boolean).join(', '))}</span></div>
      ${meta ? `<div class="prop-meta">${meta}</div>` : ''}
      <div class="prop-price-row">
        <span class="prop-price">${esc(p.price_label)}</span>
        ${p.emi_label ? `<span class="prop-emi">${esc(p.emi_label)}</span>` : ''}
      </div>
    </div>
    <div class="prop-foot">
      <button type="button" class="prop-cta prop-cta-primary" data-on-click="event.stopPropagation();openDetail(${id})">View Details</button>
      <button type="button" class="prop-cta prop-cta-sec" data-on-click="event.stopPropagation();quickEnquire(${id})">Enquire</button>
      <button type="button" class="prop-wa" data-on-click="event.stopPropagation();whatsAppProperty(${id})" aria-label="WhatsApp about this property" title="WhatsApp">${ico('whatsapp', 'ico-fill')}</button>
    </div>
  </article>`;
}

function whatsAppProperty(id) {
  const p = allProps.find(x => x.id === id);
  const link = `${location.origin}${pageUrl(p?.is_project ? 'project' : 'property', id)}`;
  const url = whatsAppUrl(`Hi Landroof, I'm interested in ${p ? p.title + ' (' + [p.locality, p.city].filter(Boolean).join(', ') + ')' : 'a property'} — listing ${p?.listing_code || '#' + id}\n${link}`);
  if (url) window.open(url, '_blank', 'noopener');
  else quickEnquire(id);
}

// ── Detail modal ───────────────────────────────────────────────────────────
const isLease = p => p.type === 'rent' || /\/\s*mo|\/\s*month/i.test(p.price_label || '');

// ── Detail modal ───────────────────────────────────────────────────────────

// ── Listing pages (/property/12, /project/9) ──────────────────────────────
const LISTING_LABEL = {active: 'Available', sold: 'Sold', rented: 'Rented out', expired: 'Listing expired', withdrawn: 'Withdrawn by owner'};
const MAHA_CITIES = ['Pune', 'Mumbai', 'Nagpur', 'Nashik', 'Thane', 'Navi Mumbai', 'Aurangabad', 'Kolhapur'];
const BASE_TITLE = 'Landroof — Buy, Sell, Rent & Manage Property in India';
let detailMap = null, shownPage = null, pageOpener = null;

const pageUrl = (kind, id) => `/${kind}/${id}`;

function setPageCurrent(kind, id) {
  currentPropId = id;
  currentProjectId = kind === 'project' ? id : null;
}

/** Shows the page view with a new history step; popups below it stay open and come back on Back */
function enterPage(kind, id) {
  const view = document.getElementById('project-view');
  const top = layers[layers.length - 1];
  setPageCurrent(kind, id);
  if (top?.kind === 'page' && top.page === kind && top.id === id) return;
  document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.add('under-page'));
  closeMenu();
  if (view.hidden) pageOpener = document.activeElement;
  shownPage = {kind: 'page', page: kind, id};
  pushLayer(shownPage, pageUrl(kind, id));
  view.hidden = false;
  document.body.classList.add('pv-open');
  view.scrollTop = 0;
}

function removePageMaps() {
  if (detailMap) { detailMap.remove(); detailMap = null; }
  if (projectMap) { projectMap.remove(); projectMap = null; }
}

function hidePage() {
  const view = document.getElementById('project-view');
  document.querySelectorAll('.modal-overlay.under-page').forEach(m => m.classList.remove('under-page'));
  shownPage = null;
  if (view.hidden) return;
  view.hidden = true;
  document.body.classList.remove('pv-open');
  currentProjectId = null;
  removePageMaps();
  document.getElementById('pv-body').innerHTML = '';
  document.title = BASE_TITLE;
  if (pageOpener?.isConnected) pageOpener.focus({preventScroll: true});
}

/** After Back / Forward: show the listing page that is now on top, if any */
function syncPageView() {
  const top = [...layers].reverse().find(l => l.kind === 'page');
  if (!top) return hidePage();
  if (top === shownPage) return;
  shownPage = top;
  const view = document.getElementById('project-view');
  view.hidden = false;
  document.body.classList.add('pv-open');
  view.scrollTop = 0;
  setPageCurrent(top.page, top.id);
  if (top.page === 'project') loadProject(top.id);
  else renderProperty(top.id);
}

/** The page's own Back button does exactly what the browser's does */
function closePage() {
  if (shownPage) history.back();
}

async function openDetail(id, focusEnquiry = false) {
  const known = allProps.find(x => x.id === id);
  if (known?.is_project) {
    await openProject(id);
    if (focusEnquiry) projectEnquire('enquiry');
    return;
  }
  enterPage('property', id);
  await renderProperty(id, focusEnquiry);
}

async function renderProperty(id, focusEnquiry = false) {
  const layer = shownPage;
  const known = allProps.find(x => x.id === id);
  enqMode = 'enquiry';
  removePageMaps();
  document.getElementById('pv-title').textContent = known?.title || 'Property details';
  if (known) showDetail(known);
  else document.getElementById('pv-body').innerHTML = '<div class="pv-loading">Loading property…</div>';
  try {
    const full = (await api(`/api/properties/${id}`)).data;
    await siteConfigReady;
    if (shownPage !== layer) return;
    if (full.is_project) { // a link to /property/9 that is really a project
      layer.page = 'project';
      setPageCurrent('project', id);
      history.replaceState({depth: layers.length, page: {page: 'project', id}}, '', pageUrl('project', id));
      return loadProject(id, full);
    }
    if (known) Object.assign(known, full); else allProps.push(full);
    // keep whatever the visitor already typed
    const fields = ['enq-name', 'enq-phone', 'enq-email', 'enq-message', 'enq-date', 'enq-slot'];
    const typed = Object.fromEntries(fields.map(f => [f, document.getElementById(f)?.value]));
    showDetail(full);
    Object.entries(typed).forEach(([f, v]) => { const el = document.getElementById(f); if (el && v) el.value = v; });
  } catch (e) {
    if (shownPage !== layer) return;
    if (!known || e.status === 404) {
      toast(e.status === 404 ? 'This property is no longer available.' : e.message, 'err');
      closePage();
      return;
    }
  }
  loadSimilar(id);
  if (focusEnquiry) projectEnquire('enquiry');
}

async function loadSimilar(id) {
  const box = document.getElementById('detail-similar');
  if (!box) return;
  try {
    const {data} = await api(`/api/properties/${id}/similar`);
    if (currentPropId !== id || !data.length) return;
    data.forEach(p => { if (!allProps.some(x => x.id === p.id)) allProps.push(p); });
    box.innerHTML = `<h4>${ico('home')} Similar properties</h4><div class="sim-list">${data.map(p => `
      <button type="button" class="sim-item" data-on-click="openDetail(${Number(p.id)})">
        <span class="sim-img">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : ico(TYPE_ICONS[p.type] || 'home')}</span>
        <span class="sim-txt"><b>${esc(p.title)}</b><span>${esc(p.price_label)}</span><small>${esc([p.locality, p.city].filter(Boolean).join(', '))}</small></span>
      </button>`).join('')}</div>`;
  } catch { /* optional */ }
}

// Photos: one large image (shown whole) with thumbnails to switch between them
function galleryHTML(p, imgs) {
  return `<div class="detail-gallery">
    <a class="dg-main" id="dg-main" href="${esc(imgs[0])}" target="_blank" rel="noopener" title="Open full size">
      <img id="dg-img" src="${esc(imgs[0])}" alt="${esc(p.title)} photo 1 of ${imgs.length}">
      <span class="dg-zoom">${ico('expand')} Full size</span>
    </a>
    ${imgs.length > 1 ? `<div class="dg-thumbs">${imgs.map((u, i) => `<button type="button" class="dg-thumb${i ? '' : ' on'}" data-src="${esc(u)}" data-n="${i + 1}" data-on-click="showGalleryImage(this)" aria-label="Show photo ${i + 1} of ${imgs.length}"><img src="${esc(u)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
  </div>`;
}

function showGalleryImage(btn) {
  const img = document.getElementById('dg-img');
  img.src = btn.dataset.src;
  img.alt = img.alt.replace(/\d+ of/, btn.dataset.n + ' of');
  document.getElementById('dg-main').href = btn.dataset.src;
  btn.parentElement.querySelectorAll('.dg-thumb').forEach(b => b.classList.toggle('on', b === btn));
}

// Server times are UTC ("2026-11-03 10:20:00"); plain dates ("2026-11-03") are shown as they are
const fmtDate = d => {
  if (!d) return '';
  const s = String(d);
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s.replace(' ', 'T') + (/Z|[+-]\d\d:\d\d$/.test(s) ? '' : 'Z');
  const t = new Date(iso);
  return isNaN(t) ? s : t.toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'});
};
const youTubeId = url => (/(?:youtu\.be\/|[?&]v=|embed\/|shorts\/)([\w-]{11})/.exec(url || '') || [])[1];
const listingPhotos = p => [...new Set([p.image_url, ...(p.gallery_urls || [])].filter(Boolean))];

function factHTML(label, value) {
  return value ? `<div class="fact"><span>${label}</span><b>${value}</b></div>` : '';
}

/** Video, 360° tour and floor plan */
function mediaHTML(p) {
  const yt = youTubeId(p.video_url);
  return `${yt ? `<div class="detail-video"><iframe src="https://www.youtube-nocookie.com/embed/${esc(yt)}" title="Video tour of ${esc(p.title)}" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>` : ''}
    ${(p.video_url && !yt) || p.tour_url || p.floor_plan_url ? `<div class="detail-links">
      ${p.video_url && !yt ? `<a class="btn btn-ghost btn-sm" href="${esc(p.video_url)}" target="_blank" rel="noopener nofollow">${ico('play')} Watch video tour</a>` : ''}
      ${p.tour_url ? `<a class="btn btn-ghost btn-sm" href="${esc(p.tour_url)}" target="_blank" rel="noopener nofollow">${ico('cube')} Open 360° tour</a>` : ''}
      ${p.floor_plan_url ? `<a class="btn btn-ghost btn-sm" href="${esc(p.floor_plan_url)}" target="_blank" rel="noopener">${ico('layout')} View floor plan</a>` : ''}
    </div>` : ''}`;
}

function verifyHTML(p, whoProvided) {
  if (p.verified_at) {
    return `<div class="verify-box">
      <div class="vb-head">${ico('check')} <b>Verified by Landroof</b> <small>on ${esc(fmtDate(p.verified_at))}</small></div>
      <ul>${String(p.verify_scope || '').split(';').map(s => s.trim()).filter(Boolean).map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      <p>This check covers only the points above. It is not a check of legal title, approvals or construction permissions — please do your own due diligence before you pay.</p>
    </div>`;
  }
  return `<div class="verify-box vb-none">${ico('alert')} Not yet verified by Landroof. Details are as provided by ${whoProvided}.</div>`;
}

function reraHTML(p) {
  if (!p.rera) return '';
  const maha = MAHA_CITIES.includes(p.city);
  return `<div class="detail-rera">${ico('shield')} <span><b>RERA registration: ${esc(p.rera)}</b><br><small>${p.rera_verified ? 'Checked by our team on the state RERA website.' : 'As provided — please verify on the state RERA website.'}
    ${maha ? `<a href="https://maharera.maharashtra.gov.in" target="_blank" rel="noopener">MahaRERA website</a>` : ''}</small></span></div>`;
}

function listerHTML(p) {
  const l = p.lister;
  if (!l) return '';
  const icon = {owner: 'user', developer: 'building', agent: 'headset', landroof: 'home'}[l.kind] || 'user';
  return `<div class="lister">
    <span class="lister-ico">${ico(icon)}</span>
    <span><b>${esc(l.name)}</b><small>${esc(l.note)}</small></span>
    <p>Your enquiry goes to the Landroof team, who connect you with the ${l.kind === 'landroof' ? 'right advisor' : l.kind}. Personal phone numbers and emails are never shown publicly.</p>
  </div>`;
}

function docsHTML(docs) {
  if (!docs?.length) return '';
  const size = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  return `<div class="detail-docs"><h4>${ico('doc')} Downloads</h4>${docs.map(d => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${ico('doc')} ${esc(d.title)} <small>${d.mime === 'application/pdf' ? 'PDF' : 'Image'} · ${size(d.size)}</small></a>`).join('')}</div>`;
}

let enqMode = 'enquiry';
function showDetail(p) {
  const id = Number(p.id);
  document.getElementById('pv-title').textContent = p.title;
  document.title = `${p.title} — Landroof`;
  const live = !p.listing_status || p.listing_status === 'active';
  document.getElementById('pv-head-cta').hidden = !live;
  const showEmi = live && !isLease(p) && p.price_val > 0;
  const loanAmt = Math.round((p.price_val || 0) * 0.8);
  const imgs = listingPhotos(p);
  const liked = wishlist.includes(id), compared = compareIds.includes(id);
  const phone = siteConfig.contact_phone;
  const tel = phone ? `tel:${esc(phone.replace(/[^\d+]/g, ''))}` : '';
  const hasWa = !!whatsAppUrl();
  const who = p.lister?.kind === 'owner' ? 'the owner' : p.lister?.kind === 'developer' ? 'the developer' : p.lister?.kind === 'agent' ? 'the agent' : 'the seller';
  const place = [p.locality, p.city].filter(Boolean).join(', ');
  const possession = p.possession || (/ready|construction|launch/i.test(p.status || '') ? p.status : '');
  const high = (icon, value, label) => value ? `<div class="pd-hi">${ico(icon)}<b>${value}</b><span>${label}</span></div>` : '';
  document.getElementById('pv-body').innerHTML = `
    ${live ? '' : `<div class="detail-banner">${ico('alert')} <span><b>${esc(LISTING_LABEL[p.listing_status] || 'Not available')}</b> — this property is no longer available. See similar properties below.</span></div>`}
    <div class="pd-layout">
      <div class="pd-main">
        ${imgs.length ? galleryHTML(p, imgs) : `<div class="detail-img"><div class="detail-img-ph">${ico(TYPE_ICONS[p.type] || 'home')}</div></div>`}
        ${mediaHTML(p)}

        <header class="pd-title">
          <div class="pd-tags">
            <span class="prop-badge prop-badge-type">${esc(TYPE_BADGES[p.type] || p.type)}</span>
            ${p.subtype ? `<span class="pd-tag">${esc(p.subtype)}</span>` : ''}
            ${p.verified_at ? `<span class="vbadge" title="See what was checked below">${ico('check')} Verified</span>` : ''}
            <span class="sbadge sb-${esc(p.listing_status || 'active')}">${esc(LISTING_LABEL[p.listing_status] || 'Available')}</span>
          </div>
          <h1 class="pd-name">${esc(p.title)}</h1>
          <div class="detail-loc">${ico('pin')} ${esc(place)}</div>
          <div class="pd-price">${esc(p.price_label)}</div>
          ${p.emi_label ? `<div class="detail-emi">${esc(p.emi_label)}</div>` : ''}
          <div class="detail-idline">Listing ID <b>${esc(p.listing_code || '')}</b>${p.updated_at ? ` · Updated ${esc(fmtDate(p.updated_at))}` : ''}${p.published_at ? ` · Listed ${esc(fmtDate(p.published_at))}` : ''}</div>
          <div class="detail-cta">
            <button type="button" class="btn btn-ghost btn-sm prop-heart-btn ${liked ? 'liked' : ''}" data-heart="${id}" aria-pressed="${liked}" data-on-click="toggleWishlist(event,${id})">${ico('heart')} Save</button>
            <button type="button" class="btn btn-ghost btn-sm cmp-btn ${compared ? 'on' : ''}" data-compare="${id}" aria-pressed="${compared}" data-on-click="toggleCompare(${id})">${ico('compare')} <span>${compared ? 'Added to compare' : 'Compare'}</span></button>
            <button type="button" class="btn btn-ghost btn-sm" data-on-click="shareListing(${id})">${ico('share')} Share</button>
          </div>
        </header>

        <div class="pd-highs">
          ${high('bed', p.beds ? `${Number(p.beds)} BHK` : '', 'Bedrooms')}
          ${high('bath', p.baths ? String(Number(p.baths)) : '', 'Bathrooms')}
          ${high('area', esc(p.area), 'Area')}
          ${high('tag', p.rate_sqft ? `₹${p.rate_sqft.toLocaleString('en-IN')}` : '', 'Per sq ft')}
        </div>

        ${p.description ? `<section class="pd-sec"><h2>About this property</h2><div class="detail-desc">${esc(p.description)}</div></section>` : ''}

        <section class="pd-sec">
          <h2>Property details</h2>
          <div class="facts">
            ${factHTML('Property type', esc([CATEGORY[p.type], p.subtype].filter((v, i, a) => v && a.indexOf(v) === i).join(' · ')))}
            ${factHTML('Listed for', esc(TYPE_BADGES[p.type] || p.type))}
            ${factHTML('Furnishing', esc(p.furnishing))}
            ${factHTML('Possession', esc(possession))}
            ${factHTML('Property age', esc(p.age_band))}
            ${factHTML('Locality', esc(p.locality))}
            ${factHTML('City', esc(p.city))}
            ${factHTML('Availability', esc(LISTING_LABEL[p.listing_status] || 'Available'))}
          </div>
        </section>

        ${p.amenities_list?.length ? `<section class="pd-sec"><h2>Amenities</h2><div class="detail-amen"><div>${p.amenities_list.map(a => `<span>${ico('check')} ${esc(a)}</span>`).join('')}</div></div></section>` : ''}

        <section class="pd-sec">
          <h2>Location</h2>
          ${p.lat && p.lng ? `<div class="detail-map" id="detail-map" aria-label="Map of ${esc(p.locality || p.city)}"></div><p class="map-note">Approximate location of the locality, not the exact property.</p>` : `<div class="detail-loc">${ico('pin')} ${esc(place)}</div>`}
          <a class="btn btn-ghost btn-sm pd-maplink" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.lat && p.lng ? `${p.lat},${p.lng}` : place)}" target="_blank" rel="noopener">${ico('arrow')} Open in Google Maps</a>
        </section>

        <section class="pd-sec">
          <h2>Trust &amp; verification</h2>
          ${reraHTML(p)}
          ${verifyHTML(p, who)}
          ${listerHTML(p)}
          ${docsHTML(p.documents)}
        </section>

        ${showEmi ? `<section class="pd-sec"><div class="emi-calc">
          <h4>${ico('calc')} EMI Calculator <span style="font-weight:400;font-size:13px;color:var(--dim)">(80% loan)</span></h4>
          <div class="emi-row">
            <div>
              <label class="emi-label" for="emi-amount">Loan Amount (₹)</label>
              <input class="emi-input" id="emi-amount" type="number" min="0" value="${loanAmt}" data-on-input="calcEMI()">
            </div>
            <div>
              <label class="emi-label" for="emi-rate">Rate (% p.a.)</label>
              <input class="emi-input" id="emi-rate" type="number" min="0" value="8.5" step="0.1" data-on-input="calcEMI()">
            </div>
            <div>
              <label class="emi-label" for="emi-years">Tenure (years)</label>
              <input class="emi-input" id="emi-years" type="number" min="1" max="40" value="20" data-on-input="calcEMI()">
            </div>
          </div>
          <div class="emi-result" id="emi-result">Calculating…</div>
        </div></section>` : ''}

        <div class="detail-similar" id="detail-similar"></div>
        <p class="detail-report"><button type="button" class="link-btn" data-on-click="openReport(${id})">${ico('flag')} Report this listing</button> if something is wrong or out of date.</p>
      </div>

      <aside class="pd-aside" id="pv-enquire">
        <div class="pd-card">
          <div class="pd-card-price">${esc(p.price_label)}</div>
          <div class="pd-contact">
            ${tel ? `<a class="btn btn-ghost" href="${tel}">${ico('phone')} Call</a>` : ''}
            ${hasWa ? `<button type="button" class="btn btn-ghost" data-on-click="whatsAppProperty(${id})">${ico('whatsapp', 'ico-fill')} WhatsApp</button>` : ''}
          </div>
          <div class="enq-form" id="enq-box">
            <div class="enq-tabs" role="tablist" aria-label="Contact options">
              <button type="button" role="tab" id="enq-tab-enquiry" class="on" aria-selected="true" data-on-click="setEnquiryMode('enquiry')">${ico('send')} ${live ? 'Enquire' : 'Ask about similar'}</button>
              ${live ? `<button type="button" role="tab" id="enq-tab-visit" aria-selected="false" data-on-click="setEnquiryMode('visit')">${ico('calendar')} Site visit</button>` : ''}
            </div>
            <div class="form-gap"><input class="enq-input" id="enq-name" type="text" aria-label="Your name" placeholder="Your Name" maxlength="80" autocomplete="name" value="${esc(user?.name || '')}"></div>
            <div class="form-gap"><input class="enq-input" id="enq-phone" aria-label="Mobile number" type="tel" inputmode="tel" placeholder="Mobile, e.g. 98765 43210" maxlength="20" autocomplete="tel" value="${esc(user?.phone || '')}"></div>
            <div class="form-gap"><input class="enq-input" id="enq-email" aria-label="Email address" type="email" placeholder="Email Address *" maxlength="254" autocomplete="email" value="${esc(user?.email || '')}"></div>
            <div class="enq-row enq-visit" hidden>
              <div><label class="emi-label" for="enq-date">Preferred date</label><input class="enq-input" id="enq-date" type="date" min="${new Date(Date.now() + 864e5).toISOString().slice(0, 10)}"></div>
              <div><label class="emi-label" for="enq-slot">Time</label><select class="enq-input" id="enq-slot"><option>Morning (10 am – 12 pm)</option><option>Afternoon (12 – 3 pm)</option><option>Evening (3 – 6 pm)</option></select></div>
            </div>
            <div class="form-gap"><textarea class="enq-input" id="enq-message" aria-label="Your message" rows="3" maxlength="900" placeholder="Any specific questions?"></textarea></div>
            <button type="button" class="btn btn-or btn-lg btn-block" id="enq-submit" data-on-click="submitEnquiry()">${ico('send')} Send Enquiry</button>
            <p class="form-note">We use your details only to respond to this enquiry. <a href="#" data-on-click="openInfo('privacy');return false">Privacy Policy</a></p>
          </div>
        </div>
      </aside>
    </div>

    <div class="pd-bar">
      <div class="pd-bar-price">${esc(p.price_label)}</div>
      ${tel ? `<a class="pd-bar-ico" href="${tel}" aria-label="Call Landroof">${ico('phone')}</a>` : ''}
      ${hasWa ? `<button type="button" class="pd-bar-ico pd-bar-wa" aria-label="WhatsApp about this property" data-on-click="whatsAppProperty(${id})">${ico('whatsapp', 'ico-fill')}</button>` : ''}
      <button type="button" class="btn btn-or" data-on-click="projectEnquire('enquiry')">Enquire</button>
    </div>`;
  setEnquiryMode(enqMode);
  if (showEmi) calcEMI();
  liveValidate('property-enquiry', FIELDS.enquiry);
  if (p.lat && p.lng) showDetailMap(p);
}

async function showDetailMap(p) {
  try { await loadLeaflet(); } catch { document.getElementById('detail-map')?.remove(); return; }
  const el = document.getElementById('detail-map');
  if (!el) return;
  if (detailMap) { detailMap.remove(); detailMap = null; }
  detailMap = makeMap(el, [p.lat, p.lng], 13);
  L.circle([p.lat, p.lng], {radius: 600, color: '#c2410c', fillOpacity: 0.12, weight: 2}).addTo(detailMap);
  setTimeout(() => detailMap?.invalidateSize(), 120);
}

/** Switches the enquiry box between a question and a site-visit booking */
function setEnquiryMode(mode) {
  if (mode === 'visit' && !document.getElementById('enq-tab-visit')) mode = 'enquiry'; // sold listings have no visits
  enqMode = mode;
  ['enquiry', 'visit'].forEach(m => {
    const tab = document.getElementById(`enq-tab-${m}`);
    if (tab) { tab.classList.toggle('on', m === mode); tab.setAttribute('aria-selected', m === mode); }
  });
  document.querySelectorAll('.enq-visit').forEach(el => { el.hidden = mode !== 'visit'; });
  const phone = document.getElementById('enq-phone');
  if (phone) phone.placeholder = mode === 'visit' ? 'Mobile number *' : 'Mobile, e.g. 98765 43210';
  const btn = document.getElementById('enq-submit');
  if (btn) btn.innerHTML = mode === 'visit' ? `${ico('calendar')} Request Site Visit` : `${ico('send')} Send Enquiry`;
}

function calcEMI() {
  const P = parseFloat(document.getElementById('emi-amount')?.value) || 0;
  const annual = parseFloat(document.getElementById('emi-rate')?.value);
  const years = parseFloat(document.getElementById('emi-years')?.value) || 0;
  const el = document.getElementById('emi-result');
  if (!el) return;
  const n = years * 12;
  if (P <= 0 || n <= 0 || !(annual >= 0)) { el.textContent = 'Enter valid values'; return; }
  const r = annual / 12 / 100;
  const emi = r === 0 ? P / n : (P * r * Math.pow(1+r, n)) / (Math.pow(1+r, n) - 1);
  el.textContent = `EMI: ₹${Math.round(emi).toLocaleString('en-IN')}/month · Total: ₹${Math.round(emi*n).toLocaleString('en-IN')}`;
}

async function submitEnquiry() {
  if (!document.getElementById('enq-email')) return;
  const p = allProps.find(x => x.id === currentPropId) || {};
  const visit = enqMode === 'visit';
  const values = checkForm(visit ? 'site-visit' : 'property-enquiry', FIELDS.enquiry);
  if (!values) return;
  const date = document.getElementById('enq-date');
  if (visit && !date.value) { setFieldError(date, 'Choose a date for the visit'); date.focus(); return; }
  setFieldError(date, '');
  const visitNote = visit ? `Site visit request: ${date.value}, ${document.getElementById('enq-slot').value}. ` : '';
  const ok = await withBusy(document.getElementById('enq-submit'), () => postLead({
    ...values,
    message: (visitNote + (values.message || '')).trim(),
    property_id: currentPropId,
    search_city: p.city || '',
    search_type: p.type || '',
    source: visit ? 'site-visit' : 'property-enquiry',
  }, FIELDS.enquiry));
  if (!ok) return;
  toast(visit ? "Site visit requested! We'll call you to confirm the time." : 'Enquiry sent! Our team will contact you shortly.', 'ok');
  document.getElementById('enq-message').value = '';
  date.value = '';
}

function quickEnquire(id) { openDetail(id, true); }

// ── Search ─────────────────────────────────────────────────────────────────
function selectHTML(id, label, options) {
  return `<div class="sf-group"><label class="sf-label" for="${id}">${label}</label><select class="sf-control" id="${id}">${
    options.map(o => Array.isArray(o) ? `<option value="${o[0]}">${o[1]}</option>` : `<option>${o}</option>`).join('')}</select></div>`;
}

function renderSearchForm(type) {
  const el = document.getElementById('search-form-body');
  if (!el) return;
  const prevCity = document.getElementById('sf-city')?.value || '';
  const prevPhone = document.getElementById('sf-phone')?.value || user?.phone || '';
  const cityField = selectHTML('sf-city', 'City', CITY_OPTIONS.map((c, i) => [i === 0 ? '' : esc(c), esc(c)]));
  const bhk = selectHTML('sf-bhk', 'BHK', [['','Any'],'1 BHK','2 BHK','3 BHK','4 BHK','4+ BHK']);
  const searchBtn = `<button class="sf-btn" data-on-click="doSearch()">${ico('search')} ${TYPE_SEARCH_BTN[type] || 'Search'}</button>`;
  let mid = '';
  if (type === 'buy') {
    mid = selectHTML('sf-subtype', 'Property Type', [['','Any Type'],'Apartment','Villa / Bungalow','Independent House','Builder Floor','Studio'])
      + selectHTML('sf-budget', 'Budget', [['','Any Budget'],['0-5000000','Up to ₹50 Lac'],['5000000-10000000','₹50L – ₹1 Cr'],['10000000-20000000','₹1 Cr – ₹2 Cr'],['20000000-50000000','₹2 Cr – ₹5 Cr'],['50000000+','₹5 Cr+']])
      + bhk;
  } else if (type === 'rent') {
    mid = selectHTML('sf-subtype', 'Property Type', [['','Any Type'],'Apartment','Villa / Bungalow','PG / Hostel','Studio / 1-RK','Independent House'])
      + selectHTML('sf-budget', 'Monthly Rent', [['','Any Rent'],['0-10000','Up to ₹10,000'],['10000-25000','₹10K – ₹25K'],['25000-50000','₹25K – ₹50K'],['50000-100000','₹50K – ₹1 Lac'],['100000+','₹1 Lac+']])
      + bhk
      + selectHTML('sf-furnish', 'Furnishing', [['','Any'],'Furnished','Semi-Furnished','Unfurnished']);
  } else if (type === 'plots') {
    mid = selectHTML('sf-subtype', 'Plot Type', [['','Any Type'],'Residential Plot','NA-Approved Plot','Agricultural Land','Farmhouse Plot','Commercial Plot'])
      + selectHTML('sf-area', 'Plot Area', [['','Any Area'],['0-1000','Up to 1,000 sq ft'],['1000-2500','1,000 – 2,500 sq ft'],['2500-5000','2,500 – 5,000 sq ft'],['5000-10000','5,000 – 10,000 sq ft'],['10000+','10,000+ sq ft']])
      + selectHTML('sf-budget', 'Budget', [['','Any Budget'],['0-2500000','Up to ₹25 Lac'],['2500000-5000000','₹25L – ₹50 Lac'],['5000000-10000000','₹50L – ₹1 Cr'],['10000000-30000000','₹1 Cr – ₹3 Cr'],['30000000+','₹3 Cr+']]);
  } else if (type === 'commercial') {
    mid = selectHTML('sf-subtype', 'Commercial Type', [['','Any Type'],'Office Space','Retail Shop','Showroom','Warehouse / Godown','Co-working Space','Industrial Shed'])
      + selectHTML('sf-transaction', 'Transaction', [['','Buy or Lease'],['buy','Buy / Purchase'],['lease','Lease / Rent']])
      + selectHTML('sf-area', 'Carpet Area', [['','Any Size'],['0-500','Up to 500 sq ft'],['500-1000','500 – 1,000 sq ft'],['1000-2500','1,000 – 2,500 sq ft'],['2500-5000','2,500 – 5,000 sq ft'],['5000+','5,000+ sq ft']])
      + selectHTML('sf-budget', 'Budget', [['','Any Budget'],['0-5000000','Up to ₹50 Lac'],['5000000-10000000','₹50L – ₹1 Cr'],['10000000-30000000','₹1 Cr – ₹3 Cr'],['30000000-100000000','₹3 Cr – ₹10 Cr'],['100000000+','₹10 Cr+']]);
  }
  const phoneField = `<div class="sf-group sf-phone"><label class="sf-label" for="sf-phone">Your Mobile Number</label><input type="tel" inputmode="tel" class="sf-control" id="sf-phone" placeholder="e.g. 98765 43210" maxlength="20" autocomplete="tel" required aria-required="true" value="${esc(prevPhone)}"></div>`;
  el.innerHTML = cityField + mid + phoneField + searchBtn;
  if (prevCity) setCityOption(prevCity);
  liveValidate('search', FIELDS.search);
}

function setCityOption(city) {
  const sel = document.getElementById('sf-city');
  if (!sel) return;
  if (![...sel.options].some(o => o.value === city)) sel.add(new Option(city, city));
  sel.value = city;
}

/** The form's submit button (event.submitter isn't available in every browser) */
function submitBtn(e) {
  return e.submitter || e.target.querySelector('[type="submit"]');
}

function setSearchType(btn) {
  document.querySelectorAll('.search-tab').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  activeSearchType = btn.dataset.type;
  renderSearchForm(activeSearchType);
}

async function doSearch() {
  const val = id => document.getElementById(id)?.value || '';
  const contact = checkForm('search', FIELDS.search);
  if (!contact) return;

  const f = {
    type: activeSearchType, city: val('sf-city'), budget: val('sf-budget'), bhk: val('sf-bhk'),
    subtype: val('sf-subtype'), area: val('sf-area'), furnishing: val('sf-furnish'), transaction: val('sf-transaction'),
  };

  const msgParts = [];
  if (f.subtype) msgParts.push(`Type: ${f.subtype}`);
  if (f.furnishing) msgParts.push(`Furnishing: ${f.furnishing}`);
  if (f.area) msgParts.push(`Area: ${f.area} sq ft`);
  if (f.transaction) msgParts.push(`Transaction: ${f.transaction}`);
  // Search tracking is best-effort — never block the results on it
  postLead({phone: contact.phone, search_city: f.city, search_type: f.type, search_budget: f.budget, search_bhk: f.bhk,
    message: msgParts.join(' | '), source: 'search'}).catch(() => {});

  const locationLabel = f.city ? ` in ${f.city}` : '';
  document.getElementById('prop-subtitle').textContent = `Search results · ${TYPE_LABELS[f.type]}${locationLabel}`;
  const props = await runListingQuery({...f, sort: listState.filters.sort}, `${TYPE_SECTION[f.type]} — Results`);
  if (!props) return;
  const [one, many] = {plots:['plot','plots'], commercial:['commercial space','commercial spaces'], rent:['rental','rentals']}[f.type] || ['property','properties'];
  toast(`Found ${listState.total} ${listState.total === 1 ? one : many}${locationLabel}`, 'ok');
}

async function searchByType(type, navEl) {
  activeSearchType = type;
  document.querySelectorAll('.search-tab').forEach(b => b.classList.toggle('on', b.dataset.type === type));
  renderSearchForm(type);
  document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('on'));
  navEl?.classList?.add('on');
  document.querySelectorAll('.mn-item[data-nav-type]').forEach(b => b.classList.toggle('on', b.dataset.navType === type));
  document.getElementById('prop-subtitle').textContent = TYPE_SUBTITLE[type] || '';
  await runListingQuery({type}, TYPE_SECTION[type] || 'Properties');
}

async function filterByCity(city) {
  setCityOption(city);
  document.getElementById('prop-subtitle').textContent = `All listing types in ${city}`;
  await runListingQuery({city}, `Properties in ${city}`);
}

function setupFilterPills() {
  document.querySelectorAll('#type-filters .pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const {featured, ...rest} = listState.filters;
      const type = btn.dataset.type === 'all' ? '' : btn.dataset.type;
      const next = {...rest, type, transaction: ''};
      runListingQuery(next, featured && !type ? 'All Properties' : headingFor(next), false);
    });
  });
}

// ── Wishlist (saved properties) ───────────────────────────────────────────
function updateSavedCount() {
  document.querySelectorAll('.saved-count').forEach(el => { el.textContent = wishlist.length; });
}

async function syncWishlist() {
  store('lr_wishlist', wishlist);
  updateSavedCount();
  if (!user) return;
  try { wishlist = (await api('/api/wishlist', {method:'PUT', body:{ids: wishlist}})).data; store('lr_wishlist', wishlist); updateSavedCount(); }
  catch (e) { toast(e.message, 'err'); }
}

function toggleWishlist(e, id) {
  e.stopPropagation();
  const adding = !wishlist.includes(id);
  wishlist = adding ? [...wishlist, id] : wishlist.filter(x => x !== id);
  document.querySelectorAll(`[data-heart="${id}"]`).forEach(btn => {
    btn.classList.toggle('liked', adding);
    btn.setAttribute('aria-pressed', adding);
  });
  toast(adding ? 'Saved to your list' : 'Removed from saved', 'ok');
  syncWishlist();
  if (document.getElementById('saved-modal').classList.contains('open')) renderSaved();
}

async function openSaved() {
  openModal('saved-modal');
  await renderSaved();
}

async function renderSaved() {
  const grid = document.getElementById('saved-grid');
  const note = document.getElementById('saved-note');
  note.innerHTML = user ? 'Saved to your account.' :
    'Saved on this device only. <a href="#" data-on-click="signInFromSaved();return false">Sign in</a> to keep them on every device.';
  if (!wishlist.length) {
    grid.innerHTML = `<div class="no-results" style="grid-column:1/-1"><div class="no-results-icon">${ico('heart')}</div><p><strong>No saved properties yet.</strong><br>Tap the heart on any listing to save it here.</p></div>`;
    return;
  }
  grid.innerHTML = SKELETONS;
  try {
    const {data} = await api('/api/properties?limit=200&ids=' + wishlist.join(','));
    // Drop ids of listings that were removed
    const found = new Set(data.map(p => p.id));
    if (found.size !== wishlist.length) { wishlist = wishlist.filter(id => found.has(id)); syncWishlist(); }
    data.forEach(p => { if (!allProps.some(x => x.id === p.id)) allProps.push(p); });
    grid.innerHTML = data.length ? data.map(propCardHTML).join('') :
      '<div class="no-results" style="grid-column:1/-1"><p>Your saved properties are no longer listed.</p></div>';
  } catch (e) {
    grid.innerHTML = `<div class="load-error">${esc(e.message)}</div>`;
  }
}

// ── Accounts ───────────────────────────────────────────────────────────────
async function restoreSession() {
  if (readJSON('lr_signed_in', null) && await refreshAccessToken()) await mergeWishlist();
  renderAccount();
}

async function mergeWishlist() {
  try {
    const server = (await api('/api/wishlist')).data || [];
    const merged = [...new Set([...server, ...wishlist])];
    wishlist = merged;
    if (merged.length !== server.length) await syncWishlist();
    else { store('lr_wishlist', wishlist); updateSavedCount(); }
  } catch {}
}

function renderAccount() {
  const btn = document.getElementById('account-btn');
  const mobile = document.getElementById('mobile-account-link');
  if (user) {
    const first = (user.name || user.email).split(' ')[0];
    btn.innerHTML = `<span class="avatar">${esc(first[0])}</span><span class="acct-name">${esc(first)}</span>${ico('chevron')}`;
    mobile.innerHTML = `${ico('logout')} Sign Out (${esc(first)})`;
    document.getElementById('account-email').textContent = user.email;
  } else {
    btn.innerHTML = `${ico('user')} Sign In`;
    mobile.innerHTML = `${ico('user')} Sign In`;
  }
  document.querySelectorAll('.signed-in-only').forEach(el => { el.hidden = !user; });
  document.querySelectorAll('.owner-only').forEach(el => { el.hidden = !user?.is_owner; });
  renderSearchForm(activeSearchType);
}

function accountClick() {
  if (!user) return openAuth('signin');
  if (window.innerWidth <= 900) return signOut();
  document.getElementById('account-menu').classList.toggle('open');
}
function closeAccountMenu() { document.getElementById('account-menu').classList.remove('open'); }
document.addEventListener('click', e => { if (!e.target.closest('.account')) closeAccountMenu(); });

// Where to go back to after signing in (e.g. the Saved list)
let afterSignIn = null;

function signInFromSaved() {
  afterSignIn = openSaved;
  openAuth('signin');
}

function openAuth(mode) {
  // Only one popup at a time: close whatever is open (Saved list, property details…) first
  document.querySelectorAll('.modal-overlay.open').forEach(m => { if (m.id !== 'auth-modal') closeModal(m.id); });
  switchAuthTab(mode);
  openModal('auth-modal');
  setTimeout(() => document.getElementById(mode === 'register' ? 'auth-name' : 'auth-email').focus(), 50);
}

// Sign-in modal modes: 'signin', 'register', 'forgot' (request a password-reset email)
const AUTH_MODES = {
  signin:   {title: 'Sign In',          button: 'Sign In →',         form: 'login',          fields: () => FIELDS.login},
  register: {title: 'Create Account',   button: 'Create Account →',  form: 'register',       fields: () => FIELDS.register},
  forgot:   {title: 'Reset Password',   button: 'Send Reset Link →', form: 'forgotPassword', fields: () => FIELDS.forgot},
};

function switchAuthTab(mode) {
  authMode = mode;
  const reg = mode === 'register', forgot = mode === 'forgot';
  const cfg = AUTH_MODES[mode];
  document.getElementById('auth-tab-signin').classList.toggle('on', mode === 'signin');
  document.getElementById('auth-tab-register').classList.toggle('on', reg);
  document.querySelectorAll('#auth-modal .register-only').forEach(el => { el.hidden = !reg; });
  document.querySelectorAll('#auth-modal .signin-only').forEach(el => { el.hidden = mode !== 'signin'; });
  document.querySelectorAll('#auth-modal .forgot-only').forEach(el => { el.hidden = !forgot; });
  document.getElementById('auth-password-group').hidden = forgot;
  document.getElementById('auth-name').required = reg;
  document.getElementById('auth-password').autocomplete = reg ? 'new-password' : 'current-password';
  document.getElementById('auth-title').textContent = cfg.title;
  document.getElementById('auth-submit').textContent = cfg.button;
  document.getElementById('auth-submit').hidden = false;
  document.getElementById('auth-password').placeholder = reg ? 'At least 8 characters, letters and numbers' : 'Your password';
  document.getElementById('auth-error').textContent = '';
  document.getElementById('auth-success').hidden = true;
  clearFieldErrors(document.getElementById('auth-form'));
  window.LRPasswordToggle?.hideAll(document.getElementById('auth-form'));
  liveValidate(cfg.form, cfg.fields());
  updateStrength();
}

function showAuthSuccess(message) {
  const box = document.getElementById('auth-success');
  box.textContent = message;
  box.hidden = false;
  document.getElementById('auth-submit').hidden = true;
}

async function handleAuth(e) {
  e.preventDefault();
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  const cfg = AUTH_MODES[authMode];
  const fieldMap = cfg.fields();
  const body = checkForm(cfg.form, fieldMap);
  if (!body) return;
  const btn = document.getElementById('auth-submit');
  const endpoint = {signin: 'login', register: 'register', forgot: 'forgot-password'}[authMode];
  try {
    const res = await withBusy(btn, () => api(`/api/auth/${endpoint}`, {method:'POST', body}));
    if (authMode === 'forgot') {
      // Forgot-password always answers "check your email" (we never reveal whether an account exists)
      return showAuthSuccess(res.message);
    }
    // Sign in and register both return tokens — the user is signed in straight away
    setSignedIn(res);
    await mergeWishlist();
    renderAccount();
    document.getElementById('auth-password').value = '';
    closeModal('auth-modal');
    const name = user.name ? ', ' + user.name : '';
    toast(authMode === 'register' ? `Welcome to Landroof${name}! Your account is ready.` : `Welcome back${name}!`, 'ok');
    const next = afterSignIn;
    afterSignIn = null;
    if (next) next();
  } catch (err) {
    if (!showServerErrors(fieldMap, err)) errEl.textContent = err.message;
  }
}

// ── Links from emails: /?reset=…, /?signin=1, /?forgot=1 ──────
let resetToken = '';

async function handleEmailLinks() {
  const params = new URLSearchParams(location.search);
  const clean = () => history.replaceState(history.state, '', location.pathname);
  if (params.get('reset')) {
    resetToken = params.get('reset');
    clean();
    document.getElementById('reset-form').reset();
    clearFieldErrors(document.getElementById('reset-form'));
    openModal('reset-modal');
    return true;
  }
  if (params.get('owner')) {
    const token = params.get('owner');
    clean();
    await useOwnerLink(token);
    return true;
  }
  if (params.get('signin') || params.get('forgot')) {
    clean();
    openAuth(params.get('forgot') ? 'forgot' : 'signin');
    return true;
  }
  return false;
}

async function handleResetPassword(e) {
  e.preventDefault();
  const errEl = document.getElementById('reset-error');
  errEl.textContent = '';
  const values = checkForm('resetPassword', {password: 'reset-password'});
  const confirmEl = document.getElementById('reset-confirm');
  const mismatch = confirmEl.value !== document.getElementById('reset-password').value;
  setFieldError(confirmEl, mismatch ? 'The passwords do not match' : '');
  if (!values) return;
  if (mismatch) { confirmEl.focus(); return; }
  try {
    const res = await withBusy(submitBtn(e), () => api('/api/auth/reset-password', {method:'POST', body:{token: resetToken, password: values.password}}));
    resetToken = '';
    setSignedIn(res);
    await mergeWishlist();
    renderAccount();
    closeModal('reset-modal');
    toast('Password changed — you are signed in.', 'ok');
  } catch (err) {
    if (!showServerErrors({password: 'reset-password'}, err)) errEl.textContent = err.message;
  }
}

async function signOut() {
  closeAccountMenu();
  try { await api('/api/auth/logout', {method:'POST'}); } catch {}
  clearSignedIn();
  renderAccount();
  toast('You have been signed out', 'ok');
}

async function signOutEverywhere() {
  closeAccountMenu();
  if (!await confirmBox({title: 'Sign out everywhere?', message: 'You will be signed out of your Landroof account on every phone and computer, including this one.', confirmText: 'Sign out everywhere', tone: 'danger', icon: 'logout'})) return;
  try {
    await api('/api/auth/logout-all', {method:'POST'});
    clearSignedIn();
    renderAccount();
    toast('Signed out on all devices', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

function openChangePassword() {
  closeAccountMenu();
  const form = document.getElementById('pw-form');
  form.reset();
  clearFieldErrors(form);
  document.getElementById('pw-error').textContent = '';
  openModal('password-modal');
}

async function handleChangePassword(e) {
  e.preventDefault();
  const errEl = document.getElementById('pw-error');
  errEl.textContent = '';
  const values = checkForm('changePassword', FIELDS.changePassword, {email: user?.email || ''});
  const confirmEl = document.getElementById('pw-confirm');
  const mismatch = confirmEl.value !== document.getElementById('pw-new').value;
  setFieldError(confirmEl, mismatch ? 'The passwords do not match' : '');
  if (!values) return;
  if (mismatch) { confirmEl.focus(); return; }
  try {
    const res = await withBusy(submitBtn(e), () => api('/api/auth/change-password', {method:'POST', body: values}));
    setSignedIn(res);
    closeModal('password-modal');
    toast('Password changed. Other devices have been signed out.', 'ok');
  } catch (err) {
    if (!showServerErrors(FIELDS.changePassword, err)) errEl.textContent = err.message;
  }
}

// ── Other forms ────────────────────────────────────────────────────────────
// "List Property": approved owners go straight to My Properties; everyone else sends a request
function openListProperty() {
  closeMenu();
  if (user?.is_owner) return openOwnerPanel();
  if (user) {
    document.getElementById('list-name').value ||= user.name || '';
    document.getElementById('list-email').value ||= user.email || '';
    document.getElementById('list-phone').value ||= user.phone || '';
  }
  openModal('list-modal');
}

async function handleListProperty(e) {
  e.preventDefault();
  const values = checkForm('list-property', FIELDS.list);
  if (!values) return;
  const res = await withBusy(submitBtn(e), () => postLead({
    ...values,
    search_type: document.getElementById('list-type').value,
    message: values.message || 'List property enquiry', source: 'list-property'
  }, FIELDS.list));
  if (!res) return;
  e.target.reset();
  closeModal('list-modal');
  const email = String(values.email || '').toLowerCase();
  if (res.listing?.status === 'approved') {
    if (user && user.email === email) {
      user.is_owner = true;
      renderAccount();
      openOwnerPanel();
      toast('You are approved — add your property here.', 'ok');
    } else {
      toast(`You're already approved! Sign in with ${email} to add your property.`, 'ok');
      afterSignIn = openOwnerPanel;
      openAuth('signin');
      document.getElementById('auth-email').value = email;
    }
  } else if (res.listing?.existing) {
    toast("We already have your request. We'll email you as soon as it's approved.", 'ok');
  } else {
    toast(`Request sent! We'll email ${email} once it's approved.`, 'ok');
  }
}

// ── My Properties (approved owners) ───────────────────────────────────────
const OWNER_SUBTYPES = {
  buy: ['Apartment','Villa / Bungalow','Independent House','Builder Floor','Studio'],
  rent: ['Apartment','Villa / Bungalow','PG / Hostel','Studio / 1-RK','Independent House'],
  plots: ['Residential Plot','NA-Approved Plot','Agricultural Land','Farmhouse Plot','Commercial Plot'],
  commercial: ['Office Space','Retail Shop','Showroom','Warehouse / Godown','Co-working Space','Industrial Shed'],
};
const OWNER_FIELDS = {
  title: 'op-title', type: 'op-type', subtype: 'op-subtype', price_label: 'op-price', price_val: 'op-price-val',
  area: 'op-area', beds: 'op-beds', baths: 'op-baths', city: 'op-city', locality: 'op-locality',
  status: 'op-status', rera: 'op-rera', description: 'op-desc',
  furnishing: 'op-furnishing', possession: 'op-possession', age_band: 'op-age', video_url: 'op-video', tour_url: 'op-tour',
  lat: 'op-lat', lng: 'op-lng',
};
const REVIEW = {
  draft: ['Draft — not sent yet', 'st-draft'], pending: ['Submitted — waiting for review', 'st-pending'],
  under_review: ['Under review', 'st-pending'], changes: ['Corrections needed', 'st-rejected'],
  approved: ['Live on website', 'st-live'], rejected: ['Not approved', 'st-rejected'],
};
let ownerProps = [], ownerEditId = null;

async function openOwnerPanel() {
  if (!user) { afterSignIn = openOwnerPanel; return openAuth('signin'); }
  openModal('owner-modal');
  const list = document.getElementById('op-list');
  list.innerHTML = '<div class="op-empty">Loading…</div>';
  try {
    const res = await api('/api/owner/properties');
    ownerProps = res.data;
    if (user.is_owner !== res.owner) { user.is_owner = res.owner; renderAccount(); }
    document.querySelector('#owner-modal .op-top .btn').hidden = !res.owner;
    if (!res.owner && !ownerProps.length) {
      list.innerHTML = `<div class="op-empty">${ico('home')}<p><strong>Your account isn't approved for listings yet.</strong><br>Send a request with "List Property" and we'll email you once it's approved.</p></div>`;
      return;
    }
    renderOwnerProps();
  } catch (e) {
    list.innerHTML = `<div class="load-error">${esc(e.message)}</div>`;
  }
}

/** One label per step: draft → submitted → under review → live (or corrections / not approved), then sold / rented / expired */
function ownerStatus(p) {
  if (p.review_status === 'approved') {
    return {active: ['Live on website', 'st-live'], sold: ['Sold', 'st-done'], rented: ['Rented out', 'st-done'], expired: ['Expired', 'st-rejected'], withdrawn: ['Withdrawn', 'st-pending']}[p.listing_status] || ['Live on website', 'st-live'];
  }
  return REVIEW[p.review_status] || REVIEW.pending;
}

function renderOwnerProps() {
  const list = document.getElementById('op-list');
  if (!ownerProps.length) {
    list.innerHTML = `<div class="op-empty">${ico('home')}<p><strong>No listings yet.</strong><br>Click "Add Property" to add your first one.</p></div>`;
    return;
  }
  list.innerHTML = ownerProps.map(p => {
    const [label, cls] = ownerStatus(p);
    const id = Number(p.id);
    const published = p.review_status === 'approved';
    const live = published && p.listing_status === 'active';
    return `<div class="op-item">
      <div class="op-thumb">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : ico(TYPE_ICONS[p.type] || 'home')}</div>
      <div class="op-info">
        <div class="op-name">${esc(p.title)} <small>${esc(p.listing_code)}</small></div>
        <div class="op-meta">${esc(p.price_label)} · ${esc([p.locality, p.city].filter(Boolean).join(', '))}</div>
        <span class="op-status ${cls}">${label}</span>${p.verified_at ? ` <span class="op-status st-live">${ico('check')} Verified</span>` : ''}
        ${live && p.expires_at ? `<div class="op-sub">Live until ${esc(fmtDate(p.expires_at))}</div>` : ''}
        ${p.listing_status === 'expired' ? `<div class="op-note">This listing expired. Edit it and send it again to publish it for another 90 days.</div>` : ''}
        ${(p.review_status === 'rejected' || p.review_status === 'changes') && p.review_note ? `<div class="op-note">${p.review_status === 'changes' ? 'Please correct' : 'Note from our team'}: ${esc(p.review_note)}</div>` : ''}
        ${p.documents?.length ? `<div class="op-sub">${ico('lock')} ${p.documents.length} private document${p.documents.length === 1 ? '' : 's'} — only our team can see ${p.documents.length === 1 ? 'it' : 'them'}</div>` : ''}
      </div>
      <div class="op-actions">
        ${live ? `<button type="button" class="btn btn-ghost btn-sm" data-on-click="openDetail(${id})">View</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-on-click="openOwnerForm(${id})">${p.review_status === 'draft' ? 'Continue' : 'Edit'}</button>
        ${live ? `<button type="button" class="btn btn-ghost btn-sm" data-on-click="setOwnerStatus(${id},'${isLease(p) ? 'rented' : 'sold'}')">Mark ${isLease(p) ? 'rented' : 'sold'}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-on-click="setOwnerStatus(${id},'withdrawn')">Withdraw</button>` : ''}
        ${published && p.listing_status === 'withdrawn' ? `<button type="button" class="btn btn-ghost btn-sm" data-on-click="setOwnerStatus(${id},'active')">Relist</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-on-click="openOwnerHistory(${id})">History</button>
        <button type="button" class="btn btn-ghost btn-sm op-del" data-on-click="deleteOwnerProperty(${id})">Delete</button>
      </div>
    </div>`;
  }).join('');
}

async function setOwnerStatus(id, status) {
  const p = ownerProps.find(x => x.id === id);
  const text = {
    sold: ['Mark as sold?', 'It will be taken off the search and shown as sold.', 'Mark sold'],
    rented: ['Mark as rented?', 'It will be taken off the search and shown as rented out.', 'Mark rented'],
    withdrawn: ['Withdraw this listing?', 'It will be hidden from the website until you relist it.', 'Withdraw'],
    active: ['Relist this listing?', 'It will appear on the website again.', 'Relist'],
  }[status];
  if (!await confirmBox({title: text[0], message: `"${p?.title}": ${text[1]}`, confirmText: text[2], tone: status === 'active' ? 'ok' : 'info', icon: status === 'active' ? 'check' : 'alert'})) return;
  try {
    await api(`/api/owner/properties/${id}/status`, {method: 'POST', body: {status}});
    toast({sold: 'Marked as sold', rented: 'Marked as rented', withdrawn: 'Listing withdrawn', active: 'Listing is live again'}[status], 'ok');
    openOwnerPanel();
  } catch (e) { toast(e.message, 'err'); }
}

const EVENT_LABEL = {
  'draft.saved': 'Saved as draft', submitted: 'Sent for review', resubmitted: 'Changes sent for review',
  'review.under_review': 'Review started', 'review.changes': 'Corrections requested', 'review.approved': 'Approved and published',
  'review.rejected': 'Not approved', verified: 'Verified by Landroof', 'verification.removed': 'Verification removed',
  'listing.status': 'Status changed', 'document.added': 'Document added', 'document.published': 'Document published',
  'document.unpublished': 'Document made private', 'document.deleted': 'Document deleted', 'admin.create': 'Listing created',
  'report.resolved': 'Report resolved', 'report.dismissed': 'Report closed',
};

async function openOwnerHistory(id) {
  const p = ownerProps.find(x => x.id === id);
  const box = document.getElementById('owner-history-body');
  document.getElementById('owner-history-title').textContent = p ? p.title : 'History';
  box.innerHTML = '<div class="op-empty">Loading…</div>';
  openModal('owner-history-modal');
  try {
    const {data} = await api(`/api/owner/properties/${id}/history`);
    box.innerHTML = data.length ? `<ol class="timeline">${data.map(e => `<li>
      <b>${esc(EVENT_LABEL[e.action] || e.action)}${e.action === 'listing.status' && e.to_status ? ': ' + esc(LISTING_LABEL[e.to_status] || e.to_status) : ''}</b>
      <span>${esc(fmtDate(e.created_at))} · ${esc(e.by)}</span>
      ${e.note ? `<p>${esc(e.note)}</p>` : ''}
    </li>`).join('')}</ol>` : '<div class="op-empty">No history yet.</div>';
  } catch (e) { box.innerHTML = `<div class="load-error">${esc(e.message)}</div>`; }
}

function fillOwnerSubtypes(selected = '') {
  const type = document.getElementById('op-type').value;
  const list = OWNER_SUBTYPES[type] || [];
  const sel = document.getElementById('op-subtype');
  sel.innerHTML = '<option value="">— Choose —</option>' + list.map(x => `<option>${esc(x)}</option>`).join('')
    + (selected && !list.includes(selected) ? `<option>${esc(selected)}</option>` : '');
  sel.value = selected;
}

let ownerGalleryRemove = new Set(), ownerMap = null, ownerPin = null;

async function openOwnerForm(id) {
  const p = id ? ownerProps.find(x => x.id === id) : null;
  ownerEditId = p ? p.id : null;
  ownerGalleryRemove = new Set();
  const form = document.getElementById('owner-form');
  form.reset();
  clearFieldErrors(form);
  document.getElementById('op-error').textContent = '';
  const city = document.getElementById('op-city');
  city.innerHTML = CITY_OPTIONS.slice(1).map(c => `<option>${esc(c)}</option>`).join('');
  if (p?.city && ![...city.options].some(o => o.value === p.city)) city.add(new Option(p.city, p.city));
  document.getElementById('owner-form-title').textContent = p ? (p.review_status === 'draft' ? 'Finish Your Listing' : 'Edit Property') : 'Add Property';
  const canDraft = !p || ['draft', 'changes', 'rejected'].includes(p.review_status);
  document.getElementById('op-draft').hidden = !canDraft;
  document.getElementById('op-submit').textContent = p && p.review_status !== 'draft' ? 'Save & Send for Review' : 'Submit for Review';
  const opts = await getListingOptions();
  document.getElementById('op-furnishing').innerHTML = '<option value="">— Not applicable —</option>' + opts.furnishing.map(x => `<option>${esc(x)}</option>`).join('');
  document.getElementById('op-age').innerHTML = '<option value="">— Not specified —</option>' + opts.age_bands.map(x => `<option>${esc(x)}</option>`).join('');
  const chosen = p?.amenities_list || [];
  document.getElementById('op-amenities').innerHTML = opts.amenities.map((a, i) =>
    `<label class="check-chip"><input type="checkbox" value="${esc(a)}" id="op-am-${i}" ${chosen.includes(a) ? 'checked' : ''}><span>${esc(a)}</span></label>`).join('');
  if (p) Object.entries(OWNER_FIELDS).forEach(([k, elId]) => { if (k !== 'subtype') document.getElementById(elId).value = p[k] ?? ''; });
  fillOwnerSubtypes(p?.subtype || '');
  const cur = document.getElementById('op-current');
  cur.hidden = !p?.image_url;
  cur.innerHTML = p?.image_url ? `<img src="${esc(p.image_url)}" alt=""> Current main photo. Choose a new file to replace it.` : '';
  const gal = document.getElementById('op-gallery-current');
  const photos = p?.gallery_urls || [];
  gal.hidden = !photos.length;
  gal.innerHTML = photos.map(u => `<button type="button" class="op-gthumb" data-url="${esc(u)}" data-on-click="toggleOwnerPhoto(this)" aria-pressed="false" title="Remove this photo"><img src="${esc(u)}" alt=""><span>${ico('x')}</span></button>`).join('')
    + (photos.length ? '<small>Tap a photo to remove it.</small>' : '');
  const plan = document.getElementById('op-plan-current');
  plan.hidden = !p?.floor_plan_url;
  plan.innerHTML = p?.floor_plan_url ? `<a href="${esc(p.floor_plan_url)}" target="_blank" rel="noopener">Current floor plan</a> · <label><input type="checkbox" id="op-plan-remove"> Remove</label>` : '';
  document.getElementById('op-docs-current').textContent = p?.documents?.length ? `${p.documents.length} document${p.documents.length === 1 ? '' : 's'} already uploaded.` : '';
  openModal('owner-form-modal');
  setOwnerPin(p?.lat, p?.lng);
  setTimeout(() => document.getElementById('op-title').focus(), 60);
}

function toggleOwnerPhoto(btn) {
  const url = btn.dataset.url;
  if (ownerGalleryRemove.has(url)) ownerGalleryRemove.delete(url); else ownerGalleryRemove.add(url);
  const on = ownerGalleryRemove.has(url);
  btn.classList.toggle('removing', on);
  btn.setAttribute('aria-pressed', on);
}

/** Location pin: tap the map to place it (optional) */
async function setOwnerPin(lat, lng) {
  document.getElementById('op-lat').value = lat ?? '';
  document.getElementById('op-lng').value = lng ?? '';
  try { await loadLeaflet(); } catch { document.getElementById('op-map-wrap').hidden = true; return; }
  const center = lat && lng ? [lat, lng] : [18.52, 73.86];
  if (!ownerMap) {
    ownerMap = makeMap('op-map', center, lat ? 14 : 10);
    ownerMap.on('click', e => placeOwnerPin(e.latlng.lat, e.latlng.lng));
  } else ownerMap.setView(center, lat ? 14 : 10);
  if (ownerPin) { ownerPin.remove(); ownerPin = null; }
  if (lat && lng) placeOwnerPin(lat, lng);
  setTimeout(() => ownerMap.invalidateSize(), 150);
}
function placeOwnerPin(lat, lng) {
  if (ownerPin) ownerPin.setLatLng([lat, lng]);
  else ownerPin = L.circleMarker([lat, lng], {radius: 9, color: '#c2410c', fillColor: '#ea580c', fillOpacity: 0.9}).addTo(ownerMap);
  document.getElementById('op-lat').value = lat.toFixed(6);
  document.getElementById('op-lng').value = lng.toFixed(6);
  document.getElementById('op-pin-note').textContent = 'Location set. Tap again to move it.';
}
function clearOwnerPin() {
  if (ownerPin) { ownerPin.remove(); ownerPin = null; }
  document.getElementById('op-lat').value = '';
  document.getElementById('op-lng').value = '';
  document.getElementById('op-pin-note').textContent = 'Tap the map to mark the approximate location (optional).';
}

function closeOwnerForm() { closeModal('owner-form-modal'); }

// Field → input, also for the server's per-field messages
const OWNER_ERROR_FIELDS = () => ({...OWNER_FIELDS, image: 'op-image', gallery: 'op-gallery', floor_plan: 'op-floor', documents: 'op-docs'});
function saveOwnerDraft() { saveOwnerProperty(null, true); }

async function saveOwnerProperty(e, draft = false) {
  e?.preventDefault();
  const form = document.getElementById('owner-form');
  clearFieldErrors(form);
  const errEl = document.getElementById('op-error');
  errEl.textContent = '';
  const val = k => document.getElementById(OWNER_FIELDS[k]).value.trim();
  const existing = ownerEditId ? ownerProps.find(x => x.id === ownerEditId) : null;
  const photo = document.getElementById('op-image').files[0];
  // Same checks as the server: drafts need only the basics, a submission needs every detail
  const checks = [['title', 'Please enter a title'], ['price_label', 'Please enter the price'], ['city', 'Please choose the city']];
  if (!draft) {
    checks.push(['subtype', 'Choose the property type'], ['price_val', 'Enter the price in ₹ (numbers only)'], ['locality', 'Enter the locality'],
      ['area', 'Enter the area in sq ft'], ['description', 'Describe the property (at least 30 characters)']);
  }
  const bad = checks.filter(([k]) => k === 'price_val' ? !(Number(val(k)) > 0) : k === 'description' ? val(k).length < 30 : k === 'area' ? !/\d/.test(val(k)) : !val(k));
  if (!draft && /Apartment|Villa|Independent House|Builder Floor/.test(val('subtype')) && !(Number(val('beds')) > 0)) bad.push(['beds', 'Enter the number of bedrooms']);
  if (!draft && !photo && !existing?.image_url) bad.push(['image', 'Add at least one photo']);
  const fields = OWNER_ERROR_FIELDS();
  if (bad.length) {
    bad.forEach(([k, m]) => setFieldError(document.getElementById(fields[k]), m));
    document.getElementById(fields[bad[0][0]]).focus();
    return;
  }
  const fd = new FormData();
  Object.keys(OWNER_FIELDS).forEach(k => fd.append(k, val(k)));
  fd.append('amenities', [...document.querySelectorAll('#op-amenities input:checked')].map(c => c.value).join(', '));
  if (draft) fd.append('draft', '1');
  const tooBig = f => f.size > 10 * 1024 * 1024;
  const files = [['op-image', 'image'], ['op-floor', 'floor_plan'], ['op-gallery', 'gallery'], ['op-docs', 'documents']];
  for (const [elId, name] of files) {
    const list = [...document.getElementById(elId).files];
    if (list.some(tooBig)) { setFieldError(document.getElementById(elId), 'Each file must be 10 MB or smaller'); return; }
    if (name === 'gallery' && list.length > 12) { setFieldError(document.getElementById(elId), 'Choose up to 12 photos at a time'); return; }
    if (name === 'documents' && list.length > 5) { setFieldError(document.getElementById(elId), 'Choose up to 5 documents at a time'); return; }
    list.forEach(f => fd.append(name, f));
  }
  if (ownerGalleryRemove.size) fd.append('remove_gallery', JSON.stringify([...ownerGalleryRemove]));
  if (document.getElementById('op-plan-remove')?.checked) fd.append('remove_floor_plan', '1');
  const btn = draft ? document.getElementById('op-draft') : document.getElementById('op-submit');
  try {
    const res = await withBusy(btn, () => api(ownerEditId ? `/api/owner/properties/${ownerEditId}` : '/api/owner/properties', {method: ownerEditId ? 'PUT' : 'POST', body: fd}));
    closeOwnerForm();
    if (draft) toast('Draft saved. Finish it any time from My Properties.', 'ok');
    else toast(ownerEditId ? 'Saved — our team will review your changes.' : "Submitted! We'll email you once it's approved.", 'ok');
    if (res.possible_duplicate) setTimeout(() => toast('This looks similar to a listing we already have — our team will check it.', 'ok'), 4200);
    openOwnerPanel();
  } catch (err) {
    if (!showServerErrors(fields, err)) errEl.textContent = err.message;
  }
}

async function deleteOwnerProperty(id) {
  const p = ownerProps.find(x => x.id === id);
  if (!await confirmBox({title: 'Delete this listing?', message: `"${p?.title || 'This listing'}" will be removed from your listings and the website. This cannot be undone.`, confirmText: 'Delete', tone: 'danger'})) return;
  try {
    await api(`/api/owner/properties/${id}`, {method: 'DELETE'});
    toast('Listing deleted', 'ok');
    openOwnerPanel();
  } catch (e) { toast(e.message, 'err'); }
}

// Link in the "request approved" email: signs the owner in, or asks a new owner to choose a password
let ownerLinkToken = '';
async function useOwnerLink(token) {
  ownerLinkToken = token;
  try {
    const res = await api('/api/auth/owner-link', {method: 'POST', body: {token}});
    if (res.needsPassword) {
      document.getElementById('owner-setup-email').textContent = res.email;
      document.getElementById('owner-setup-form').reset();
      clearFieldErrors(document.getElementById('owner-setup-form'));
      openModal('owner-setup-modal');
      return;
    }
    await finishOwnerSignIn(res);
  } catch (err) {
    toast(err.message, 'err');
    openAuth('signin');
  }
}

async function finishOwnerSignIn(res) {
  ownerLinkToken = '';
  setSignedIn(res);
  await mergeWishlist();
  renderAccount();
  closeModal('owner-setup-modal');
  openOwnerPanel();
  toast(`Welcome${user.name ? ', ' + user.name : ''}! Add your property below.`, 'ok');
}

async function handleOwnerSetup(e) {
  e.preventDefault();
  const errEl = document.getElementById('owner-setup-error');
  errEl.textContent = '';
  const values = checkForm('resetPassword', {password: 'owner-password'});
  const confirmEl = document.getElementById('owner-confirm');
  const mismatch = confirmEl.value !== document.getElementById('owner-password').value;
  setFieldError(confirmEl, mismatch ? 'The passwords do not match' : '');
  if (!values) return;
  if (mismatch) { confirmEl.focus(); return; }
  try {
    const res = await withBusy(submitBtn(e), () => api('/api/auth/owner-link', {method: 'POST', body: {token: ownerLinkToken, password: values.password}}));
    await finishOwnerSignIn(res);
  } catch (err) {
    if (!showServerErrors({password: 'owner-password'}, err)) errEl.textContent = err.message;
  }
}

async function handleInvestEnquiry(e) {
  e.preventDefault();
  const values = checkForm('investment-enquiry', FIELDS.invest);
  if (!values) return;
  const ok = await withBusy(submitBtn(e), () => postLead({
    ...values,
    search_budget: document.getElementById('inv-budget').value,
    search_type: document.getElementById('inv-type').value, source: 'investment-enquiry'
  }, FIELDS.invest));
  if (!ok) return;
  e.target.reset();
  closeModal('invest-modal');
  toast('Investment enquiry sent! Our advisor will call you.', 'ok');
}

function openContact(subject = 'General Enquiry') {
  const sel = document.getElementById('contact-subject');
  if (![...sel.options].some(o => o.value === subject)) sel.add(new Option(subject, subject));
  sel.value = subject;
  if (user) {
    document.getElementById('contact-name').value ||= user.name || '';
    document.getElementById('contact-email').value ||= user.email || '';
    document.getElementById('contact-phone').value ||= user.phone || '';
  }
  openModal('contact-modal');
}

async function handleContact(e) {
  e.preventDefault();
  const values = checkForm('contact', FIELDS.contact);
  if (!values) return;
  const ok = await withBusy(submitBtn(e), () => postLead({
    ...values, subject: document.getElementById('contact-subject').value, source: 'contact'
  }, FIELDS.contact));
  if (!ok) return;
  e.target.reset();
  closeModal('contact-modal');
  toast('Message sent! We will get back to you soon.', 'ok');
}

// ── Info pages (privacy / terms / RERA) ───────────────────────────────────
function openInfo(which) {
  const titles = {privacy:'Privacy Policy', terms:'Terms of Service', rera:'RERA Registrations'};
  document.getElementById('info-title').textContent = titles[which];
  const body = document.getElementById('info-body');
  body.innerHTML = '';
  body.appendChild(document.getElementById('info-' + which).content.cloneNode(true));
  if (siteConfig.contact_email) body.querySelectorAll('.cfg-email-link').forEach(l => { l.href = 'mailto:' + siteConfig.contact_email; l.textContent = siteConfig.contact_email; });
  openModal('info-modal');
}

// ── Analytics consent ─────────────────────────────────────────────────────
function initConsent() {
  if (readJSON('lr_consent', null) === null) document.getElementById('consent').hidden = false;
}
function setConsent(yes) {
  store('lr_consent', yes);
  document.getElementById('consent').hidden = true;
  toast(yes ? 'Thanks! Preference saved.' : 'Preference saved. Analytics are off.', 'ok');
}
function resetConsent() {
  store('lr_consent', null);
  closeModal('info-modal');
  document.getElementById('consent').hidden = false;
}

// ── Modal helpers ──────────────────────────────────────────────────────────
let modalOpener = null;  // element to give focus back to when the last modal closes
function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  if (!document.querySelector('.modal-overlay.open:not(.under-page)')) modalOpener = document.activeElement;
  closeMenu();
  overlay.classList.remove('under-page');
  if (!overlay.classList.contains('open')) pushLayer({kind: 'modal', id});
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  // Move focus into the dialog unless the caller already focused a field
  setTimeout(() => { if (!overlay.contains(document.activeElement)) overlay.querySelector('.modal')?.focus(); }, 80);
}
function closeModal(id) {
  const overlay = document.getElementById(id);
  const layer = layers.find(l => l.kind === 'modal' && l.id === id);
  overlay?.classList.remove('open', 'under-page');
  if (layer) dropLayer(layer);
  if (id === 'auth-modal' && !user) afterSignIn = null;
  if (!document.querySelector('.modal-overlay.open')) {
    document.body.style.overflow = '';
    if (modalOpener?.isConnected) modalOpener.focus({preventScroll: true});
    modalOpener = null;
  }
}
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || dialogClose) return;
  const open = document.querySelectorAll('.modal-overlay.open:not(.under-page)');
  if (open.length) open.forEach(m => closeModal(m.id));
  else closePage();
  closeAccountMenu(); closeMenu();
});

const menuLayer = {kind: 'menu'};
function setMenu(open) {
  const menu = document.getElementById('mobile-menu');
  if (open !== menu.classList.contains('open')) { if (open) pushLayer(menuLayer); else dropLayer(menuLayer); }
  menu.classList.toggle('open', open);
  const btn = document.getElementById('hamburger-btn');
  btn.setAttribute('aria-expanded', open);
  btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  document.body.classList.toggle('no-scroll', open);
}
function toggleMenu() { setMenu(!document.getElementById('mobile-menu').classList.contains('open')); }
function closeMenu() { setMenu(false); }
window.addEventListener('resize', () => { if (window.innerWidth > 900) closeMenu(); }, {passive:true});
function smoothScroll(sel, el) {
  document.querySelector(sel)?.scrollIntoView({behavior:'smooth'});
  document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('on'));
  el?.classList?.add('on');
}
function scrollToSection(id, btn) {
  document.getElementById(id)?.scrollIntoView({behavior:'smooth'});
  document.querySelectorAll('.mn-item').forEach(b => b.classList.remove('on'));
  btn?.classList.add('on');
}

// ── Scroll effects ─────────────────────────────────────────────────────────
function setupScroll() {
  const fabTop = document.getElementById('fab-top');
  const nav = document.getElementById('nav');
  const onScroll = () => {
    fabTop.classList.toggle('show', window.scrollY > 400);
    nav.classList.toggle('scrolled', window.scrollY > 8);
  };
  window.addEventListener('scroll', onScroll, {passive:true});
  onScroll();
}

function animateCounters() {
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseInt(el.dataset.target, 10) || 0;
      let current = 0;
      const step = Math.max(1, Math.ceil(target / 60));
      const t = setInterval(() => {
        current = Math.min(current + step, target);
        el.textContent = current.toLocaleString('en-IN');
        if (current >= target) clearInterval(t);
      }, 25);
      io.unobserve(el);
    });
  }, {threshold:.3});
  document.querySelectorAll('.counter').forEach(c => io.observe(c));
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-ico">${ico(type === 'err' ? 'alert' : 'check')}</span><span class="toast-msg"></span><span class="toast-bar"></span>`;
  el.querySelector('.toast-msg').textContent = msg;
  el.setAttribute('role', type === 'err' ? 'alert' : 'status');
  // Sit above the cookie banner while it is showing
  const banner = document.getElementById('consent');
  el.style.bottom = banner && !banner.hidden ? `${Math.max(window.innerHeight - banner.getBoundingClientRect().top + 12, 24)}px` : '';
  void el.offsetWidth; // restart the slide-in and progress animation
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

// ── Styled confirm dialog (instead of the browser's confirm) ──────────────
let dialogClose = null;

/** Resolves true / false. opts: title, message, confirmText, cancelText, tone ('danger' | 'ok' | 'info'), icon (sprite name) */
function confirmBox(opts) {
  if (dialogClose) dialogClose(false);
  const tone = opts.tone || 'info';
  const icon = opts.icon || {danger: 'x', ok: 'check', info: 'alert'}[tone] || 'alert';
  const wrap = document.createElement('div');
  wrap.className = 'dlg-overlay';
  wrap.innerHTML = `<div class="dlg dlg-${tone}" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-msg">
    <div class="dlg-ico">${ico(icon)}</div>
    <h3 class="dlg-title" id="dlg-title"></h3>
    <p class="dlg-msg" id="dlg-msg"></p>
    <div class="dlg-actions">
      <button type="button" class="btn btn-ghost dlg-cancel"></button>
      <button type="button" class="btn dlg-confirm"></button>
    </div>
  </div>`;
  wrap.querySelector('.dlg-title').textContent = opts.title || 'Are you sure?';
  wrap.querySelector('.dlg-msg').textContent = opts.message || '';
  wrap.querySelector('.dlg-cancel').textContent = opts.cancelText || 'Cancel';
  wrap.querySelector('.dlg-confirm').textContent = opts.confirmText || 'OK';
  document.body.appendChild(wrap);
  const opener = document.activeElement;
  const dialogLayer = {kind: 'dialog'};
  pushLayer(dialogLayer);
  const lockedBefore = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => wrap.classList.add('show'));
  wrap.querySelector('.dlg-confirm').focus();

  return new Promise(resolve => {
    const finish = ok => {
      dialogClose = null;
      dropLayer(dialogLayer);
      wrap.classList.remove('show');
      setTimeout(() => wrap.remove(), 200);
      document.body.style.overflow = lockedBefore;
      if (opener?.isConnected) opener.focus({preventScroll: true});
      resolve(ok);
    };
    dialogClose = finish;
    wrap.querySelector('.dlg-confirm').onclick = () => finish(true);
    wrap.querySelector('.dlg-cancel').onclick = () => finish(false);
    wrap.addEventListener('click', e => { if (e.target === wrap) finish(false); });
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === 'Tab') { // keep focus inside the dialog
        const [a, b] = wrap.querySelectorAll('button');
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    });
  });
}

// ── Utility ────────────────────────────────────────────────────────────────
/** An icon from the SVG sprite in index.html */
function ico(name, cls = '') {
  return `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}
const SKELETONS = '<div class="skel-card"><div class="skel-img skeleton"></div><div class="skel-body"><div class="skel-line w60 skeleton"></div><div class="skel-line w80 skeleton"></div><div class="skel-line w40 skeleton"></div></div></div>'.repeat(4);

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Filters panel, chips and sorting ──────────────────────────────────────
let listingOptions = null;
async function getListingOptions() {
  listingOptions ||= api('/api/listing-options').then(r => r.data).catch(() => { listingOptions = null; return {amenities: [], furnishing: [], age_bands: [], report_reasons: []}; });
  return listingOptions;
}

const BUDGETS_BUY = [[500000, '₹5 Lac'], [2500000, '₹25 Lac'], [5000000, '₹50 Lac'], [7500000, '₹75 Lac'], [10000000, '₹1 Cr'], [15000000, '₹1.5 Cr'], [20000000, '₹2 Cr'], [30000000, '₹3 Cr'], [50000000, '₹5 Cr'], [100000000, '₹10 Cr']];
const BUDGETS_RENT = [[5000, '₹5,000'], [10000, '₹10,000'], [15000, '₹15,000'], [25000, '₹25,000'], [40000, '₹40,000'], [60000, '₹60,000'], [100000, '₹1 Lac'], [200000, '₹2 Lac']];
const POSSESSION = {ready: 'Ready to move', 'under-construction': 'Under construction'};

/** Purpose (buy / rent) and category (residential / plot / commercial) ⇄ the API's type + transaction */
function toPurposeCategory(f) {
  const lease = f.transaction === 'lease' ? 'rent' : f.transaction === 'buy' ? 'buy' : '';
  if (f.type === 'buy') return ['buy', 'residential'];
  if (f.type === 'rent') return ['rent', 'residential'];
  if (f.type === 'buy,rent') return ['', 'residential'];
  if (f.type === 'plots') return [lease, 'plot'];
  if (f.type === 'commercial') return [lease, 'commercial'];
  return [lease, ''];
}
function fromPurposeCategory(purpose, category) {
  if (category === 'residential') return {type: purpose === 'buy' ? 'buy' : purpose === 'rent' ? 'rent' : 'buy,rent', transaction: ''};
  const transaction = purpose === 'rent' ? 'lease' : purpose === 'buy' ? 'buy' : '';
  return {type: category === 'plot' ? 'plots' : category === 'commercial' ? 'commercial' : '', transaction};
}

const fmtMoney = n => n >= 1e7 ? `₹${+(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${+(n / 1e5).toFixed(1)} Lac` : `₹${Number(n).toLocaleString('en-IN')}`;
function rangeLabel(v, fmt, unit = '') {
  const [a, b] = String(v).replace('+', '-').split('-');
  if (a && b) return `${fmt(a)} – ${fmt(b)}${unit}`;
  return a && a !== '0' ? `${fmt(a)}+${unit}` : `Up to ${fmt(b || a)}${unit}`;
}

/** Applied filters as removable chips: [{key(s), label}] */
function filterChips(f) {
  const chips = [];
  const [purpose, category] = toPurposeCategory(f);
  if (category) chips.push({keys: ['type', 'transaction'], label: {residential: 'Residential', plot: 'Plots & Land', commercial: 'Commercial'}[category] + (purpose ? ` · ${purpose === 'rent' ? 'Rent / Lease' : 'Buy'}` : '')});
  else if (purpose) chips.push({keys: ['transaction'], label: purpose === 'rent' ? 'Rent / Lease' : 'Buy'});
  if (f.q) chips.push({keys: ['q'], label: `“${f.q}”`});
  if (f.city) chips.push({keys: ['city'], label: f.city});
  if (f.locality) chips.push({keys: ['locality'], label: f.locality});
  if (f.subtype) chips.push({keys: ['subtype'], label: f.subtype});
  if (f.budget) chips.push({keys: ['budget'], label: rangeLabel(f.budget, fmtMoney)});
  if (f.rate) chips.push({keys: ['rate'], label: rangeLabel(f.rate, n => '₹' + Number(n).toLocaleString('en-IN'), ' / sq ft')});
  if (f.area) chips.push({keys: ['area'], label: rangeLabel(f.area, n => Number(n).toLocaleString('en-IN'), ' sq ft')});
  if (f.bhk) chips.push({keys: ['bhk'], label: f.bhk});
  if (f.furnishing) chips.push({keys: ['furnishing'], label: f.furnishing});
  if (f.possession) chips.push({keys: ['possession'], label: POSSESSION[f.possession] || f.possession});
  if (f.age) chips.push({keys: ['age'], label: `Age: ${f.age}`});
  if (f.amenities) chips.push({keys: ['amenities'], label: f.amenities.split(',').join(', ')});
  if (f.verified) chips.push({keys: ['verified'], label: 'Verified only'});
  if (f.bounds) chips.push({keys: ['bounds'], label: 'Map area'});
  if (f.featured) chips.push({keys: ['featured'], label: 'Featured'});
  return chips;
}

function renderFilterChips() {
  const chips = filterChips(listState.filters).filter(c => c.label !== 'Featured');
  const box = document.getElementById('filter-chips');
  box.innerHTML = chips.length ? chips.map((c, i) => `<button type="button" class="fchip" data-on-click="removeFilter(${i})" aria-label="Remove filter ${esc(c.label)}">${esc(c.label)} ${ico('x')}</button>`).join('')
    + `<button type="button" class="fchip-clear" data-on-click="clearAllFilters()">Clear all</button>` : '';
  const n = chips.length;
  const count = document.getElementById('filter-count');
  count.textContent = n;
  count.hidden = !n;
}

function removeFilter(i) {
  const chip = filterChips(listState.filters).filter(c => c.label !== 'Featured')[i];
  if (!chip) return;
  const next = {...listState.filters};
  chip.keys.forEach(k => delete next[k]);
  delete next.featured;
  runListingQuery(next, headingFor(next), false);
}

function clearAllFilters() {
  closeModal('filter-modal');
  runListingQuery({sort: listState.filters.sort}, 'All Properties', false);
}

function setSort(sel) {
  runListingQuery({...listState.filters, sort: sel.value}, listState.heading, false);
}

function radioValue(name) { return document.querySelector(`input[name="${name}"]:checked`)?.value || ''; }
function setRadio(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(r => { r.checked = r.value === value; });
}

/** Opens the filters panel, filled with the current search */
async function openFilters() {
  const f = listState.filters;
  const [purpose, category] = toPurposeCategory(f);
  setRadio('ff-purpose', purpose);
  setRadio('ff-cat', category);
  const city = document.getElementById('ff-city');
  city.innerHTML = `<option value="">Any city</option>` + CITY_OPTIONS.slice(1).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (f.city && ![...city.options].some(o => o.value === f.city)) city.add(new Option(f.city, f.city));
  city.value = f.city || '';
  document.getElementById('ff-q').value = f.q || '';
  document.getElementById('ff-locality').value = f.locality || '';
  fillBudgetOptions(purpose);
  const [bmin = '', bmax = ''] = String(f.budget || '').replace('+', '-').split('-');
  document.getElementById('ff-bmin').value = bmin === '0' ? '' : bmin;
  document.getElementById('ff-bmax').value = bmax;
  const [rmin = '', rmax = ''] = String(f.rate || '').replace('+', '-').split('-');
  document.getElementById('ff-rmin').value = rmin === '0' ? '' : rmin;
  document.getElementById('ff-rmax').value = rmax;
  const [amin = '', amax = ''] = String(f.area || '').replace('+', '-').split('-');
  document.getElementById('ff-amin').value = amin === '0' ? '' : amin;
  document.getElementById('ff-amax').value = amax;
  setRadio('ff-bhk', f.bhk || '');
  document.getElementById('ff-possession').value = f.possession || '';
  document.getElementById('ff-verified').checked = !!f.verified;
  openModal('filter-modal');
  const opts = await getListingOptions();
  const furnish = document.getElementById('ff-furnish');
  furnish.innerHTML = '<option value="">Any</option>' + opts.furnishing.map(x => `<option>${esc(x)}</option>`).join('');
  furnish.value = f.furnishing || '';
  const age = document.getElementById('ff-age');
  age.innerHTML = '<option value="">Any age</option>' + opts.age_bands.map(x => `<option>${esc(x)}</option>`).join('');
  age.value = f.age || '';
  const chosen = String(f.amenities || '').split(',');
  document.getElementById('ff-amenities').innerHTML = opts.amenities.map((a, i) =>
    `<label class="check-chip"><input type="checkbox" value="${esc(a)}" id="ff-am-${i}" ${chosen.includes(a) ? 'checked' : ''}><span>${esc(a)}</span></label>`).join('');
}

function fillBudgetOptions(purpose = radioValue('ff-purpose')) {
  const list = purpose === 'rent' ? BUDGETS_RENT : BUDGETS_BUY;
  const opts = list.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  const min = document.getElementById('ff-bmin'), max = document.getElementById('ff-bmax');
  const [a, b] = [min.value, max.value];
  min.innerHTML = '<option value="">No min</option>' + opts;
  max.innerHTML = '<option value="">No max</option>' + opts;
  min.value = list.some(([v]) => String(v) === a) ? a : '';
  max.value = list.some(([v]) => String(v) === b) ? b : '';
  document.getElementById('ff-budget-label').textContent = purpose === 'rent' ? 'Monthly rent' : 'Budget';
}

const rangeParam = (a, b) => {
  const lo = parseInt(a, 10) || 0, hi = parseInt(b, 10) || 0;
  if (hi && lo > hi) return `${hi}-${lo}`;
  return hi ? `${lo}-${hi}` : lo ? `${lo}+` : '';
};

/** Reads the filters panel and runs the search */
function applyFilters(e) {
  e?.preventDefault?.();
  const val = id => document.getElementById(id).value.trim();
  const next = {
    ...fromPurposeCategory(radioValue('ff-purpose'), radioValue('ff-cat')),
    q: val('ff-q'), city: val('ff-city'), locality: val('ff-locality'),
    budget: rangeParam(val('ff-bmin'), val('ff-bmax')),
    rate: rangeParam(val('ff-rmin'), val('ff-rmax')),
    area: rangeParam(val('ff-amin'), val('ff-amax')),
    bhk: radioValue('ff-bhk'), furnishing: val('ff-furnish'), possession: val('ff-possession'), age: val('ff-age'),
    amenities: [...document.querySelectorAll('#ff-amenities input:checked')].map(c => c.value).join(','),
    verified: document.getElementById('ff-verified').checked ? '1' : '',
    // the property type from the search box only fits the same listing type
    subtype: listState.filters.subtype && listState.filters.type === fromPurposeCategory(radioValue('ff-purpose'), radioValue('ff-cat')).type ? listState.filters.subtype : '',
    sort: listState.filters.sort, bounds: listState.filters.bounds,
  };
  closeModal('filter-modal');
  runListingQuery(next, headingFor(next));
}

function resetFilterForm() {
  document.getElementById('filter-form').reset();
  setRadio('ff-purpose', ''); setRadio('ff-cat', ''); setRadio('ff-bhk', '');
  fillBudgetOptions('');
}

// ── Map ───────────────────────────────────────────────────────────────────
let leafletReady = null;
/** Loads the map library the first time a map is needed */
function loadLeaflet() {
  leafletReady ||= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/vendor/leaflet/leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = '/vendor/leaflet/leaflet.js';
    s.onload = () => resolve(window.L);
    s.onerror = () => { leafletReady = null; reject(new Error('The map could not load. Please check your connection.')); };
    document.head.appendChild(s);
  });
  return leafletReady;
}

function makeMap(el, center = [18.52, 73.86], zoom = 11) {
  const map = L.map(el, {scrollWheelZoom: false}).setView(center, zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(map);
  return map;
}

/** Short price for a map pin: ₹1.85Cr, ₹68L, ₹45K/mo */
function shortPrice(p) {
  const n = Number(p.price_val) || 0;
  if (!n) return /request/i.test(p.price_label || '') ? 'On request' : String(p.price_label || 'View').split(/[–-]/)[0].trim().slice(0, 12);
  if (isLease(p)) return `₹${n >= 1e5 ? +(n / 1e5).toFixed(1) + 'L' : Math.round(n / 1e3) + 'K'}/mo`;
  return n >= 1e7 ? `₹${+(n / 1e7).toFixed(2)}Cr` : n >= 1e5 ? `₹${Math.round(n / 1e5)}L` : `₹${n.toLocaleString('en-IN')}`;
}
const pinIcon = label => L.divIcon({className: 'map-pin', html: `<span>${esc(label)}</span>`, iconSize: null, iconAnchor: [0, 0]});

let resultsMap = null, resultsLayer = null, userMovedMap = false, keepMapView = false;

function setView(v, sync = true) {
  listView = v;
  document.querySelectorAll('#list-view button').forEach(b => { const on = b.dataset.view === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  document.getElementById('map-panel').hidden = v !== 'map';
  if (sync) syncUrl(listState.filters);
  if (v === 'map') showMapResults();
}

async function showMapResults() {
  const note = document.getElementById('map-note');
  try { await loadLeaflet(); } catch (e) { note.textContent = e.message; return; }
  if (!resultsMap) {
    resultsMap = makeMap('results-map');
    resultsLayer = L.layerGroup().addTo(resultsMap);
    resultsMap.on('dragstart zoomstart', () => { userMovedMap = true; });
    resultsMap.on('moveend', () => { if (userMovedMap) document.getElementById('map-search-area').hidden = false; });
  }
  setTimeout(() => resultsMap.invalidateSize(), 50);
  const qs = new URLSearchParams({limit: '200'});
  Object.entries(listState.filters).forEach(([k, v]) => qs.set(k, v));
  let rows = [];
  try { rows = (await api('/api/properties?' + qs)).data || []; } catch (e) { note.textContent = e.message; return; }
  resultsLayer.clearLayers();
  const pts = rows.filter(p => p.lat && p.lng);
  pts.forEach(p => {
    L.marker([p.lat, p.lng], {icon: pinIcon(shortPrice(p)), title: p.title, keyboard: true, alt: p.title}).addTo(resultsLayer)
      .bindPopup(`<div class="map-pop">${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : ''}<b>${esc(p.title)}</b><span>${esc(p.price_label)} · ${esc(p.locality || p.city)}</span><button type="button" class="btn btn-or btn-sm" data-on-click="openDetail(${Number(p.id)})">View details</button></div>`);
  });
  if (pts.length && !keepMapView) resultsMap.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])).pad(0.25), {maxZoom: 14});
  keepMapView = false;
  userMovedMap = false;
  document.getElementById('map-search-area').hidden = true;
  const missing = rows.length - pts.length;
  note.textContent = rows.length
    ? `${pts.length} of ${rows.length} listing${rows.length === 1 ? '' : 's'} on the map${missing ? ` (${missing} without a location yet)` : ''}. Pins show the approximate locality.`
    : 'No listings to show on the map for this search.';
}

function searchMapArea() {
  const b = resultsMap.getBounds();
  const bounds = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(n => n.toFixed(4)).join(',');
  keepMapView = true;
  runListingQuery({...listState.filters, bounds, featured: ''}, 'Properties in this map area', false);
}

// ── Compare (up to 3 listings) ────────────────────────────────────────────
let compareIds = readJSON('lr_compare', []);
function toggleCompare(id) {
  if (compareIds.includes(id)) compareIds = compareIds.filter(x => x !== id);
  else if (compareIds.length >= 3) { toast('You can compare up to 3 properties. Remove one first.', 'err'); return; }
  else compareIds = [...compareIds, id];
  store('lr_compare', compareIds);
  renderCompareBar();
  document.querySelectorAll(`[data-compare="${id}"]`).forEach(b => {
    const on = compareIds.includes(id);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
    b.querySelector('span').textContent = on ? 'Added to compare' : 'Compare';
  });
}
function clearCompare() {
  compareIds = [];
  store('lr_compare', compareIds);
  renderCompareBar();
  closeModal('compare-modal');
}
function renderCompareBar() {
  const bar = document.getElementById('compare-bar');
  bar.hidden = !compareIds.length;
  document.getElementById('compare-n').textContent = compareIds.length;
}
async function openCompare() {
  const body = document.getElementById('compare-body');
  body.innerHTML = '<div class="op-empty">Loading…</div>';
  openModal('compare-modal');
  try {
    const {data} = await api(`/api/properties?limit=3&ids=${compareIds.join(',')}`);
    const rows = compareIds.map(id => data.find(p => p.id === id)).filter(Boolean);
    if (rows.length !== compareIds.length) { compareIds = rows.map(p => p.id); store('lr_compare', compareIds); renderCompareBar(); }
    if (!rows.length) { body.innerHTML = '<div class="op-empty">These properties are no longer listed.</div>'; return; }
    const line = (label, fn) => `<tr><th scope="row">${label}</th>${rows.map(p => `<td>${fn(p) || '<span class="cmp-na">—</span>'}</td>`).join('')}</tr>`;
    body.innerHTML = `<div class="cmp-wrap"><table class="cmp">
      <thead><tr><th></th>${rows.map(p => `<th scope="col">${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : ''}<a href="#" data-on-click="openDetail(${Number(p.id)});return false">${esc(p.title)}</a><button type="button" class="cmp-x" data-on-click="toggleCompare(${Number(p.id)});openCompare()" aria-label="Remove ${esc(p.title)}">${ico('x')}</button></th>`).join('')}</tr></thead>
      <tbody>
        ${line('Price', p => `<b>${esc(p.price_label)}</b>`)}
        ${line('Rate', p => p.rate_sqft ? `₹${p.rate_sqft.toLocaleString('en-IN')} / sq ft` : '')}
        ${line('Area', p => esc(p.area))}
        ${line('Type', p => esc([TYPE_BADGES[p.type], p.subtype].filter(Boolean).join(' · ')))}
        ${line('Location', p => esc([p.locality, p.city].filter(Boolean).join(', ')))}
        ${line('Bedrooms', p => p.beds ? `${Number(p.beds)} BHK` : '')}
        ${line('Bathrooms', p => p.baths ? String(Number(p.baths)) : '')}
        ${line('Furnishing', p => esc(p.furnishing))}
        ${line('Possession', p => esc(p.possession || p.status))}
        ${line('Property age', p => esc(p.age_band))}
        ${line('Amenities', p => p.amenities_list.map(esc).join(', '))}
        ${line('RERA', p => esc(p.rera))}
        ${line('Verified', p => p.verified_at ? `${ico('check')} By Landroof` : 'Not yet')}
        ${line('Status', p => esc(LISTING_LABEL[p.listing_status] || 'Available'))}
        ${line('Listing ID', p => esc(p.listing_code))}
      </tbody></table></div>`;
  } catch (e) { body.innerHTML = `<div class="load-error">${esc(e.message)}</div>`; }
}

// ── Report a listing ──────────────────────────────────────────────────────
let reportId = null;
async function openReport(id) {
  reportId = id;
  const form = document.getElementById('report-form');
  form.reset();
  clearFieldErrors(form);
  document.getElementById('report-email').value = user?.email || '';
  document.getElementById('report-error').textContent = '';
  const opts = await getListingOptions();
  document.getElementById('report-reason').innerHTML = '<option value="">— Choose —</option>' + opts.report_reasons.map(r => `<option>${esc(r)}</option>`).join('');
  openModal('report-modal');
}
async function submitReport(e) {
  e.preventDefault();
  const reason = document.getElementById('report-reason');
  const details = document.getElementById('report-details');
  clearFieldErrors(e.target);
  if (!reason.value) { setFieldError(reason, 'Please choose what is wrong'); reason.focus(); return; }
  try {
    await withBusy(submitBtn(e), () => api(`/api/properties/${reportId}/report`, {method: 'POST', body: {reason: reason.value, details: details.value, email: document.getElementById('report-email').value}}));
    closeModal('report-modal');
    toast('Thank you — our team will check this listing.', 'ok');
  } catch (err) {
    if (!showServerErrors({reason: 'report-reason', details: 'report-details', email: 'report-email'}, err)) document.getElementById('report-error').textContent = err.message;
  }
}

async function shareListing(id) {
  const title = (currentProjectId === id ? currentProject : allProps.find(x => x.id === id))?.title || 'Landroof';
  const url = `${location.origin}${pageUrl(currentProjectId === id ? 'project' : 'property', id)}`;
  try {
    if (navigator.share) { await navigator.share({title, url}); return; }
    await navigator.clipboard.writeText(url);
    toast('Link copied', 'ok');
  } catch (e) {
    if (e?.name !== 'AbortError') toast(url, 'ok');
  }
}

// ── Project page (plotted projects): gallery, location, amenities, plot availability, approvals ──
const PLOT_STATUS = {available: 'Available', hold: 'On hold', booked: 'Booked', sold: 'Sold'};
const PLOT_SHORT = {available: 'Avail.', hold: 'Hold', booked: 'Booked', sold: 'Sold'};
let currentProject = null, currentProjectId = null, projectPlots = [], plotFilter = '', projectMap = null;

async function openProject(id, data = null) {
  enterPage('project', id);
  await loadProject(id, data);
}

async function loadProject(id, data = null) {
  const view = document.getElementById('project-view');
  const layer = shownPage;
  removePageMaps();
  document.getElementById('pv-head-cta').hidden = false;
  document.getElementById('pv-title').textContent = data?.title || 'Loading…';
  if (!data) document.getElementById('pv-body').innerHTML = '<div class="pv-loading">Loading project…</div>';
  try {
    const p = data || (await api(`/api/properties/${id}`)).data;
    let plots = [];
    try { plots = (await api(`/api/properties/${id}/plots`)).data; } catch { /* inventory optional */ }
    if (shownPage !== layer) return;
    currentProject = p;
    projectPlots = plots;
    plotFilter = '';
    if (!allProps.some(x => x.id === p.id)) allProps.push(p);
    document.title = `${p.title} — Landroof`;
    renderProject();
    view.scrollTop = 0;
    document.getElementById('pv-close').focus({preventScroll: true});
  } catch (e) {
    if (shownPage !== layer) return;
    toast(e.status === 404 ? 'This project is no longer listed.' : e.message, 'err');
    closePage();
  }
}


function plotCounts() {
  const c = {available: 0, hold: 0, booked: 0, sold: 0};
  projectPlots.forEach(p => { c[p.status] = (c[p.status] || 0) + 1; });
  return c;
}

function renderProject() {
  const p = currentProject;
  const imgs = listingPhotos(p);
  const id = Number(p.id);
  document.getElementById('pv-title').textContent = p.title;
  document.getElementById('pv-body').innerHTML = `
    <section class="pv-hero">
      ${imgs.length ? galleryHTML(p, imgs) : ''}
      <div class="pv-hero-txt">
        <span class="section-eyebrow">${esc(p.subtype || 'Plotted project')}</span>
        <h1 class="pv-name">${esc(p.title)}</h1>
        <div class="detail-loc">${ico('pin')} ${esc([p.locality, p.city].filter(Boolean).join(', '))}</div>
        <div class="pv-price">${esc(p.price_label)}</div>
        ${p.emi_label ? `<div class="detail-emi">${esc(p.emi_label)}</div>` : ''}
        <div class="detail-idline">Project ID <b>${esc(p.listing_code)}</b>${p.updated_at ? ` · Updated ${esc(fmtDate(p.updated_at))}` : ''}</div>
        <div class="pv-cta">
          <button type="button" class="btn btn-or" data-on-click="projectEnquire('visit')">${ico('calendar')} Book a site visit</button>
          <button type="button" class="btn btn-ghost" data-on-click="projectEnquire('enquiry')">${ico('send')} Enquire</button>
          ${whatsAppUrl() ? `<button type="button" class="btn btn-ghost" data-on-click="whatsAppProperty(${id})">${ico('whatsapp', 'ico-fill')} WhatsApp</button>` : ''}
          <button type="button" class="btn btn-ghost" data-on-click="shareListing(${id})">${ico('share')} Share</button>
        </div>
      </div>
    </section>
    ${mediaHTML(p)}

    <nav class="pv-tabs" aria-label="Project sections">
      <a href="#pv-about" data-on-click="pvJump('pv-about');return false">Overview</a>
      <a href="#pv-plots" data-on-click="pvJump('pv-plots');return false">Plot availability</a>
      <a href="#pv-location" data-on-click="pvJump('pv-location');return false">Location</a>
      <a href="#pv-approvals" data-on-click="pvJump('pv-approvals');return false">Approvals</a>
      <a href="#pv-enquire" data-on-click="pvJump('pv-enquire');return false">Enquire</a>
    </nav>

    <section class="pv-sec" id="pv-about">
      <h2>About the project</h2>
      ${p.description ? `<div class="detail-desc">${esc(p.description)}</div>` : ''}
      ${p.amenities_list?.length ? `<div class="detail-amen"><h4>${ico('check')} Amenities</h4><div>${p.amenities_list.map(a => `<span>${esc(a)}</span>`).join('')}</div></div>` : ''}
      ${verifyHTML(p, 'the developer')}
      ${listerHTML(p)}
    </section>

    <section class="pv-sec" id="pv-plots">
      <h2>Plot availability</h2>
      <div id="pv-inventory"></div>
    </section>

    <section class="pv-sec" id="pv-location">
      <h2>Location</h2>
      ${p.lat && p.lng ? `<div class="detail-map pv-map" id="pv-map"></div><p class="map-note">Approximate location of the project area.</p>` : ''}
      <a class="btn btn-ghost btn-sm" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.lat && p.lng ? `${p.lat},${p.lng}` : [p.locality, p.city].filter(Boolean).join(', '))}" target="_blank" rel="noopener">${ico('arrow')} Open in Google Maps</a>
    </section>

    <section class="pv-sec" id="pv-approvals">
      <h2>Approvals &amp; documents</h2>
      ${p.approvals?.length ? `<div class="appr-list">${p.approvals.map(a => `<div class="appr">
          <span class="appr-ico">${ico('shield')}</span>
          <div><b>${esc(a.label)}</b><span>${esc(a.reference)}${a.authority ? ' · ' + esc(a.authority) : ''}${a.issued_on ? ' · issued ' + esc(fmtDate(a.issued_on)) : ''}</span>
          <small>Checked by our team against the document on ${esc(fmtDate(a.reviewed_at))}${a.document_url ? ` · <a href="${esc(a.document_url)}" target="_blank" rel="noopener">View document</a>` : ''}</small></div>
        </div>`).join('')}</div>`
        : `<p class="pv-muted">Approval details (NA order, land use, layout approval, MahaRERA) are shown here only after our team has checked them against current documents. Ask us for copies of the documents available today.</p>`}
      ${reraHTML(p)}
      ${docsHTML(p.documents)}
      <p class="pv-disclaimer">${ico('alert')} Details are shown as recorded by our team from the documents available to us on the dates shown. A listing or an uploaded document on this website does not by itself guarantee title, approvals or that the land can legally be built on. Please verify with the issuing authority and take independent legal advice before you pay.</p>
    </section>

    <section class="pv-sec pv-enq" id="pv-enquire">
      <h2>Enquire about ${esc(p.title)}</h2>
      <div class="enq-form" id="enq-box">
        <div class="enq-tabs" role="tablist" aria-label="Contact options">
          <button type="button" role="tab" id="enq-tab-enquiry" class="on" aria-selected="true" data-on-click="setEnquiryMode('enquiry')">${ico('send')} Send an enquiry</button>
          <button type="button" role="tab" id="enq-tab-visit" aria-selected="false" data-on-click="setEnquiryMode('visit')">${ico('calendar')} Book a site visit</button>
        </div>
        <div class="enq-row">
          <div><input class="enq-input" id="enq-name" type="text" aria-label="Your name" placeholder="Your Name" maxlength="80" autocomplete="name" value="${esc(user?.name || '')}"></div>
          <div><input class="enq-input" id="enq-phone" aria-label="Mobile number" type="tel" inputmode="tel" placeholder="Mobile, e.g. 98765 43210" maxlength="20" autocomplete="tel" value="${esc(user?.phone || '')}"></div>
        </div>
        <div style="margin-bottom:8px"><input class="enq-input" id="enq-email" aria-label="Email address" type="email" placeholder="Email Address *" maxlength="254" autocomplete="email" style="width:100%" value="${esc(user?.email || '')}"></div>
        <div class="enq-row enq-visit" hidden>
          <div><label class="emi-label" for="enq-date">Preferred date</label><input class="enq-input" id="enq-date" type="date" min="${new Date(Date.now() + 864e5).toISOString().slice(0, 10)}"></div>
          <div><label class="emi-label" for="enq-slot">Time</label><select class="enq-input" id="enq-slot"><option>Morning (10 am – 12 pm)</option><option>Afternoon (12 – 3 pm)</option><option>Evening (3 – 6 pm)</option></select></div>
        </div>
        <div><textarea class="enq-input" id="enq-message" aria-label="Your message" rows="3" maxlength="900" placeholder="Which plot size or budget are you looking for?" style="width:100%;resize:vertical"></textarea></div>
        <button type="button" class="btn btn-or btn-lg" id="enq-submit" data-on-click="submitProjectEnquiry()">${ico('send')} Send Enquiry</button>
        <p class="form-note">We use your details only to respond to this enquiry. <a href="#" data-on-click="openInfo('privacy');return false">Privacy Policy</a></p>
      </div>
      <p class="detail-report"><button type="button" class="link-btn" data-on-click="openReport(${id})">${ico('flag')} Report this listing</button> if something is wrong or out of date.</p>
    </section>`;
  renderInventory();
  setEnquiryMode('enquiry');
  liveValidate('property-enquiry', FIELDS.enquiry);
  if (p.lat && p.lng) showProjectMap(p);
}

async function showProjectMap(p) {
  try { await loadLeaflet(); } catch { document.getElementById('pv-map')?.remove(); return; }
  const el = document.getElementById('pv-map');
  if (!el) return;
  if (projectMap) projectMap.remove();
  projectMap = makeMap(el, [p.lat, p.lng], 13);
  L.circle([p.lat, p.lng], {radius: 700, color: '#c2410c', fillOpacity: 0.12, weight: 2}).addTo(projectMap);
  setTimeout(() => projectMap?.invalidateSize(), 120);
}

function pvJump(id) { document.getElementById(id)?.scrollIntoView({behavior: 'smooth', block: 'start'}); }

/** Layout map (schematic: plots in plot-number order, grouped by block) + inventory table */
function renderInventory() {
  const box = document.getElementById('pv-inventory');
  if (!box) return;
  if (!projectPlots.length) {
    box.innerHTML = `<p class="pv-muted">${ico('alert')} Live plot availability for this project will be published here soon. <a href="#" data-on-click="projectEnquire('enquiry');return false">Ask our team</a> for the plots available today.</p>`;
    return;
  }
  const c = plotCounts();
  const shown = projectPlots.filter(pl => !plotFilter || pl.status === plotFilter);
  const blocks = {};
  projectPlots.forEach(pl => { (blocks[pl.block || ''] ||= []).push(pl); });
  const money = n => n ? fmtMoney(n) : '—';
  const last = projectPlots.reduce((a, pl) => (pl.updated_at > a ? pl.updated_at : a), '');
  box.innerHTML = `
    <div class="pl-legend" role="group" aria-label="Show plots by status">
      <button type="button" class="pl-leg ${plotFilter ? '' : 'on'}" aria-pressed="${!plotFilter}" data-on-click="setPlotFilter('')">All <b>${projectPlots.length}</b></button>
      ${Object.keys(PLOT_STATUS).map(s => `<button type="button" class="pl-leg pl-${s} ${plotFilter === s ? 'on' : ''}" aria-pressed="${plotFilter === s}" data-on-click="setPlotFilter('${s}')"><i aria-hidden="true"></i>${PLOT_STATUS[s]} <b>${c[s] || 0}</b></button>`).join('')}
    </div>
    <div class="pl-map" aria-label="Plot layout (schematic)">
      ${Object.entries(blocks).map(([block, list]) => `<div class="pl-block">
        ${block ? `<div class="pl-block-name">Block ${esc(block)}</div>` : ''}
        <div class="pl-grid">${list.map(pl => `<button type="button" class="pl-cell pl-${esc(pl.status)} ${plotFilter && pl.status !== plotFilter ? 'dim' : ''}" data-on-click="showPlot(${Number(pl.id)})" aria-label="Plot ${esc(pl.plot_no)}${pl.area_sqft ? ', ' + pl.area_sqft.toLocaleString('en-IN') + ' sq ft' : ''}, ${PLOT_STATUS[pl.status]}"><b>${esc(pl.plot_no)}</b><span>${PLOT_SHORT[pl.status]}</span></button>`).join('')}</div>
      </div>`).join('')}
    </div>
    <p class="map-note">Schematic layout in plot-number order — not to scale. Status updated by our team${last ? ' · last change ' + esc(fmtDate(last)) : ''}.</p>
    <div class="pl-detail" id="pl-detail" hidden></div>
    <div class="pl-table-wrap"><table class="pl-table">
      <thead><tr><th scope="col">Plot</th><th scope="col">Area</th><th scope="col">Rate</th><th scope="col">Total price</th><th scope="col">Facing</th><th scope="col">Frontage</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead>
      <tbody>${shown.map(pl => `<tr>
        <td><b>${esc(pl.plot_no)}</b>${pl.block ? ` <small>Block ${esc(pl.block)}</small>` : ''}</td>
        <td>${pl.area_sqft ? pl.area_sqft.toLocaleString('en-IN') + ' sq ft' : '—'}</td>
        <td>${pl.rate_sqft ? '₹' + pl.rate_sqft.toLocaleString('en-IN') + ' / sq ft' : '—'}</td>
        <td>${money(pl.total_price)}</td>
        <td>${esc(pl.facing || '—')}</td>
        <td>${esc(pl.frontage || '—')}</td>
        <td><span class="pl-pill pl-${esc(pl.status)}">${PLOT_STATUS[pl.status]}</span></td>
        <td>${pl.status === 'available' || pl.status === 'hold' ? `<button type="button" class="btn btn-ghost btn-sm" data-on-click="enquirePlot(${Number(pl.id)})">Enquire</button>` : ''}</td>
      </tr>`).join('') || `<tr><td colspan="8" class="pv-muted">No plots with this status.</td></tr>`}</tbody>
    </table></div>`;
}

function setPlotFilter(s) { plotFilter = s; renderInventory(); }

function showPlot(id) {
  const pl = projectPlots.find(x => x.id === id);
  const box = document.getElementById('pl-detail');
  if (!pl || !box) return;
  box.hidden = false;
  box.innerHTML = `<div><b>Plot ${esc(pl.plot_no)}</b>${pl.block ? ` · Block ${esc(pl.block)}` : ''} <span class="pl-pill pl-${esc(pl.status)}">${PLOT_STATUS[pl.status]}</span></div>
    <div class="pl-facts">${[
      pl.area_sqft && `Area <b>${pl.area_sqft.toLocaleString('en-IN')} sq ft</b>`,
      pl.rate_sqft && `Rate <b>₹${pl.rate_sqft.toLocaleString('en-IN')} / sq ft</b>`,
      pl.total_price && `Total <b>${fmtMoney(pl.total_price)}</b>`,
      pl.facing && `Facing <b>${esc(pl.facing)}</b>`,
      pl.frontage && `Frontage <b>${esc(pl.frontage)}</b>`,
    ].filter(Boolean).map(x => `<span>${x}</span>`).join('')}</div>
    ${pl.status === 'available' || pl.status === 'hold' ? `<button type="button" class="btn btn-or btn-sm" data-on-click="enquirePlot(${Number(pl.id)})">Enquire about plot ${esc(pl.plot_no)}</button>` : `<small>This plot is ${PLOT_STATUS[pl.status].toLowerCase()}.</small>`}`;
  box.scrollIntoView({behavior: 'smooth', block: 'nearest'});
}

function enquirePlot(id) {
  const pl = projectPlots.find(x => x.id === id);
  projectEnquire('visit');
  const msg = document.getElementById('enq-message');
  if (msg && pl) msg.value = `I'm interested in plot ${pl.plot_no}${pl.block ? ' (block ' + pl.block + ')' : ''}${pl.area_sqft ? ', ' + pl.area_sqft + ' sq ft' : ''}.`;
}

function projectEnquire(mode) {
  setEnquiryMode(mode);
  pvJump('pv-enquire');
  setTimeout(() => document.getElementById('enq-name')?.focus({preventScroll: true}), 400);
}

function submitProjectEnquiry() {
  currentPropId = currentProjectId;
  submitEnquiry();
}

// ── Functions callable from data-on-* attributes (see /js/actions.js) ─────
LRActions.register({
  accountClick, calcEMI, closeAccountMenu, closeMenu, closeModal, doSearch, filterByCity, openCity, signInFromSaved, showGalleryImage,
  handleAuth, handleChangePassword, handleContact, handleInvestEnquiry, handleListProperty,
  loadAllProperties, openAuth, openChangePassword, openContact, openDetail, openInfo, openModal,
  openSaved, openWhatsApp, quickEnquire, whatsAppProperty, resetConsent, scrollToSection, searchByType, setConsent,
  setSearchType, signOut, signOutEverywhere, smoothScroll, submitEnquiry, switchAuthTab, toggleMenu,
  toggleWishlist, handleResetPassword,
  openListProperty, openOwnerPanel, openOwnerForm, closeOwnerForm, fillOwnerSubtypes, saveOwnerProperty, deleteOwnerProperty, handleOwnerSetup,
  loadMore, tryNearby, saveSearchAlert, removeFilter, clearAllFilters, setSort, openFilters, applyFilters, resetFilterForm, fillBudgetOptions,
  setView, searchMapArea, toggleCompare, clearCompare, openCompare, openReport, submitReport, shareListing, setEnquiryMode,
  openProject, closePage, pvJump, setPlotFilter, showPlot, enquirePlot, projectEnquire, submitProjectEnquiry,
  setOwnerStatus, openOwnerHistory, toggleOwnerPhoto, clearOwnerPin, saveOwnerDraft,
});
