/* Landroof admin panel — client-side controller for src/views/admin.html */
'use strict';

// ── State ──────────────────────────────────────────────────────────────────
// The JWT access token lives only in memory. The refresh token is an httpOnly cookie
// that this script can't read; it is used to get a new access token when needed.
let TOKEN = '';
let ADMIN_NAME = '';
let allProps = [], allLeads = [];
let editId = null;
let propFilter = 'all', propSearch = '', propOwner = null;
let allRequests = [], reqFilter = 'pending';
const cache = {};              // latest rows per content type, used when editing
let gEdit = {type: null, id: null};

// ── Auth (JWT) ─────────────────────────────────────────────────────────────
function acceptTokens(j) {
  TOKEN = j.accessToken;
  ADMIN_NAME = j.user?.username || '';
}

let refreshing = null;
/** Gets a new access token from the refresh cookie. Resolves true/false. Parallel calls share one request. */
function refreshSession() {
  refreshing ||= fetch('/api/admin/auth/refresh', {method: 'POST'})
    .then(async r => { if (!r.ok) return false; acceptTokens(await r.json()); return true; })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

/** fetch() with the access token; on an expired token it refreshes once and retries. */
async function authFetch(path, opts = {}) {
  const send = () => fetch(path, {...opts, headers: {...opts.headers, Authorization: 'Bearer ' + TOKEN}});
  let r = await send();
  if (r.status === 401 && await refreshSession()) r = await send();
  if (r.status === 401) { showLogin('Your session has ended. Please sign in again.'); throw new Error('Please sign in again'); }
  return r;
}

// ── API helper ─────────────────────────────────────────────────────────────
/** Calls the admin API. Throws an Error with the server message. */
async function api(method, path, body) {
  const opts = {method, headers: {}};
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  let r;
  try { r = await authFetch(path, opts); }
  catch (e) { throw new Error(e.message === 'Failed to fetch' ? 'Network error — is the server running?' : e.message); }
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), {fields: j.fields});
  return j;
}

// ── Login ──────────────────────────────────────────────────────────────────
const loginOverlay = document.getElementById('login-overlay');

function showLogin(message) {
  TOKEN = '';
  loginOverlay.style.display = '';
  const err = document.getElementById('login-err');
  err.textContent = message || '';
  err.style.display = message ? 'block' : 'none';
}

document.getElementById('login-form').onsubmit = async e => {
  e.preventDefault();
  const err = document.getElementById('login-err');
  err.style.display = 'none';
  const username = document.getElementById('lu').value.trim();
  const password = document.getElementById('lp').value;
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const r = await fetch('/api/admin/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username, password, otp: document.getElementById('lotp').value.trim()})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j.code === 'otp_required' || j.code === 'invalid_otp') { const o = document.getElementById('lotp'); o.hidden = false; o.value = ''; o.focus(); }
      throw new Error(j.error || 'Invalid credentials. Try again.');
    }
    acceptTokens(j);
    document.getElementById('lp').value = '';
    loginOverlay.style.display = 'none';
    init();
  } catch (ex) {
    err.textContent = ex.message === 'Failed to fetch' ? 'Network error — is the server running?' : ex.message;
    err.style.display = 'block';
  } finally { btn.disabled = false; }
};

document.getElementById('logout-btn').onclick = async () => {
  try { await fetch('/api/admin/auth/logout', {method: 'POST'}); } catch {}
  TOKEN = '';
  location.reload();
};

// ── Navigation ─────────────────────────────────────────────────────────────
const pages = {
  dashboard:'Dashboard', properties:'Properties', cities:'Cities', requests:'Listing Requests', reports:'Reported Listings', owners:'Owners', leads:'Leads', users:'Registered Users',
  testimonials:'Testimonials', team:'Team / Leadership', events:'Events',
  announcements:'Announcements', schemes:'Schemes & Offers', social:'Social Posts',
  media:'Media Gallery', siteconfig:'Site Numbers', email:'Email Settings', audit:'Activity Log', password:'Change Password'
};
const loaders = {
  dashboard: () => loadDashboard(), properties: () => loadProps(), cities: () => loadContent('city'),
  requests: () => loadRequests(), reports: () => loadReports(), owners: () => loadOwners(), leads: () => loadLeads(), users: () => loadUsers(),
  testimonials: () => loadContent('testimonial'), team: () => loadContent('team'), events: () => loadContent('event'),
  announcements: () => loadContent('announcement'), schemes: () => loadContent('scheme'),
  social: () => loadContent('social'), media: () => loadContent('media'), siteconfig: () => loadSiteConfig(),
  audit: () => loadAudit(), password: async () => resetPasswordForm(), email: () => loadMailSettings(),
};
document.querySelectorAll('.sb-item[data-page]').forEach(el => {
  el.onclick = () => navTo(el.dataset.page);
  el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navTo(el.dataset.page); } };
});
document.getElementById('go-leads').onclick = () => navTo('leads');

// ── Sidebar as a slide-out menu on small screens ──
function setSidebar(open) {
  document.body.classList.toggle('sb-open', open);
  const btn = document.getElementById('sb-toggle');
  btn.setAttribute('aria-expanded', open);
  btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}
document.getElementById('sb-toggle').onclick = () => setSidebar(!document.body.classList.contains('sb-open'));
document.getElementById('sb-backdrop').onclick = () => setSidebar(false);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || dialogClose) return; // dialogs handle their own Escape
  if (document.getElementById('generic-drawer').classList.contains('open')) closeGenericDrawer();
  else if (document.getElementById('prop-drawer').classList.contains('open')) closeDrawer();
  else if (document.getElementById('manage-drawer').classList.contains('open')) closeManage();
  else setSidebar(false);
});
window.addEventListener('resize', () => { if (window.innerWidth > 900) setSidebar(false); }, { passive: true });

let currentPage = '';

/** Shows an admin page. Adds a browser-history step unless { push: false } (Back/Forward, first load). */
function navTo(pg, { push = true } = {}) {
  if (!pages[pg]) pg = 'dashboard';
  currentPage = pg;
  setSidebar(false);
  document.querySelectorAll('.sb-item').forEach(e => e.classList.toggle('on', e.dataset.page === pg));
  document.querySelectorAll('.page').forEach(e => e.classList.toggle('on', e.id === `page-${pg}`));
  document.getElementById('page-title').textContent = pages[pg];
  if (location.hash !== '#' + pg) history[push ? 'pushState' : 'replaceState']({page: pg}, '', '#' + pg);
  loaders[pg]().catch(e => toast(e.message, 'err'));
}

function init() {
  document.getElementById('admin-user-label').textContent = ADMIN_NAME;
  refreshBadges();
  navTo(location.hash.slice(1) || 'dashboard', {push: false});
}

// Back / Forward: close whatever is open on top first, otherwise show the page from the address bar
window.addEventListener('popstate', () => {
  if (closeTopLayer()) return;
  const pg = location.hash.slice(1) || 'dashboard';
  if (pg !== currentPage) navTo(pg, {push: false});
});

/** Drawers and dialogs add a history step too, so Back closes them instead of leaving the page */
function pushLayer() { history.pushState({page: currentPage, layer: true}, '', location.hash); }
function popLayer() { if (history.state?.layer) history.back(); }

/** Closes the top-most open dialog or drawer. Returns true if something was closed. */
function closeTopLayer() {
  if (dialogClose) { dialogClose(false, true); return true; }
  if (document.getElementById('generic-drawer').classList.contains('open')) { closeGenericDrawer(true); return true; }
  if (document.getElementById('prop-drawer').classList.contains('open')) { closeDrawer(true); return true; }
  if (document.getElementById('manage-drawer').classList.contains('open')) { closeManage(true); return true; }
  if (document.body.classList.contains('sb-open')) { setSidebar(false); return true; }
  return false;
}

// ── Dashboard ──────────────────────────────────────────────────────────────
async function loadDashboard() {
  const {data: s} = await api('GET', '/api/admin/stats');
  document.getElementById('s-props').textContent = s.total_properties;
  document.getElementById('s-leads').textContent = s.total_leads;
  document.getElementById('s-today').textContent = s.leads_today;
  document.getElementById('s-users').textContent = s.total_users;

  const hour = new Date().getHours();
  document.getElementById('dash-greeting').textContent =
    `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}${ADMIN_NAME ? ', ' + ADMIN_NAME : ''}`;
  document.getElementById('dash-date').textContent = new Date().toLocaleDateString('en-IN', {weekday:'long', day:'numeric', month:'long', year:'numeric'})
    + (s.leads_today ? ` · ${s.leads_today} new lead${s.leads_today === 1 ? '' : 's'} today` : ' · No new leads yet today');

  document.getElementById('recent-leads-body').innerHTML = s.latest_leads.length ? s.latest_leads.map(l => `
    <tr>
      <td>${leadContact(l, true)}</td>
      <td>${srcPill(l.source)}</td>
      <td class="lead-looking">${leadLooking(l)}</td>
      <td class="lead-time">${leadWhen(l)}</td>
    </tr>`).join('') : '<tr><td colspan="4"><div class="empty"><div class="empty-icon">📋</div><p>No leads yet. They appear when visitors search or enquire.</p></div></td></tr>';

  const totalBySource = s.leads_by_source.reduce((t, x) => t + Number(x.n), 0) || 1;
  document.getElementById('source-chart').innerHTML = s.leads_by_source.length ? s.leads_by_source.map(x => {
    const pct = Math.round(Number(x.n) / totalBySource * 100);
    return `<button type="button" class="src-tile src-${esc(SOURCES[x.source] ? x.source : 'other')}" data-source="${esc(x.source)}">
      <div class="src-top"><span class="src-n">${Number(x.n)}</span><span class="src-pct">${pct}%</span></div>
      <div class="src-name">${esc(sourceLabel(x.source))}</div>
      <div class="src-bar"><span style="width:${pct}%"></span></div>
    </button>`;
  }).join('') : '<p style="color:#aaa;padding:4px">No leads yet.</p>';
}

// Stat cards and source tiles open the matching page
function openLeads(source = '') {
  navTo('leads');
  const sel = document.getElementById('lead-source');
  if (!source) { sel.value = ''; return; }
  // the Leads page fills its source list after loading; pick the source once it's there
  const pick = () => { if ([...sel.options].some(o => o.value === source)) { sel.value = source; renderLeads(); return true; } };
  if (!pick()) { const t = setInterval(() => { if (pick()) clearInterval(t); }, 100); setTimeout(() => clearInterval(t), 5000); }
}
document.querySelectorAll('.stat-card[data-go]').forEach(el => {
  const go = () => (el.dataset.go === 'leads' ? openLeads() : navTo(el.dataset.go));
  el.onclick = go;
  el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
});
document.getElementById('source-chart').addEventListener('click', e => {
  const tile = e.target.closest('.src-tile[data-source]');
  if (tile) openLeads(tile.dataset.source);
});

// ── Row action buttons (same look in every section) ───────────────────────
const ICON_EDIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
const editBtn = code => `<button type="button" class="act-btn act-edit" data-on-click="${code}">${ICON_EDIT}<span>Edit</span></button>`;
const ICON_OK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_NO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const ICON_MAIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>';
const delBtn = (code, title = 'Delete') => `<button type="button" class="act-btn act-del" data-on-click="${code}" title="${title}">${ICON_DEL}<span>Delete</span></button>`;

// On phones tables are shown as cards: give every cell its column heading as a label
function labelCells(tbody) {
  const heads = [...(tbody.closest('table')?.querySelectorAll('thead th') || [])].map(th => th.textContent.trim());
  tbody.querySelectorAll('tr').forEach(tr => {
    [...tr.children].forEach((td, i) => {
      if (td.colSpan > 1) return td.classList.add('cell-full');
      td.dataset.label = heads[i] || '';
      // One wrapper per cell, so multi-line content stays together next to its label
      if (!td.firstElementChild?.classList.contains('cell-v')) {
        const wrap = document.createElement('div');
        wrap.className = 'cell-v';
        wrap.append(...td.childNodes);
        td.append(wrap);
      }
      if (td.querySelector('.row-actions')) td.classList.add('cell-actions');
    });
  });
}
document.querySelectorAll('.card tbody').forEach(tb => {
  labelCells(tb);
  new MutationObserver(() => labelCells(tb)).observe(tb, { childList: true });
});

// ── Properties ─────────────────────────────────────────────────────────────
const SUBTYPES = {
  buy: ['Apartment','Villa / Bungalow','Independent House','Builder Floor','Studio'],
  rent: ['Apartment','Villa / Bungalow','PG / Hostel','Studio / 1-RK','Independent House'],
  plots: ['Residential Plot','NA-Approved Plot','Agricultural Land','Farmhouse Plot','Commercial Plot'],
  commercial: ['Office Space','Retail Shop','Showroom','Warehouse / Godown','Co-working Space','Industrial Shed'],
};
function fillSubtypes(type, selected = '') {
  const sel = document.getElementById('f-subtype');
  const list = SUBTYPES[type] || [];
  sel.innerHTML = '<option value="">— Not specified —</option>' + list.map(s => `<option>${esc(s)}</option>`).join('')
    + (selected && !list.includes(selected) ? `<option>${esc(selected)}</option>` : '');
  sel.value = selected;
}
document.getElementById('f-type').onchange = e => fillSubtypes(e.target.value);

async function loadProps() {
  const {data} = await api('GET', '/api/admin/properties');
  allProps = data;
  renderProps();
}

/** Fills the property form's city list from the Cities page (fresh each time the form opens) */
async function loadCityOptions() {
  const sel = document.getElementById('f-city');
  try {
    const {data} = await api('GET', '/api/admin/cities');
    if (!data.length) return; // no cities set up yet: keep the built-in list
    sel.innerHTML = data.map(c => `<option value="${esc(c.name)}">${esc(c.name)}${c.is_active ? '' : ' (hidden on website)'}</option>`).join('');
  } catch {}
}

const REVIEW_LABEL = {draft: 'Draft', pending: 'Pending review', under_review: 'Under review', changes: 'Corrections asked', rejected: 'Not approved'};
const LISTING_LABEL = {sold: 'Sold', rented: 'Rented', expired: 'Expired', withdrawn: 'Withdrawn'};
const isPendingReview = p => p.review_status === 'pending' || p.review_status === 'under_review';

function statusCell(p) {
  const pills = [];
  if (REVIEW_LABEL[p.review_status]) pills.push(`<span class="review-pill review-${esc(p.review_status)}">${REVIEW_LABEL[p.review_status]}</span>`);
  else if (LISTING_LABEL[p.listing_status]) pills.push(`<span class="review-pill review-rejected">${LISTING_LABEL[p.listing_status]}</span>`);
  else pills.push('<span class="review-pill review-approved">Live</span>');
  if (p.verified_at) pills.push('<span class="review-pill review-verified">✓ Verified</span>');
  if (p.is_featured) pills.push('<span class="badge badge-featured">Featured</span>');
  if (p.is_project) pills.push('<span class="review-pill">Project</span>');
  if (p.duplicate_of) pills.push('<span class="review-pill review-pending" title="Looks like another listing — check in Manage">Possible duplicate</span>');
  if (p.open_reports) pills.push(`<span class="review-pill review-rejected">${Number(p.open_reports)} report${p.open_reports === 1 ? '' : 's'}</span>`);
  return `<div class="status-pills">${pills.join('')}</div>`;
}

function renderProps() {
  const f = propFilter, q = propSearch.toLowerCase();
  const rows = allProps.filter(p =>
    (f === 'all' || (f === 'pending' ? isPendingReview(p) : f === 'offline' ? p.listing_status !== 'active' : p.type === f)) &&
    (!propOwner || p.owner_id === propOwner.id) &&
    (!q || [p.title, p.city, p.locality, p.listing_code, p.owner?.name, p.owner?.email].some(v => (v || '').toLowerCase().includes(q)))
  );
  const pending = allProps.filter(isPendingReview).length;
  document.getElementById('pending-props-count').textContent = pending ? ` ${pending}` : '';
  const chip = document.getElementById('owner-chip');
  chip.hidden = !propOwner;
  if (propOwner) chip.innerHTML = `Showing listings by <b>${esc(propOwner.name || propOwner.email)}</b> <button type="button" class="act-btn" data-on-click="clearOwnerFilter()">Show all</button>`;
  document.getElementById('props-tbody').innerHTML = rows.length ? rows.map(p => `
    <tr>
      <td>${p.image_url ? `<img class="prop-img" src="${esc(p.image_url)}" alt="" loading="lazy">` : '<div class="prop-img-ph">🏠</div>'}</td>
      <td><strong>${esc(p.title)}</strong> <span class="code-chip">${esc(p.listing_code)}</span><br><span style="font-size:12px;color:#888">${esc([p.subtype, p.locality].filter(Boolean).join(' · '))}</span>${p.owner ? `<br><span class="by-owner">by ${esc(p.owner.name)} · ${esc(p.owner.email)}</span>` : ''}</td>
      <td><span class="badge badge-${esc(p.type)}">${esc(p.type)}</span></td>
      <td>${esc(p.price_label)}</td>
      <td>${esc(p.city)}</td>
      <td>${statusCell(p)}</td>
      <td>
        <div class="row-actions">${isPendingReview(p) ? `<button type="button" class="act-btn act-ok" data-on-click="reviewProp(${Number(p.id)},'approved')">${ICON_OK}<span>Approve</span></button>` : ''}<button type="button" class="act-btn act-manage" data-on-click="openManage(${Number(p.id)})">${ICON_MANAGE}<span>Manage</span></button>${editBtn(`openEdit(${Number(p.id)})`)}${delBtn(`deleteProp(${Number(p.id)})`)}</div>
      </td>
    </tr>`).join('') :
    '<tr><td colspan="7"><div class="empty"><div class="empty-icon">🔍</div><p>No properties found</p></div></td></tr>';
}

document.querySelectorAll('#prop-filters .filter-btn').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('#prop-filters .filter-btn').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    propFilter = b.dataset.type;
    renderProps();
  };
});
document.getElementById('prop-search').oninput = e => { propSearch = e.target.value; renderProps(); };

document.getElementById('add-prop-btn').onclick = () => openAdd();
document.getElementById('drawer-close').onclick = () => closeDrawer();
document.getElementById('drawer-cancel').onclick = () => closeDrawer();
document.getElementById('drawer-overlay').onclick = () => { closeDrawer(); closeGenericDrawer(); closeManage(); };

function ensureOption(selectId, value) {
  const sel = document.getElementById(selectId);
  if (value && ![...sel.options].some(o => o.value === value)) sel.add(new Option(value, value));
  sel.value = value;
}

async function openAdd() {
  await Promise.all([loadCityOptions(), fillAmenityChips([])]);
  editId = null;
  document.getElementById('drawer-title').textContent = 'Add Property';
  document.getElementById('prop-form').reset();
  fillSubtypes('buy');
  document.getElementById('img-preview').style.display = 'none';
  document.getElementById('current-img-note').style.display = 'none';
  showCurrentMedia(null);
  openPanel('prop-drawer');
}

async function openEdit(id) {
  const p = allProps.find(x => x.id === id);
  if (!p) return;
  await Promise.all([loadCityOptions(), fillAmenityChips(p.amenities_list || [])]); // a listing's own city is kept even if it isn't on the Cities page
  editId = id;
  document.getElementById('drawer-title').textContent = 'Edit Property';
  document.getElementById('prop-form').reset();
  document.getElementById('edit-id').value = id;
  document.getElementById('f-title').value       = p.title || '';
  document.getElementById('f-type').value        = p.type || 'buy';
  fillSubtypes(p.type || 'buy', p.subtype || '');
  ensureOption('f-status', p.status || 'Ready to Move');
  document.getElementById('f-price-label').value = p.price_label || '';
  document.getElementById('f-price-val').value   = p.price_val ?? 0;
  ensureOption('f-city', p.city || 'Pune');
  document.getElementById('f-locality').value    = p.locality || '';
  document.getElementById('f-area').value        = p.area || '';
  document.getElementById('f-emi').value         = p.emi_label || '';
  document.getElementById('f-beds').value        = p.beds ?? 0;
  document.getElementById('f-baths').value       = p.baths ?? 0;
  document.getElementById('f-rera').value        = p.rera || '';
  document.getElementById('f-desc').value        = p.description || '';
  document.getElementById('f-featured').checked  = !!p.is_featured;
  document.getElementById('f-furnishing').value  = p.furnishing || '';
  document.getElementById('f-possession').value  = p.possession || '';
  document.getElementById('f-age').value         = p.age_band || '';
  document.getElementById('f-listed-by').value   = p.listed_by || 'landroof';
  document.getElementById('f-developer').value   = p.developer_name || '';
  document.getElementById('f-video').value       = p.video_url || '';
  document.getElementById('f-tour').value        = p.tour_url || '';
  document.getElementById('f-location').value    = p.lat && p.lng ? `${p.lat}, ${p.lng}` : '';
  document.getElementById('f-project').checked   = !!p.is_project;
  document.getElementById('f-rera-verified').checked = !!p.rera_verified;
  const note = document.getElementById('current-img-note');
  const prev = document.getElementById('img-preview');
  if (p.image_url) {
    prev.src = p.image_url; prev.style.display = 'block';
    note.textContent = 'Current photo shown. Upload a new one to replace it.';
    note.style.display = 'block';
  } else { prev.style.display = 'none'; note.style.display = 'none'; }
  showCurrentMedia(p);
  openPanel('prop-drawer');
}

function openPanel(id) {
  document.getElementById('drawer-overlay').classList.add('on');
  document.getElementById(id).classList.add('open');
  pushLayer();
}
function closeDrawer(fromBack = false) {
  if (!document.getElementById('prop-drawer').classList.contains('open')) return;
  if (!document.getElementById('manage-drawer').classList.contains('open')) document.getElementById('drawer-overlay').classList.remove('on');
  document.getElementById('prop-drawer').classList.remove('open');
  if (!fromBack) popLayer();
}

document.getElementById('drawer-save').onclick = async () => {
  const form = document.getElementById('prop-form');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const fd = new FormData(form);
  fd.set('is_featured', document.getElementById('f-featured').checked ? '1' : '0');
  fd.set('is_project', document.getElementById('f-project').checked ? '1' : '0');
  fd.set('rera_verified', document.getElementById('f-rera-verified').checked ? '1' : '0');
  fd.set('amenities', [...document.querySelectorAll('#f-amenities input:checked')].map(c => c.value).join(', '));
  const loc = parseLocation(document.getElementById('f-location').value);
  if (!loc) { toast('Map location: enter "latitude, longitude" or paste a Google Maps link', 'err'); document.getElementById('f-location').focus(); return; }
  fd.set('lat', loc[0]);
  fd.set('lng', loc[1]);
  if (!document.getElementById('img-input').files.length) fd.delete('image');
  if (!document.getElementById('f-gallery').files.length) fd.delete('gallery');
  if (!document.getElementById('f-floor').files.length) fd.delete('floor_plan');
  if (galleryRemove.size) fd.set('remove_gallery', JSON.stringify([...galleryRemove]));
  if (document.getElementById('f-floor-remove')?.checked) fd.set('remove_floor_plan', '1');

  const btn = document.getElementById('drawer-save');
  btn.textContent = 'Saving…'; btn.disabled = true;
  try {
    await api(editId ? 'PUT' : 'POST', editId ? `/api/admin/properties/${editId}` : '/api/admin/properties', fd);
    toast(editId ? 'Property updated!' : 'Property added!', 'ok');
    closeDrawer();
    if (document.getElementById('manage-drawer').classList.contains('open')) reloadManage(); else loadProps();
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.textContent = 'Save Property'; btn.disabled = false; }
};

async function deleteProp(id) {
  const p = allProps.find(x => x.id === id);
  if (!await confirmBox({title: 'Delete this property?', message: `"${p?.title || 'This property'}" will be removed from the website. This cannot be undone.`, confirmText: 'Delete', tone: 'danger'})) return;
  try { await api('DELETE', `/api/admin/properties/${id}`); toast('Property deleted', 'ok'); loadProps(); }
  catch (e) { toast(e.message, 'err'); }
}

// ── Image preview + drag & drop ────────────────────────────────────────────
function previewImg(input, imgId = 'img-preview') {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => { const img = document.getElementById(imgId); img.src = e.target.result; img.style.display = 'block'; };
  reader.readAsDataURL(file);
}
function setupDrop(dropEl, inputEl, imgId) {
  dropEl.ondragover = e => { e.preventDefault(); dropEl.classList.add('over'); };
  dropEl.ondragleave = () => dropEl.classList.remove('over');
  dropEl.ondrop = e => {
    e.preventDefault(); dropEl.classList.remove('over');
    const fi = e.dataTransfer.files[0];
    if (fi && fi.type.startsWith('image/')) {
      const dt = new DataTransfer(); dt.items.add(fi);
      inputEl.files = dt.files;
      previewImg(inputEl, imgId);
    }
  };
}
setupDrop(document.getElementById('img-drop'), document.getElementById('img-input'), 'img-preview');

// ── Leads ──────────────────────────────────────────────────────────────────
const DEVICE_ICONS = {android:'🤖', ios:'🍎', mobile:'📱', tablet:'📟', desktop:'💻', unknown:'🌐'};

async function loadLeads() {
  const {data} = await api('GET', '/api/admin/leads?limit=500');
  allLeads = data;
  fillSourceFilter();
  renderLeads();
}

// ── Lead formatting helpers ──
const SOURCES = {
  search: 'Search', 'property-enquiry': 'Property Enquiry', 'list-property': 'List Property',
  'investment-enquiry': 'Investment', contact: 'Contact', register: 'Sign Up', newsletter: 'Newsletter',
  'site-visit': 'Site Visit', 'search-alert': 'Search Alert',
};
const sourceLabel = src => SOURCES[src] || String(src || 'Other').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const srcPill = src => `<span class="src-pill src-${esc(SOURCES[src] ? src : 'other')}">${esc(sourceLabel(src))}</span>`;

const LOOKING = {buy: 'Buy', rent: 'Rent', plots: 'Plots', commercial: 'Commercial', invest: 'Invest', sell: 'Sell', management: 'Management', prelaunch: 'Pre-launch'};

// 2500000 → ₹25 L, 15000000 → ₹1.5 Cr
function rupees(n) {
  n = Number(n);
  if (n >= 1e7) return `₹${+(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${+(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `₹${+(n / 1e3).toFixed(1)}K`;
  return `₹${n}`;
}
// Budget values from the search form ("2500000-5000000", "50000000+") → readable text
function fmtBudget(b) {
  const s = String(b || '').trim();
  let m = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (m) return Number(m[1]) === 0 ? `Up to ${rupees(m[2])}` : `${rupees(m[1])} – ${rupees(m[2])}`;
  if ((m = s.match(/^(\d+)\+$/))) return `${rupees(m[1])}+`;
  return s;
}
// +918421610766 → +91 84216 10766
function fmtPhone(p) {
  const m = String(p || '').match(/^\+91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : String(p || '');
}

function leadContact(l, withPhone = false) {
  const initial = (l.name || l.email || '').trim().charAt(0).toUpperCase() || '#';
  const showPhone = l.phone && withPhone; // the Leads page has its own Phone column
  return l.email || l.name || l.phone
    ? `<div class="lead-who"><span class="lead-av">${esc(initial)}</span><div class="lead-id">
        ${l.name ? `<div class="lead-name">${esc(l.name)}</div>` : (!l.email ? '<div class="lead-name">Website visitor</div>' : '')}
        ${l.email ? `<a class="lead-email" href="mailto:${esc(l.email)}">${esc(l.email).replace('@', '<wbr>@')}</a>` : ''}
        ${showPhone ? `<a class="lead-email" href="tel:${esc(l.phone)}">${esc(fmtPhone(l.phone))}</a>` : ''}</div></div>`
    : '<div class="lead-who"><span class="lead-av anon">?</span><span class="lead-anon">Anonymous visitor</span></div>';
}

function leadLooking(l) {
  const type = LOOKING[l.search_type] || l.search_type;
  const chips = [
    l.search_city && `<span class="chip chip-city">${esc(l.search_city)}</span>`,
    type && `<span class="chip">${esc(type)}</span>`,
    l.search_budget && `<span class="chip">${esc(fmtBudget(l.search_budget))}</span>`,
    l.search_bhk && `<span class="chip">${esc(/bhk/i.test(l.search_bhk) ? l.search_bhk : l.search_bhk + ' BHK')}</span>`,
    l.property_id && `<span class="chip chip-prop">Property #${Number(l.property_id)}</span>`,
  ].filter(Boolean).join('');
  // Sign-ups store the interest in both fields — don't show it twice
  const msg = l.message && ![l.search_type, type].some(v => v && String(v).toLowerCase() === l.message.trim().toLowerCase()) ? l.message : '';
  return chips || msg
    ? `${chips ? `<div class="chips">${chips}</div>` : ''}${msg ? `<div class="lead-msg" title="${esc(msg)}">${esc(msg)}</div>` : ''}`
    : '<span class="muted">—</span>';
}

function leadWhen(l) {
  const when = fmtDate(l.created_at).split(', ');
  return `<b>${esc(when[0])}</b>${when[1] ? `<small>${esc(when.slice(1).join(', '))}</small>` : ''}`;
}

function leadRow(l) {
  const digits = String(l.phone || '').replace(/\D/g, '');
  const phone = l.phone
    ? `<div class="lead-phone"><a href="tel:${esc(l.phone)}">${esc(fmtPhone(l.phone))}</a>
        ${digits.length >= 10 ? `<a class="lead-wa" href="https://wa.me/${digits}" target="_blank" rel="noopener" title="Open in WhatsApp" aria-label="WhatsApp ${esc(l.name || l.phone)}">WhatsApp</a>` : ''}</div>`
    : '<span class="muted">—</span>';

  const where = String(l.timezone || '').split('/').pop().replace(/_/g, ' ');
  const devTitle = [l.ip_address && `IP ${l.ip_address}`, l.timezone, l.screen_w && l.screen_h && `Screen ${l.screen_w}×${l.screen_h}`].filter(Boolean).join(' · ');
  const device = l.device_type
    ? `<div class="lead-dev" title="${esc(devTitle)}"><span>${DEVICE_ICONS[l.device_type] || '🌐'} ${esc(l.device_type.charAt(0).toUpperCase() + l.device_type.slice(1))}</span>${where ? `<small>${esc(where)}</small>` : ''}</div>`
    : '<span class="muted">—</span>';

  return `<tr>
    <td class="lead-num">${Number(l.id)}</td>
    <td>${leadContact(l)}</td>
    <td>${phone}</td>
    <td>${srcPill(l.source)}</td>
    <td class="lead-looking">${leadLooking(l)}</td>
    <td>${device}</td>
    <td class="lead-time">${leadWhen(l)}</td>
    <td><div class="row-actions">${delBtn(`deleteLead(${Number(l.id)})`, 'Delete this lead')}</div></td>
  </tr>`;
}

function fillSourceFilter() {
  const sel = document.getElementById('lead-source');
  const counts = {};
  allLeads.forEach(l => { counts[l.source] = (counts[l.source] || 0) + 1; });
  const current = sel.value;
  sel.innerHTML = `<option value="">All sources (${allLeads.length})</option>` +
    Object.entries(counts).sort((x, y) => y[1] - x[1])
      .map(([src, n]) => `<option value="${esc(src)}">${esc(sourceLabel(src))} (${n})</option>`).join('');
  sel.value = counts[current] ? current : '';
}

function renderLeads() {
  const q = (document.getElementById('lead-search')?.value || '').toLowerCase();
  const src = document.getElementById('lead-source').value;
  const rows = allLeads.filter(l => (!src || l.source === src) && (!q ||
    [l.email, l.search_city, l.name, l.phone, l.ip_address, l.source, l.message].some(v => String(v || '').toLowerCase().includes(q))));
  document.getElementById('leads-tbody').innerHTML = rows.length ? rows.map(leadRow).join('') :
    '<tr><td colspan="8"><div class="empty"><div class="empty-icon">📋</div><p>No leads found. They appear when visitors search or enquire.</p></div></td></tr>';
}
document.getElementById('lead-source').addEventListener('change', renderLeads);
document.getElementById('lead-search').addEventListener('input', renderLeads);

document.getElementById('export-csv-btn').onclick = async () => {
  const btn = document.getElementById('export-csv-btn');
  btn.disabled = true;
  try {
    const r = await authFetch('/api/admin/leads?csv=1&limit=50000');
    if (!r.ok) throw new Error('Export failed');
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement('a'), {href: url, download: `landroof-leads-${new Date().toISOString().slice(0,10)}.csv`});
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
};

async function deleteLead(id) {
  if (!await confirmBox({title: 'Delete this lead?', message: 'The lead will be removed permanently. This cannot be undone.', confirmText: 'Delete', tone: 'danger'})) return;
  try { await api('DELETE', `/api/admin/leads/${id}`); toast('Lead deleted', 'ok'); loadLeads(); }
  catch (e) { toast(e.message, 'err'); }
}

// Right to erasure: removes every lead and the website account for one email address
document.getElementById('erase-btn').onclick = async () => {
  const email = await promptBox({title: "Delete a person's data", message: 'Every lead and the website account for this email address will be deleted.', label: 'Email address', type: 'email', placeholder: 'name@example.com', confirmText: 'Continue', required: true});
  if (!email) return;
  if (!await confirmBox({title: 'Delete all data?', message: `Every lead and the account for ${email} will be deleted permanently. This cannot be undone.`, confirmText: 'Delete everything', tone: 'danger'})) return;
  try {
    const {data} = await api('POST', '/api/admin/privacy/erase', {email});
    toast(`Deleted ${data.leads} lead(s) and ${data.accounts} account(s) for ${email}`, 'ok');
    loadLeads();
  } catch (e) { toast(e.message, 'err'); }
};

// ── Activity log ───────────────────────────────────────────────────────────
const AUDIT_LABELS = {
  'admin.login': '✅ Admin signed in', 'admin.logout': 'Admin signed out',
  'admin.login_failed': '⚠️ Failed admin sign-in', 'admin.login_failed_otp': '⚠️ Wrong 2-step code',
  'admin.login_blocked_locked': '⛔ Sign-in blocked (account locked)',
  create: 'Created', update: 'Updated', delete: 'Deleted', export: '⬇ Exported',
  'user.register': 'Visitor registered', 'user.register_existing_email': 'Registration with an existing email',
  'user.email_verified': 'Visitor confirmed email', 'user.login': 'Visitor signed in',
  'user.password_changed': 'Visitor changed password', 'user.password_reset_requested': 'Password reset requested',
  'user.password_reset': 'Visitor reset password', 'user.logout_all': 'Visitor signed out everywhere',
  'privacy.erase': '🗑 Personal data erased', 'privacy.retention': 'Old personal data cleaned up',
};

async function loadAudit() {
  const action = document.getElementById('audit-filter').value;
  const {data} = await api('GET', '/api/admin/audit?limit=500&action=' + encodeURIComponent(action));
  document.getElementById('audit-tbody').innerHTML = data.length ? data.map(a => `
    <tr>
      <td style="color:#888;font-size:12px;white-space:nowrap">${fmtDate(a.created_at)}</td>
      <td style="font-size:12.5px">${esc(a.actor)}</td>
      <td>${esc(AUDIT_LABELS[a.action] || a.action)}</td>
      <td style="font-size:12.5px">${esc([a.target, a.target_id && '#' + a.target_id].filter(Boolean).join(' '))}${a.details ? `<br><span style="color:#888">${esc(a.details.slice(0, 120))}</span>` : ''}</td>
      <td style="font-size:11.5px;color:#888">${esc(a.ip_address)}<br>${esc((a.user_agent || '').slice(0, 60))}</td>
    </tr>`).join('') :
    '<tr><td colspan="5"><div class="empty"><div class="empty-icon">🛡</div><p>No activity recorded yet.</p></div></td></tr>';
}
document.getElementById('audit-filter').addEventListener('change', () => loadAudit().catch(e => toast(e.message, 'err')));

// ── Registered users ──────────────────────────────────────────────────────
async function loadUsers() {
  const {data} = await api('GET', '/api/admin/users');
  document.getElementById('users-tbody').innerHTML = data.length ? data.map(u => `
    <tr>
      <td style="color:#aaa;font-size:12px">${Number(u.id)}</td>
      <td><strong>${esc(u.name || '—')}</strong></td>
      <td>${esc(u.email)}</td>
      <td>${u.phone ? esc(u.phone) : '<span style="color:#ccc">—</span>'}</td>
      <td>${Number(u.saved)}</td>
      <td style="color:#aaa;font-size:12px;white-space:nowrap">${fmtDate(u.created_at)}</td>
    </tr>`).join('') :
    '<tr><td colspan="6"><div class="empty"><div class="empty-icon">👤</div><p>No registered users yet.</p></div></td></tr>';
}

// ── Generic content (testimonials, team, events, announcements, schemes, social, media) ──
const activeCell = r => r.is_active ? '<span class="pill-on">Active</span>' : '<span class="pill-off">Hidden</span>';
const thumb = url => url ? `<img class="thumb" src="${esc(url)}" alt="" loading="lazy">` : '<div class="prop-img-ph">🖼</div>';
const actions = (type, id) => `<div class="row-actions">${editBtn(`openGenericDrawer('${type}',${Number(id)})`)}${delBtn(`deleteContent('${type}',${Number(id)})`)}</div>`;
const ACTIVE_FIELD = {name:'is_active', label:'Show on website', type:'toggle', default:true};
const IMAGE_FIELD = {name:'image', label:'Photo', type:'image'};

const CONTENT = {
  testimonial: {
    label: 'Testimonial', endpoint: '/api/admin/testimonials', tbody: 'testi-tbody', cols: 6,
    fields: [
      {name:'name', label:'Client Name *', required:true},
      {name:'role', label:'Role / Profession', half:true},
      {name:'city', label:'City', half:true},
      {name:'rating', label:'Rating', type:'select', options:[['5','★★★★★ (5)'],['4','★★★★ (4)'],['3','★★★ (3)'],['2','★★ (2)'],['1','★ (1)']], default:'5'},
      {name:'text', label:'Quote *', type:'textarea', required:true},
      ACTIVE_FIELD,
    ],
    row: r => `<td><strong>${esc(r.name)}</strong></td><td>${esc([r.role, r.city].filter(Boolean).join(' · ')) || '—'}</td>
      <td style="color:#FFB300">${'★'.repeat(Number(r.rating) || 0)}</td><td class="cell-clip" title="${esc(r.text)}">${esc(r.text)}</td>
      <td>${activeCell(r)}</td><td>${actions('testimonial', r.id)}</td>`,
  },
  team: {
    label: 'Team Member', endpoint: '/api/admin/team', tbody: 'team-tbody', cols: 7,
    fields: [
      {name:'name', label:'Name *', required:true, half:true},
      {name:'role', label:'Role / Title *', required:true, half:true},
      {name:'bio', label:'Short Bio', type:'textarea'},
      {name:'email', label:'Email', type:'email', rule:'email', half:true},
      {name:'phone', label:'Mobile Number', type:'tel', rule:'phone', half:true, hint:'e.g. 98765 43210'},
      {name:'order_idx', label:'Display Order', type:'number', default:'0', hint:'Lower numbers show first'},
      IMAGE_FIELD, ACTIVE_FIELD,
    ],
    row: r => `<td>${thumb(r.image_url)}</td><td><strong>${esc(r.name)}</strong></td><td>${esc(r.role)}</td>
      <td style="font-size:12px">${esc([r.email, r.phone].filter(Boolean).join(' · ')) || '—'}</td><td>${Number(r.order_idx)}</td>
      <td>${activeCell(r)}</td><td>${actions('team', r.id)}</td>`,
  },
  city: {
    label: 'City', endpoint: '/api/admin/cities', tbody: 'cities-tbody', cols: 7,
    fields: [
      {name:'name', label:'City Name *', required:true, half:true, hint:'Use the same spelling as on your properties'},
      {name:'state', label:'State', half:true, hint:'e.g. Maharashtra'},
      {name:'image', label:'Photo', type:'image', hint:'A landmark or skyline photo. Upright or landscape both work.'},
      {name:'order_idx', label:'Display Order', type:'number', default:'0', hint:'Lower numbers show first'},
      ACTIVE_FIELD,
    ],
    row: r => `<td>${thumb(r.image_url)}</td><td><strong>${esc(r.name)}</strong></td><td>${esc(r.state) || '—'}</td>
      <td>${cityListings(r.name)}</td><td>${Number(r.order_idx)}</td><td>${activeCell(r)}</td><td>${actions('city', r.id)}</td>`,
  },
  event: {
    label: 'Event', endpoint: '/api/admin/events', tbody: 'events-tbody', cols: 6,
    fields: [
      {name:'title', label:'Event Title *', required:true},
      {name:'event_date', label:'Date', type:'date', half:true},
      {name:'location', label:'Location', half:true},
      {name:'description', label:'Description', type:'textarea'},
      IMAGE_FIELD, ACTIVE_FIELD,
    ],
    row: r => `<td>${thumb(r.image_url)}</td><td><strong>${esc(r.title)}</strong></td><td>${esc(fmtDay(r.event_date)) || '—'}</td>
      <td>${esc(r.location) || '—'}</td><td>${activeCell(r)}</td><td>${actions('event', r.id)}</td>`,
  },
  announcement: {
    label: 'Announcement', endpoint: '/api/admin/announcements', tbody: 'ann-tbody', cols: 5,
    fields: [
      {name:'title', label:'Headline *', required:true},
      {name:'body', label:'Details', type:'textarea', hint:'Shown after the headline in the top banner'},
      {name:'type', label:'Style', type:'select', options:[['info','Info (blue)'],['promo','Promotion (orange)'],['warning','Important (amber)']], default:'info'},
      ACTIVE_FIELD,
    ],
    row: r => `<td><strong>${esc(r.title)}</strong></td><td class="cell-clip">${esc(r.body) || '—'}</td>
      <td style="text-transform:capitalize">${esc(r.type)}</td><td>${activeCell(r)}</td><td>${actions('announcement', r.id)}</td>`,
  },
  scheme: {
    label: 'Scheme / Offer', endpoint: '/api/admin/schemes', tbody: 'schemes-tbody', cols: 5,
    fields: [
      {name:'title', label:'Offer Title *', required:true},
      {name:'description', label:'Description', type:'textarea'},
      {name:'valid_until', label:'Valid Until', type:'date', hint:'The offer hides automatically after this date'},
      IMAGE_FIELD, ACTIVE_FIELD,
    ],
    row: r => `<td>${thumb(r.image_url)}</td><td><strong>${esc(r.title)}</strong></td><td>${esc(fmtDay(r.valid_until)) || 'No end date'}</td>
      <td>${activeCell(r)}</td><td>${actions('scheme', r.id)}</td>`,
  },
  social: {
    label: 'Social Post', endpoint: '/api/admin/social-posts', tbody: 'social-tbody', cols: 6,
    fields: [
      {name:'platform', label:'Platform', type:'select', options:[['instagram','Instagram'],['facebook','Facebook'],['linkedin','LinkedIn'],['youtube','YouTube'],['twitter','X / Twitter']], default:'instagram'},
      {name:'url', label:'Post Link', type:'url', hint:'Full link starting with https://'},
      {name:'caption', label:'Caption', type:'textarea'},
      IMAGE_FIELD, ACTIVE_FIELD,
    ],
    row: r => `<td>${thumb(r.image_url)}</td><td style="text-transform:capitalize">${esc(r.platform)}</td>
      <td class="cell-clip">${esc(r.caption) || '—'}</td>
      <td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" style="color:var(--or)">Open ↗</a>` : '—'}</td>
      <td>${activeCell(r)}</td><td>${actions('social', r.id)}</td>`,
  },
  media: {
    label: 'Gallery Image', endpoint: '/api/admin/media', grid: 'media-grid',
    fields: [
      {name:'image', label:'Image *', type:'image', requiredOnCreate:true},
      {name:'caption', label:'Caption'},
      {name:'category', label:'Category', type:'select', options:[['general','General'],['projects','Projects'],['interiors','Interiors'],['events','Events'],['office','Office']], default:'general'},
    ],
  },
};

// Number of properties in a city (for the Cities table)
const cityListings = name => {
  const n = allProps.filter(p => String(p.city).toLowerCase() === String(name).toLowerCase()).length;
  return n ? `${n}` : '<span style="color:#aaa">0</span>';
};

async function loadContent(type) {
  const cfg = CONTENT[type];
  if (type === 'city' && !allProps.length) {
    try { allProps = (await api('GET', '/api/admin/properties')).data; } catch {}
  }
  const {data} = await api('GET', cfg.endpoint);
  cache[type] = data;
  if (cfg.grid) return renderMediaGrid(data);
  document.getElementById(cfg.tbody).innerHTML = data.length
    ? data.map(r => `<tr>${cfg.row(r)}</tr>`).join('')
    : `<tr><td colspan="${cfg.cols}"><div class="empty"><div class="empty-icon">📭</div><p>Nothing here yet. Use the “+ Add” button to create the first one.</p></div></td></tr>`;
}

function renderMediaGrid(data) {
  document.getElementById('media-grid').innerHTML = data.length ? data.map(m => `
    <div class="media-card">
      <a href="${esc(m.image_url)}" target="_blank" rel="noopener"><img src="${esc(m.image_url)}" alt="${esc(m.caption)}" loading="lazy"></a>
      <div class="mc-body"><span class="mc-cat">${esc(m.category)}</span><br>${esc(m.caption) || '<span style="color:#bbb">No caption</span>'}</div>
      <div class="mc-actions">${actions('media', m.id)}</div>
    </div>`).join('') :
    '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🖼</div><p>No images yet. Click “+ Upload Image”.</p></div>';
}

function fieldHTML(f, value, item) {
  const id = 'g-' + f.name;
  const hint = f.hint ? `<div class="form-hint">${esc(f.hint)}</div>` : '';
  const label = `<label class="form-label" for="${id}">${esc(f.label)}</label>`;
  const req = f.required ? 'required' : '';
  switch (f.type) {
    case 'textarea':
      return `<div class="form-group">${label}<textarea class="form-control" id="${id}" name="${f.name}" rows="3" ${req}>${esc(value)}</textarea>${hint}</div>`;
    case 'select':
      return `<div class="form-group">${label}<select class="form-control" id="${id}" name="${f.name}">${
        f.options.map(([v, t]) => `<option value="${esc(v)}" ${String(value) === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>${hint}</div>`;
    case 'toggle':
      return `<div class="form-group"><div class="toggle-row"><span class="form-label" style="margin:0">${esc(f.label)}</span>
        <label class="toggle"><input type="checkbox" id="${id}" ${value ? 'checked' : ''}><span class="toggle-slider"></span></label></div></div>`;
    case 'image': {
      const current = item?.image_url;
      return `<div class="form-group">${label}
        <div class="img-drop" id="g-drop" data-on-click="clickEl('${id}')">
          <div class="img-drop-icon">📸</div>
          <div class="img-drop-txt">Click or drag to upload</div>
          <div class="img-drop-sub">JPG, PNG, WebP or GIF · Max 10 MB</div>
          <img id="g-preview" class="img-preview" alt="preview" ${current ? `src="${esc(current)}" style="display:block"` : ''}>
        </div>
        <input type="file" class="g-file" id="${id}" accept="image/jpeg,image/png,image/webp,image/gif" data-on-change="previewImg(this,'g-preview')">
        ${current && !f.requiredOnCreate ? '<button type="button" class="img-remove" id="g-remove-img" data-on-click="markImageRemoved()">Remove current photo</button>' : ''}
        ${hint}</div>`;
    }
    default:
      return `<div class="form-group">${label}<input class="form-control" id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(value)}" ${req}>${hint}</div>`;
  }
}

function openGenericDrawer(type, id) {
  const cfg = CONTENT[type];
  const item = id ? (cache[type] || []).find(r => r.id === id) : null;
  if (id && !item) return toast('Item not found — reload the page', 'err');
  gEdit = {type, id, removeImage: false};
  document.getElementById('gdrawer-title').textContent = (item ? 'Edit ' : 'Add ') + cfg.label;

  // Pair "half" fields into two-column rows
  let html = '';
  const fields = cfg.fields;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const val = item ? (f.type === 'toggle' ? !!item[f.name] : (item[f.name] ?? '')) : (f.default ?? '');
    const next = fields[i + 1];
    if (f.half && next?.half) {
      const nval = item ? (item[next.name] ?? '') : (next.default ?? '');
      html += `<div class="form-row"><div>${fieldHTML(f, val, item)}</div><div>${fieldHTML(next, nval, item)}</div></div>`;
      i++;
    } else {
      html += fieldHTML(f, val, item);
    }
  }
  document.getElementById('gdrawer-body').innerHTML = `<form id="g-form" data-on-submit="return false">${html}</form>`;
  const drop = document.getElementById('g-drop');
  if (drop) setupDrop(drop, document.getElementById('g-image'), 'g-preview');
  openPanel('generic-drawer');
  document.querySelector('#g-form .form-control')?.focus();
}

function markImageRemoved() {
  gEdit.removeImage = true;
  document.getElementById('g-preview').style.display = 'none';
  document.getElementById('g-remove-img').textContent = 'Photo will be removed when you save';
}

function closeGenericDrawer(fromBack = false) {
  if (!document.getElementById('generic-drawer').classList.contains('open')) return;
  if (!fromBack) popLayer();
  document.getElementById('generic-drawer').classList.remove('open');
  if (!document.getElementById('prop-drawer').classList.contains('open')) {
    document.getElementById('drawer-overlay').classList.remove('on');
  }
}

document.getElementById('gdrawer-save').onclick = async () => {
  const {type, id} = gEdit;
  const cfg = CONTENT[type];
  const form = document.getElementById('g-form');
  if (!form.checkValidity()) { form.reportValidity(); return; }

  // Types with a photo are sent as multipart form data; the rest as JSON
  const withImage = cfg.fields.some(f => f.type === 'image');
  const values = {};
  let file = null, firstBad = null;
  for (const f of cfg.fields) {
    const el = document.getElementById('g-' + f.name);
    if (f.type === 'toggle') values[f.name] = el.checked ? '1' : '0';
    else if (f.type === 'image') {
      file = el.files[0] || null;
      if (!file && f.requiredOnCreate && !id) { toast('Please choose an image', 'err'); return; }
    } else if (f.rule) {
      // Same email / mobile rules as the website and the server (shared/validation.js)
      const r = LRValidation.rules[f.rule](el.value, {});
      setFieldError(el, r.error || '');
      if (r.error) firstBad ||= el; else values[f.name] = r.value;
    } else values[f.name] = el.value;
  }
  if (firstBad) { firstBad.focus(); return; }
  if (gEdit.removeImage && !file) values.remove_image = '1';
  let fd = values;
  if (withImage) {
    fd = new FormData();
    Object.entries(values).forEach(([k, v]) => fd.set(k, v));
    if (file) fd.set('image', file);
  }

  const btn = document.getElementById('gdrawer-save');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await api(id ? 'PUT' : 'POST', id ? `${cfg.endpoint}/${id}` : cfg.endpoint, fd);
    toast(`${cfg.label} ${id ? 'updated' : 'added'}!`, 'ok');
    closeGenericDrawer();
    loadContent(type);
  } catch (e) {
    // Show server messages under the matching inputs when it names the field
    const named = Object.entries(e.fields || {}).filter(([k]) => document.getElementById('g-' + k));
    named.forEach(([k, msg]) => setFieldError(document.getElementById('g-' + k), msg));
    if (!named.length) toast(e.message, 'err');
  }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
};

/** Shows (or clears) a message under an admin form input */
function setFieldError(input, msg) {
  let el = input.parentElement.querySelector(`.field-error[data-for="${input.id}"]`);
  if (!el) {
    el = Object.assign(document.createElement('div'), {className: 'field-error'});
    el.dataset.for = input.id;
    input.insertAdjacentElement('afterend', el);
  }
  el.textContent = msg;
  if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
}

async function deleteContent(type, id) {
  const cfg = CONTENT[type];
  if (!await confirmBox({title: `Delete this ${cfg.label.toLowerCase()}?`, message: 'It will be removed from the website. This cannot be undone.', confirmText: 'Delete', tone: 'danger'})) return;
  try { await api('DELETE', `${cfg.endpoint}/${id}`); toast(`${cfg.label} deleted`, 'ok'); loadContent(type); }
  catch (e) { toast(e.message, 'err'); }
}

// ── Listing requests & owners ──────────────────────────────────────────────
const TYPE_NAME = {buy: 'For sale', rent: 'For rent', plots: 'Plot / land', commercial: 'Commercial'};
const STATUS_PILL = {pending: 'Pending', approved: 'Approved', rejected: 'Rejected'};

async function refreshBadges() {
  try {
    const {data} = await api('GET', '/api/admin/stats');
    const b = document.getElementById('badge-requests');
    b.textContent = data.pending_requests;
    b.hidden = !data.pending_requests;
    const r = document.getElementById('badge-reports');
    r.textContent = data.open_reports;
    r.hidden = !data.open_reports;
  } catch {}
}

async function loadRequests() {
  const {data} = await api('GET', '/api/admin/listing-requests');
  allRequests = data;
  renderRequests();
}

function renderRequests() {
  const counts = {all: allRequests.length};
  allRequests.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
  document.querySelectorAll('#req-filters .filter-btn').forEach(b => {
    b.classList.toggle('on', b.dataset.status === reqFilter);
    b.textContent = `${b.dataset.status === 'all' ? 'All' : STATUS_PILL[b.dataset.status]} (${counts[b.dataset.status] || 0})`;
  });
  const rows = allRequests.filter(r => reqFilter === 'all' || r.status === reqFilter);
  document.getElementById('req-tbody').innerHTML = rows.length ? rows.map(r => {
    const id = Number(r.id);
    const actions = r.status === 'pending'
      ? `<button type="button" class="act-btn act-ok" data-on-click="decideRequest(${id},'approved')">${ICON_OK}<span>Approve</span></button><button type="button" class="act-btn act-del" data-on-click="decideRequest(${id},'rejected')">${ICON_NO}<span>Reject</span></button>`
      : r.status === 'approved'
        ? `<button type="button" class="act-btn" data-on-click="resendLink(${id})" title="Email a new sign-in link">${ICON_MAIL}<span>Resend link</span></button>`
        : `<button type="button" class="act-btn act-ok" data-on-click="decideRequest(${id},'approved')">${ICON_OK}<span>Approve</span></button>`;
    return `<tr>
      <td>${leadContact(r)}</td>
      <td>${r.phone ? `<a class="plain-link" href="tel:${esc(r.phone)}">${esc(fmtPhone(r.phone))}</a>` : '<span class="muted">—</span>'}</td>
      <td class="lead-looking"><div class="chips">${[r.city && `<span class="chip chip-city">${esc(r.city)}</span>`, r.property_type && `<span class="chip">${esc(TYPE_NAME[r.property_type] || r.property_type)}</span>`].filter(Boolean).join('')}</div>${r.message ? `<div class="lead-msg" title="${esc(r.message)}">${esc(r.message)}</div>` : ''}</td>
      <td class="lead-time">${leadWhen(r)}</td>
      <td><span class="review-pill review-${esc(r.status)}">${STATUS_PILL[r.status]}</span>${r.status === 'approved' && r.user_id ? `<br><span class="by-owner">${Number(r.properties)} listing${r.properties == 1 ? '' : 's'}</span>` : ''}</td>
      <td><div class="row-actions">${actions}</div></td>
    </tr>`;
  }).join('') : `<tr><td colspan="6"><div class="empty"><div class="empty-icon">📭</div><p>${reqFilter === 'pending' ? 'No requests waiting. New "List Property" requests from the website appear here.' : 'Nothing here.'}</p></div></td></tr>`;
}
document.querySelectorAll('#req-filters .filter-btn').forEach(b => { b.onclick = () => { reqFilter = b.dataset.status; renderRequests(); }; });

async function decideRequest(id, status) {
  const r = allRequests.find(x => x.id === id);
  const who = r ? (r.name || r.email) : 'this person';
  const ok = status === 'approved'
    ? await confirmBox({title: `Approve ${who}?`, message: `${r?.email || 'They'} will get an email with a link to add their properties. Each listing still needs your review before it goes live.`, confirmText: 'Approve', tone: 'ok'})
    : await confirmBox({title: `Reject ${who}?`, message: `${r?.email || 'They'} will get a polite email saying the request couldn't be approved.`, confirmText: 'Reject', tone: 'danger', icon: 'reject'});
  if (!ok) return;
  try {
    await api('POST', `/api/admin/listing-requests/${id}/decision`, {status});
    toast(status === 'approved' ? 'Approved — the owner has been emailed a link' : 'Rejected — the person has been emailed', 'ok');
    loadRequests(); refreshBadges();
  } catch (e) { toast(e.message, 'err'); }
}

async function resendLink(id) {
  try { await api('POST', `/api/admin/listing-requests/${id}/resend`); toast('A new sign-in link has been emailed', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
}

let allOwners = [];
async function loadOwners() {
  const {data} = await api('GET', '/api/admin/owners');
  allOwners = data;
  document.getElementById('owners-tbody').innerHTML = data.length ? data.map(o => `<tr>
    <td>${leadContact(o)}</td>
    <td>${o.phone ? `<a class="plain-link" href="tel:${esc(o.phone)}">${esc(fmtPhone(o.phone))}</a>` : '<span class="muted">—</span>'}</td>
    <td>${o.user_id ? '<span class="review-pill review-approved">Signed up</span>' : '<span class="review-pill">Not signed up yet</span>'}</td>
    <td><div class="owner-counts"><b>${Number(o.total)}</b> total${o.live ? `<span class="review-pill review-approved">${Number(o.live)} live</span>` : ''}${o.pending ? `<span class="review-pill review-pending">${Number(o.pending)} to review</span>` : ''}${o.rejected ? `<span class="review-pill review-rejected">${Number(o.rejected)} not approved</span>` : ''}</div></td>
    <td class="lead-time">${leadWhen({created_at: o.approved_at})}</td>
    <td><div class="row-actions">${o.user_id && o.total ? `<button type="button" class="act-btn" data-on-click="showOwnerProps(${Number(o.user_id)})">View listings</button>` : ''}<button type="button" class="act-btn" data-on-click="resendLink(${Number(o.request_id)})" title="Email a new sign-in link">${ICON_MAIL}<span>Resend link</span></button></div></td>
  </tr>`).join('') : '<tr><td colspan="6"><div class="empty"><div class="empty-icon">🏠</div><p>No owners yet. Approve a listing request to add one.</p></div></td></tr>';
}

function showOwnerProps(userId) {
  const o = allOwners.find(x => x.user_id === userId);
  propOwner = {id: userId, name: o?.account_name || o?.name, email: o?.email};
  navTo('properties');
}
function clearOwnerFilter() { propOwner = null; renderProps(); }

async function reviewProp(id, status) {
  const p = allProps.find(x => x.id === id);
  let note = '';
  if (status === 'rejected') {
    const n = await promptBox({title: 'Reject this listing?', message: `"${p?.title}" will stay hidden from the website${p?.owner ? ' and the owner will be emailed' : ''}.`, label: 'Note for the owner (optional)', placeholder: 'e.g. Please add a clear photo and the exact price', multiline: true, confirmText: 'Reject listing', tone: 'danger', icon: 'reject'});
    if (n === null) return;
    note = n;
  } else if (!await confirmBox({title: 'Approve this listing?', message: `"${p?.title}" will appear on the website${p?.owner ? ' and the owner will be emailed' : ''}.`, confirmText: 'Approve', tone: 'ok'})) return;
  try {
    await api('POST', `/api/admin/properties/${id}/review`, {status, note});
    toast(status === 'approved' ? 'Listing is now live' : 'Listing marked as not approved', 'ok');
    loadProps();
  } catch (e) { toast(e.message, 'err'); }
}

// ── Property form: amenities, extra photos, floor plan, map location ─────────
let amenityList = null;
async function fillAmenityChips(selected) {
  if (!amenityList) {
    try { amenityList = (await (await fetch('/api/listing-options')).json()).data.amenities; } catch { amenityList = []; }
  }
  const all = [...new Set([...amenityList, ...selected])];
  document.getElementById('f-amenities').innerHTML = all.map((a, i) =>
    `<label class="amen-chip"><input type="checkbox" value="${esc(a)}" id="f-am-${i}" ${selected.includes(a) ? 'checked' : ''}><span>${esc(a)}</span></label>`).join('');
}

let galleryRemove = new Set();
function showCurrentMedia(p) {
  galleryRemove = new Set();
  const photos = p?.gallery_urls || [];
  document.getElementById('f-gallery-current').innerHTML = photos.map(u =>
    `<button type="button" class="g-thumb" data-url="${esc(u)}" data-on-click="toggleGalleryPhoto(this)" title="Click to remove"><img src="${esc(u)}" alt=""><span>✕</span></button>`).join('')
    + (photos.length ? '<div class="form-hint">Click a photo to remove it when you save.</div>' : '');
  document.getElementById('f-floor-current').innerHTML = p?.floor_plan_url
    ? `<a href="${esc(p.floor_plan_url)}" target="_blank" rel="noopener">Current floor plan</a> · <label><input type="checkbox" id="f-floor-remove"> Remove it</label>` : '';
}
function toggleGalleryPhoto(btn) {
  const url = btn.dataset.url;
  if (galleryRemove.has(url)) galleryRemove.delete(url); else galleryRemove.add(url);
  btn.classList.toggle('removing', galleryRemove.has(url));
}

/** "18.55, 73.78" or a Google Maps link (…@18.55,73.78,15z or ?q=18.55,73.78) → [lat, lng]; '' → ['', '']; null if unreadable */
function parseLocation(text) {
  const t = String(text || '').trim();
  if (!t) return ['', ''];
  const m = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(t) || /[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(t) || /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(t);
  return m ? [m[1], m[2]] : null;
}

// ── Listing manager: review, status, verification, documents, plots, approvals, history ──
const ICON_MANAGE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>';
const DOC_KINDS = {brochure: 'Brochure', layout: 'Layout plan', approval: 'Approval / order', title: 'Title document', other: 'Other'};
const APPROVAL_KINDS = {na: 'NA (Non-Agricultural) order', landuse: 'Land-use / zone certificate', layout: 'Layout approval', rera: 'MahaRERA registration', other: 'Other approval'};
const PLOT_STATUS = {available: 'Available', hold: 'On hold', booked: 'Booked', sold: 'Sold'};
const EVENT_LABEL = {
  'draft.saved': 'Saved as draft', submitted: 'Submitted for review', resubmitted: 'Changes submitted', 'admin.create': 'Created', 'admin.edit': 'Edited',
  'review.under_review': 'Review started', 'review.changes': 'Corrections asked', 'review.approved': 'Approved & published', 'review.rejected': 'Rejected',
  verified: 'Verified', 'verification.removed': 'Verification removed', 'listing.status': 'Listing status',
  'document.added': 'Document added', 'document.published': 'Document published', 'document.unpublished': 'Document made private', 'document.deleted': 'Document deleted',
  'plot.added': 'Plot added', 'plot.bulk_added': 'Plots added', 'plot.status': 'Plot status', 'plot.edited': 'Plot edited', 'plot.deleted': 'Plot deleted',
  'approval.added': 'Approval added', 'approval.edited': 'Approval edited', 'approval.reviewed': 'Approval reviewed', 'approval.unreviewed': 'Approval review removed', 'approval.deleted': 'Approval deleted',
  'report.resolved': 'Report resolved', 'report.dismissed': 'Report dismissed', 'report.open': 'Report reopened',
};
let manageId = null, manageData = null;

async function openManage(id) {
  manageId = id;
  const p = allProps.find(x => x.id === id);
  document.getElementById('mdrawer-title').textContent = p ? `Manage · ${p.listing_code}` : 'Manage Listing';
  document.getElementById('mdrawer-body').innerHTML = '<div class="empty"><p>Loading…</p></div>';
  if (!document.getElementById('manage-drawer').classList.contains('open')) openPanel('manage-drawer');
  await reloadManage();
}

async function reloadManage() {
  try {
    const [{data: props}, {data}] = await Promise.all([api('GET', '/api/admin/properties'), api('GET', `/api/admin/properties/${manageId}/details`)]);
    allProps = props;
    renderProps();
    manageData = data;
    renderManage();
  } catch (e) { toast(e.message, 'err'); }
}

function closeManage(fromBack = false) {
  if (!document.getElementById('manage-drawer').classList.contains('open')) return;
  if (!fromBack) popLayer();
  document.getElementById('manage-drawer').classList.remove('open');
  if (!document.getElementById('prop-drawer').classList.contains('open')) document.getElementById('drawer-overlay').classList.remove('on');
}

const fmtTime = fmtDate;
const dayInput = d => d ? String(d).slice(0, 10) : '';

function renderManage() {
  const p = allProps.find(x => x.id === manageId);
  const d = manageData;
  if (!p) { closeManage(); return; }
  const id = Number(p.id);
  const live = p.review_status === 'approved' && p.listing_status === 'active';
  const scopes = String(p.verify_scope || '').split(';').map(s => s.trim());
  document.getElementById('mdrawer-body').innerHTML = `
    <div class="mg-head">
      ${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : ''}
      <div><b>${esc(p.title)}</b><span>${esc(p.price_label)} · ${esc([p.locality, p.city].filter(Boolean).join(', '))}</span>${statusCell(p)}
      ${live ? `<a class="plain-link" href="/${p.is_project ? 'project' : 'property'}/${id}" target="_blank" rel="noopener">View on website ↗</a>` : ''}</div>
    </div>

    ${d.duplicates.length ? `<div class="mg-warn">⚠ Looks like ${d.duplicates.map(x => `<b>${esc(x.listing_code)}</b> “${esc(x.title)}”`).join(', ')}. Check before approving.</div>` : ''}
    ${d.reports.filter(r => r.status === 'open').map(r => `<div class="mg-warn">🚩 Reported: <b>${esc(r.reason)}</b>${r.details ? ' — ' + esc(r.details) : ''} <button type="button" class="act-btn" data-on-click="decideReport(${Number(r.id)},'resolved',true)">Resolve</button></div>`).join('')}

    <section class="mg-sec">
      <h4>1 · Review</h4>
      <p class="mg-note">Status: <b>${esc(REVIEW_LABEL[p.review_status] || 'Approved')}</b>${p.review_note ? ` · Note: ${esc(p.review_note)}` : ''}${p.published_at ? ` · Published ${esc(fmtTime(p.published_at))}` : ''}</p>
      <div class="row-actions mg-actions">
        ${p.review_status !== 'under_review' && p.review_status !== 'approved' ? `<button type="button" class="act-btn" data-on-click="reviewAction('under_review')">Start review</button>` : ''}
        ${p.owner_id ? `<button type="button" class="act-btn" data-on-click="reviewAction('changes')">Ask for corrections</button>` : ''}
        ${p.review_status !== 'approved' ? `<button type="button" class="act-btn act-ok" data-on-click="reviewAction('approved')">${ICON_OK}<span>Approve &amp; publish</span></button>` : ''}
        ${p.review_status !== 'rejected' ? `<button type="button" class="act-btn act-del" data-on-click="reviewAction('rejected')">${ICON_NO}<span>Reject</span></button>` : ''}
      </div>
    </section>

    <section class="mg-sec">
      <h4>2 · Listing status</h4>
      <div class="form-row">
        <div class="form-group" style="margin:0"><label class="form-label" for="mg-status">Status</label>
          <select class="form-control" id="mg-status">${['active', 'sold', 'rented', 'expired', 'withdrawn'].map(s => `<option value="${s}" ${p.listing_status === s ? 'selected' : ''}>${{active: 'Active (in search)', sold: 'Sold', rented: 'Rented', expired: 'Expired', withdrawn: 'Withdrawn'}[s]}</option>`).join('')}</select></div>
        <div class="form-group" style="margin:0"><label class="form-label" for="mg-expires">Live until <span class="opt">(empty = no end date)</span></label>
          <input type="date" class="form-control" id="mg-expires" value="${esc(dayInput(p.expires_at))}"></div>
      </div>
      <p class="mg-note">Sold, rented, expired and withdrawn listings leave the search; their page shows the status. Expired is set automatically on the end date.</p>
      <button type="button" class="tb-btn" data-on-click="saveListingStatus()">Save status</button>
    </section>

    <section class="mg-sec">
      <h4>3 · Verification badge</h4>
      <p class="mg-note">${p.verified_at ? `Verified ${esc(fmtTime(p.verified_at))} by ${esc(p.verified_by)}.` : 'Not verified.'} Visitors see exactly what you tick here, plus a note that it is not a legal title check.</p>
      <div class="mg-checks">${d.verify_scopes.map((s, i) => `<label><input type="checkbox" class="mg-scope" value="${esc(s)}" id="mg-scope-${i}" ${scopes.includes(s) ? 'checked' : ''}> ${esc(s)}</label>`).join('')}</div>
      <div class="row-actions mg-actions">
        <button type="button" class="act-btn act-ok" data-on-click="saveVerify(true)">${ICON_OK}<span>${p.verified_at ? 'Update' : 'Mark verified'}</span></button>
        ${p.verified_at ? `<button type="button" class="act-btn act-del" data-on-click="saveVerify(false)">Remove badge</button>` : ''}
      </div>
    </section>

    <section class="mg-sec">
      <h4>4 · Documents <span class="mg-sub">private unless you publish them</span></h4>
      ${d.documents.length ? `<div class="mg-list">${d.documents.map(doc => `<div class="mg-item">
        <div><b>${esc(doc.title || doc.original_name)}</b><span>${esc(DOC_KINDS[doc.kind] || doc.kind)} · ${doc.mime === 'application/pdf' ? 'PDF' : 'Image'} · ${Math.max(1, Math.round(doc.size / 1024))} KB · by ${esc(String(doc.uploaded_by || '').replace(/^owner:\d+/, 'owner').replace(/^admin:/, ''))}</span></div>
        <select class="form-control mg-mini" data-doc="${Number(doc.id)}" data-on-change="setDocKind(this)" aria-label="Document type">${Object.entries(DOC_KINDS).map(([k, l]) => `<option value="${k}" ${doc.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="mg-pub" title="Visitors can download it from the listing page"><input type="checkbox" data-doc="${Number(doc.id)}" data-on-change="toggleDocPublic(this)" ${doc.is_public ? 'checked' : ''}> Public</label>
        <button type="button" class="act-btn" data-on-click="downloadDoc(${Number(doc.id)})">Open</button>
        ${delBtn(`deleteDoc(${Number(doc.id)})`)}
      </div>`).join('')}</div>` : '<p class="mg-note">No documents yet.</p>'}
      <div class="mg-upload">
        <input type="file" class="form-control" id="mg-doc-file" accept="application/pdf,image/jpeg,image/png" aria-label="Document file">
        <select class="form-control" id="mg-doc-kind" aria-label="Document type">${Object.entries(DOC_KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <input type="text" class="form-control" id="mg-doc-title" placeholder="Title (optional)" maxlength="120">
        <button type="button" class="tb-btn" data-on-click="uploadDoc()">Upload</button>
      </div>
      <p class="mg-note">Publish brochures and approval copies only when you are authorised to share them. Title papers and IDs should stay private.</p>
    </section>

    ${p.is_project || p.type === 'plots' ? plotsSection(p, d) : ''}
    ${p.is_project || p.type === 'plots' ? approvalsSection(d) : ''}

    <section class="mg-sec">
      <h4>History</h4>
      ${d.events.length ? `<ol class="mg-history">${d.events.map(e => `<li><b>${esc(EVENT_LABEL[e.action] || e.action)}${e.to_status && e.action === 'listing.status' ? ': ' + esc(e.to_status) : ''}</b> <span>${esc(fmtTime(e.created_at))} · ${esc(e.actor.startsWith('admin:') ? e.actor.slice(6) : e.actor.replace(/^owner:\d+/, 'owner'))}</span>${e.note ? `<p>${esc(e.note)}</p>` : ''}</li>`).join('')}</ol>` : '<p class="mg-note">No history yet.</p>'}
    </section>`;
}

function plotsSection(p, d) {
  const c = d.plot_counts;
  return `<section class="mg-sec">
    <h4>5 · Plot inventory <span class="mg-sub">${c.total} plots · ${c.available} available · ${c.hold} on hold · ${c.booked} booked · ${c.sold} sold</span></h4>
    ${!p.is_project ? '<p class="mg-note">Adding plots turns on the project page for this listing.</p>' : ''}
    ${d.plots.length ? `<div class="mg-plots"><table><thead><tr><th>Plot</th><th>Area</th><th>Rate</th><th>Total</th><th>Facing</th><th>Status</th><th></th></tr></thead><tbody>${d.plots.map(pl => `<tr>
      <td><b>${esc(pl.plot_no)}</b>${pl.block ? ` <small>${esc(pl.block)}</small>` : ''}</td>
      <td>${pl.area_sqft ? Number(pl.area_sqft).toLocaleString('en-IN') : '—'}</td>
      <td>${pl.rate_sqft ? '₹' + Number(pl.rate_sqft).toLocaleString('en-IN') : '—'}</td>
      <td>${pl.total_price ? rupees(pl.total_price) : '—'}</td>
      <td>${esc(pl.facing || '—')}</td>
      <td><select class="form-control mg-mini plot-st plot-${esc(pl.status)}" data-plot="${Number(pl.id)}" data-on-change="setPlotStatus(this)" aria-label="Status of plot ${esc(pl.plot_no)}">${Object.entries(PLOT_STATUS).map(([k, l]) => `<option value="${k}" ${pl.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><div class="row-actions">${editBtn(`editPlot(${Number(pl.id)})`)}${delBtn(`deletePlot(${Number(pl.id)})`)}</div></td>
    </tr>`).join('')}</tbody></table></div>` : ''}
    <details class="mg-more" ${d.plots.length ? '' : 'open'}><summary>Add plots</summary>
      <div class="mg-grid">
        <label>From no.<input type="number" class="form-control" id="pb-from" min="1" value="1"></label>
        <label>To no.<input type="number" class="form-control" id="pb-to" min="1" value="${d.plots.length ? '' : 10}"></label>
        <label>Prefix<input type="text" class="form-control" id="pb-prefix" maxlength="8" placeholder="e.g. A"></label>
        <label>Block<input type="text" class="form-control" id="pb-block" maxlength="40" placeholder="optional"></label>
        <label>Area (sq ft)<input type="number" class="form-control" id="pb-area" min="0"></label>
        <label>Rate (₹/sq ft)<input type="number" class="form-control" id="pb-rate" min="0"></label>
        <label>Facing<input type="text" class="form-control" id="pb-facing" maxlength="30" placeholder="e.g. East"></label>
        <label>Frontage<input type="text" class="form-control" id="pb-frontage" maxlength="30" placeholder="e.g. 30 ft road"></label>
      </div>
      <button type="button" class="tb-btn tb-btn-or" data-on-click="bulkPlots()">Add plots</button>
      <p class="mg-note">Every plot starts as Available. Change a status in the table; each change is logged with your name.</p>
    </details>
  </section>`;
}

function approvalsSection(d) {
  return `<section class="mg-sec">
    <h4>6 · Approvals <span class="mg-sub">shown on the website only after you review them</span></h4>
    ${d.approvals.length ? `<div class="mg-list">${d.approvals.map(a => `<div class="mg-item">
      <div><b>${esc(APPROVAL_KINDS[a.kind] || a.kind)}</b><span>${esc(a.reference)}${a.authority ? ' · ' + esc(a.authority) : ''}${a.issued_on ? ' · ' + esc(a.issued_on) : ''}${a.document_id ? ' · document #' + Number(a.document_id) : ''}</span>
        <span>${a.reviewed_at ? `✓ Reviewed ${esc(fmtTime(a.reviewed_at))} by ${esc(a.reviewed_by)}` : 'Not reviewed — hidden from the website'}</span></div>
      <label class="mg-pub"><input type="checkbox" data-approval="${Number(a.id)}" data-on-change="toggleApprovalReviewed(this)" ${a.reviewed_at ? 'checked' : ''}> Reviewed</label>
      ${editBtn(`editApproval(${Number(a.id)})`)}${delBtn(`deleteApproval(${Number(a.id)})`)}
    </div>`).join('')}</div>` : ''}
    <details class="mg-more" ${d.approvals.length ? '' : 'open'}><summary>Add an approval</summary>
      <div class="mg-grid">
        <label>Type<select class="form-control" id="ap-kind">${Object.entries(APPROVAL_KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label>Order / registration no.<input type="text" class="form-control" id="ap-ref" maxlength="80"></label>
        <label>Issued by<input type="text" class="form-control" id="ap-auth" maxlength="120" placeholder="e.g. Collector, Pune"></label>
        <label>Issued on<input type="date" class="form-control" id="ap-date"></label>
        <label>Document<select class="form-control" id="ap-doc"><option value="">— none —</option>${d.documents.map(doc => `<option value="${Number(doc.id)}">${esc(doc.title || doc.original_name)}${doc.is_public ? '' : ' (private)'}</option>`).join('')}</select></label>
      </div>
      <button type="button" class="tb-btn tb-btn-or" data-on-click="addApproval()">Add approval</button>
      <p class="mg-note">Tick "Reviewed" only after checking the details against a current copy of the document. A linked document is downloadable only if it is public.</p>
    </details>
  </section>`;
}

async function manageCall(method, path, body, okMsg) {
  try {
    await api(method, path, body);
    if (okMsg) toast(okMsg, 'ok');
    await reloadManage();
    return true;
  } catch (e) { toast(e.message, 'err'); return false; }
}

async function reviewAction(status) {
  const p = allProps.find(x => x.id === manageId);
  let note = '';
  if (status === 'changes') {
    const n = await promptBox({title: 'Ask for corrections', message: `The owner will be emailed and can edit "${p.title}" and send it again.`, label: 'What should be corrected?', placeholder: 'e.g. Please add a photo of the kitchen and the exact carpet area', multiline: true, required: true, confirmText: 'Send to owner'});
    if (n === null) return;
    note = n;
  } else if (status === 'rejected') {
    const n = await promptBox({title: 'Reject this listing?', message: `"${p.title}" will stay hidden from the website${p.owner ? ' and the owner will be emailed' : ''}.`, label: 'Reason (optional)', multiline: true, confirmText: 'Reject', tone: 'danger', icon: 'reject'});
    if (n === null) return;
    note = n;
  } else if (status === 'approved') {
    if (!await confirmBox({title: 'Approve & publish?', message: `"${p.title}" will appear on the website${p.owner ? '. The owner is emailed and the listing stays live for 90 days' : ''}.`, confirmText: 'Approve', tone: 'ok'})) return;
  }
  await manageCall('POST', `/api/admin/properties/${manageId}/review`, {status, note},
    {under_review: 'Review started', changes: 'Corrections requested — owner emailed', approved: 'Listing is live', rejected: 'Listing rejected'}[status]);
}

async function saveListingStatus() {
  const status = document.getElementById('mg-status').value;
  const expires = document.getElementById('mg-expires').value;
  await manageCall('POST', `/api/admin/properties/${manageId}/listing-status`, {status, expires_at: expires}, 'Status saved');
}

async function saveVerify(verified) {
  const scope = [...document.querySelectorAll('.mg-scope:checked')].map(c => c.value);
  if (verified && !scope.length) { toast('Tick what your team checked first', 'err'); return; }
  if (!verified && !await confirmBox({title: 'Remove the verified badge?', message: 'Visitors will no longer see this listing as verified.', confirmText: 'Remove', tone: 'danger', icon: 'reject'})) return;
  await manageCall('POST', `/api/admin/properties/${manageId}/verify`, {verified, scope}, verified ? 'Marked as verified' : 'Badge removed');
}

async function uploadDoc() {
  const file = document.getElementById('mg-doc-file').files[0];
  if (!file) { toast('Choose a PDF, JPG or PNG file', 'err'); return; }
  if (file.size > 10 * 1024 * 1024) { toast('The file must be 10 MB or smaller', 'err'); return; }
  const fd = new FormData();
  fd.append('document', file);
  fd.append('kind', document.getElementById('mg-doc-kind').value);
  fd.append('title', document.getElementById('mg-doc-title').value);
  await manageCall('POST', `/api/admin/properties/${manageId}/documents`, fd, 'Document uploaded (private)');
}

async function toggleDocPublic(box) {
  const id = Number(box.dataset.doc);
  if (box.checked && !await confirmBox({title: 'Publish this document?', message: 'Anyone viewing the listing will be able to download it. Only publish documents you are authorised to share.', confirmText: 'Publish', tone: 'info'})) { box.checked = false; return; }
  await manageCall('PUT', `/api/admin/documents/${id}`, {is_public: box.checked}, box.checked ? 'Document is public' : 'Document is private');
}
async function setDocKind(sel) { await manageCall('PUT', `/api/admin/documents/${Number(sel.dataset.doc)}`, {kind: sel.value}, 'Saved'); }

/** Private documents need the admin token, so they're fetched and opened as a file */
async function downloadDoc(id) {
  try {
    let r = await authFetch(`/api/admin/documents/${id}/file`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not open the document');
    const url = URL.createObjectURL(await r.blob());
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { toast(e.message, 'err'); }
}
async function deleteDoc(id) {
  if (!await confirmBox({title: 'Delete this document?', message: 'The file will be deleted permanently.', confirmText: 'Delete', tone: 'danger'})) return;
  await manageCall('DELETE', `/api/admin/documents/${id}`, undefined, 'Document deleted');
}

async function bulkPlots() {
  const v = id => document.getElementById(id).value.trim();
  await manageCall('POST', `/api/admin/properties/${manageId}/plots/bulk`, {
    from: v('pb-from'), to: v('pb-to'), prefix: v('pb-prefix'), block: v('pb-block'), area_sqft: v('pb-area'), rate_sqft: v('pb-rate'), facing: v('pb-facing'), frontage: v('pb-frontage'),
  }, 'Plots added');
}
async function setPlotStatus(sel) {
  const id = Number(sel.dataset.plot);
  const pl = manageData.plots.find(x => x.id === id);
  const note = sel.value === 'booked' || sel.value === 'sold'
    ? await promptBox({title: `Plot ${pl.plot_no}: ${PLOT_STATUS[sel.value]}`, message: 'This change is logged with your name.', label: 'Note (optional — e.g. booking reference)', confirmText: 'Save'})
    : '';
  if (note === null) { sel.value = pl.status; return; }
  await manageCall('PUT', `/api/admin/plots/${id}`, {status: sel.value, note}, `Plot ${pl.plot_no} is now ${PLOT_STATUS[sel.value].toLowerCase()}`);
}
async function editPlot(id) {
  const pl = manageData.plots.find(x => x.id === id);
  const v = await promptBox({title: `Edit plot ${pl.plot_no}`, message: 'Area, rate, facing, frontage — separate with |. Leave a part empty to clear it.', label: 'Area | Rate | Facing | Frontage',
    placeholder: '1500 | 2500 | East | 30 ft', confirmText: 'Save'});
  if (v === null) return;
  const [area, rate, facing, frontage] = v.split('|').map(x => x.trim());
  await manageCall('PUT', `/api/admin/plots/${id}`, {area_sqft: area, rate_sqft: rate, facing, frontage, total_price: ''}, 'Plot saved');
}
async function deletePlot(id) {
  const pl = manageData.plots.find(x => x.id === id);
  if (!await confirmBox({title: `Delete plot ${pl.plot_no}?`, message: 'It will be removed from the project page.', confirmText: 'Delete', tone: 'danger'})) return;
  await manageCall('DELETE', `/api/admin/plots/${id}`, undefined, 'Plot deleted');
}

async function addApproval() {
  const v = id => document.getElementById(id).value.trim();
  await manageCall('POST', `/api/admin/properties/${manageId}/approvals`, {kind: v('ap-kind'), reference: v('ap-ref'), authority: v('ap-auth'), issued_on: v('ap-date'), document_id: v('ap-doc')}, 'Approval added — tick Reviewed to show it');
}
async function editApproval(id) {
  const a = manageData.approvals.find(x => x.id === id);
  const ref = await promptBox({title: 'Edit approval', message: 'Changing it removes the review; check the document again before ticking Reviewed.', label: 'Order / registration no.', placeholder: a.reference, required: true, confirmText: 'Save'});
  if (ref === null) return;
  await manageCall('PUT', `/api/admin/approvals/${id}`, {...a, reference: ref}, 'Approval saved — review it again');
}
async function toggleApprovalReviewed(box) {
  const id = Number(box.dataset.approval);
  if (box.checked && !await confirmBox({title: 'Mark as reviewed?', message: 'Confirm you checked these details against a current copy of the document. It will then be shown on the website.', confirmText: 'Reviewed', tone: 'ok'})) { box.checked = false; return; }
  await manageCall('POST', `/api/admin/approvals/${id}/review`, {reviewed: box.checked}, box.checked ? 'Shown on the website' : 'Hidden from the website');
}
async function deleteApproval(id) {
  if (!await confirmBox({title: 'Delete this approval?', message: 'It will be removed from the project page.', confirmText: 'Delete', tone: 'danger'})) return;
  await manageCall('DELETE', `/api/admin/approvals/${id}`, undefined, 'Approval deleted');
}

// ── Reported listings ─────────────────────────────────────────────────────
let allReports = [], repFilter = 'open';
async function loadReports() {
  const {data} = await api('GET', '/api/admin/reports');
  allReports = data;
  renderReports();
}
const REPORT_STATUS = {open: 'Open', resolved: 'Resolved', dismissed: 'Dismissed'};
function renderReports() {
  document.querySelectorAll('#rep-filters .filter-btn').forEach(b => {
    b.classList.toggle('on', b.dataset.status === repFilter);
    const n = b.dataset.status ? allReports.filter(r => r.status === b.dataset.status).length : allReports.length;
    b.textContent = `${b.dataset.status ? REPORT_STATUS[b.dataset.status] : 'All'} (${n})`;
  });
  const rows = allReports.filter(r => !repFilter || r.status === repFilter);
  document.getElementById('reports-tbody').innerHTML = rows.length ? rows.map(r => `<tr>
    <td>${r.property_title ? `<a href="#" class="plain-link" data-on-click="openManageFromReport(${Number(r.property_id)});return false">${esc(r.property_title)}</a>` : '<span class="muted">Deleted listing</span>'}</td>
    <td><b>${esc(r.reason)}</b>${r.details ? `<div class="lead-msg" title="${esc(r.details)}">${esc(r.details)}</div>` : ''}</td>
    <td>${r.email ? `<a class="plain-link" href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '<span class="muted">Anonymous</span>'}</td>
    <td class="lead-time">${leadWhen(r)}</td>
    <td><span class="review-pill review-${r.status === 'open' ? 'pending' : r.status === 'resolved' ? 'approved' : 'rejected'}">${REPORT_STATUS[r.status]}</span>${r.admin_note ? `<div class="lead-msg">${esc(r.admin_note)}</div>` : ''}</td>
    <td><div class="row-actions">${r.status === 'open'
      ? `<button type="button" class="act-btn act-ok" data-on-click="decideReport(${Number(r.id)},'resolved')">${ICON_OK}<span>Resolve</span></button><button type="button" class="act-btn" data-on-click="decideReport(${Number(r.id)},'dismissed')">Dismiss</button>`
      : `<button type="button" class="act-btn" data-on-click="decideReport(${Number(r.id)},'open')">Reopen</button>`}</div></td>
  </tr>`).join('') : `<tr><td colspan="6"><div class="empty"><div class="empty-icon">🚩</div><p>${repFilter === 'open' ? 'No open reports.' : 'Nothing here.'}</p></div></td></tr>`;
}
document.querySelectorAll('#rep-filters .filter-btn').forEach(b => { b.onclick = () => { repFilter = b.dataset.status; renderReports(); }; });

async function decideReport(id, status, fromManage = false) {
  let note = '';
  if (status !== 'open') {
    const n = await promptBox({title: status === 'resolved' ? 'Resolve this report?' : 'Dismiss this report?', message: status === 'resolved' ? 'Use this once the listing has been corrected, marked sold or removed.' : 'Use this when the listing was already correct.', label: 'Note (optional)', confirmText: status === 'resolved' ? 'Resolve' : 'Dismiss', tone: status === 'resolved' ? 'ok' : 'info'});
    if (n === null) return;
    note = n;
  }
  try {
    await api('POST', `/api/admin/reports/${id}`, {status, note});
    toast(`Report ${status === 'open' ? 'reopened' : status}`, 'ok');
    refreshBadges();
    if (fromManage) await reloadManage();
    else await loadReports();
  } catch (e) { toast(e.message, 'err'); }
}

async function openManageFromReport(propertyId) {
  if (!allProps.length) await loadProps().catch(() => {});
  openManage(propertyId);
}

// ── Email (SMTP) settings ─────────────────────────────────────────────────
const MAIL_PRESETS = {
  gmail: {host: 'smtp.gmail.com', port: 465, secure: '1'},
  outlook: {host: 'smtp.office365.com', port: 587, secure: '0'},
  zoho: {host: 'smtp.zoho.in', port: 465, secure: '1'},
  bluehost: {host: 'mail.yourdomain.com', port: 465, secure: '1'},
};
const mailEl = id => document.getElementById('mail-' + id);
function mailError(field, msg) {
  const el = document.getElementById(`mail-${field}-err`);
  if (el) { el.textContent = msg || ''; el.classList.toggle('show', !!msg); }
}

async function loadMailSettings() {
  const {data} = await api('GET', '/api/admin/mail-settings');
  mailEl('host').value = data.host;
  mailEl('port').value = data.port;
  mailEl('secure').value = data.secure ? '1' : '0';
  mailEl('user').value = data.user;
  mailEl('pass').value = '';
  mailEl('pass').placeholder = data.has_password ? '•••••••• saved — leave empty to keep it' : 'Enter the password';
  mailEl('from').value = data.from;
  mailEl('admin').value = data.admin_email;
  mailEl('preset').value = '';
  mailEl('test-to').value ||= data.admin_email || data.user || '';
  mailEl('reset').hidden = data.source !== 'admin';
  ['host', 'port', 'from', 'admin_email'].forEach(f => mailError(f, ''));
  mailEl('status').className = 'mail-status ' + (data.configured ? 'ok' : 'off');
  mailEl('status').textContent = data.configured
    ? `Sending through ${data.host} as ${data.from || data.user} — settings from ${data.source === 'admin' ? 'this page' : 'the .env file'}.`
    : 'Not set up: emails (password reset, approvals) are only saved on the server and not sent.';
}

mailEl('preset').onchange = e => {
  const p = MAIL_PRESETS[e.target.value];
  if (!p) return;
  mailEl('host').value = p.host;
  mailEl('port').value = p.port;
  mailEl('secure').value = p.secure;
  if (e.target.value === 'bluehost') { mailEl('host').focus(); mailEl('host').select(); toast('Replace "yourdomain.com" with your domain', 'ok'); }
};
// Port and security go together: 465 = SSL, 587 = STARTTLS
mailEl('secure').onchange = e => { mailEl('port').value = e.target.value === '1' ? 465 : 587; };

document.getElementById('mail-form').onsubmit = async e => {
  e.preventDefault();
  ['host', 'port', 'from', 'admin_email'].forEach(f => mailError(f, ''));
  const user = mailEl('user').value.trim();
  const body = {
    host: mailEl('host').value.trim(), port: mailEl('port').value, secure: mailEl('secure').value === '1',
    user, pass: mailEl('pass').value, from: mailEl('from').value.trim() || (user ? `Landroof <${user}>` : ''),
    admin_email: mailEl('admin').value.trim(),
  };
  if (!body.host) { mailError('host', 'Enter the SMTP server, or choose a provider above'); mailEl('host').focus(); return; }
  const btn = mailEl('save');
  btn.disabled = true;
  try {
    await api('PUT', '/api/admin/mail-settings', body);
    toast('Email settings saved. Send a test to check them.', 'ok');
    await loadMailSettings();
  } catch (ex) {
    if (ex.fields) Object.entries(ex.fields).forEach(([f, m]) => mailError(f, m));
    toast(ex.message, 'err');
  } finally { btn.disabled = false; }
};

mailEl('reset').onclick = async () => {
  if (!await confirmBox({title: 'Use the .env settings?', message: 'The settings saved on this page (including the password) will be deleted. Emails will use SMTP_* from the server\'s .env file, or only be saved on the server if that is empty.', confirmText: 'Use .env', tone: 'danger'})) return;
  try { await api('DELETE', '/api/admin/mail-settings'); toast('Now using the .env settings', 'ok'); loadMailSettings(); }
  catch (ex) { toast(ex.message, 'err'); }
};

mailEl('test-btn').onclick = async () => {
  const to = mailEl('test-to').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { toast('Enter the email address to send the test to', 'err'); mailEl('test-to').focus(); return; }
  const btn = mailEl('test-btn');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await api('POST', '/api/admin/mail-settings/test', {to});
    toast(`Test email sent to ${to}. Check the inbox (and Spam).`, 'ok');
  } catch (ex) {
    await confirmBox({title: 'Test email failed', message: ex.message + (/auth|535|534|Username and Password/i.test(ex.message) ? ' — check the username and app password.' : ''), confirmText: 'OK', cancelText: 'Close', tone: 'danger', icon: 'reject'});
  } finally { btn.disabled = false; btn.textContent = 'Send Test'; }
};

// ── Site config ────────────────────────────────────────────────────────────
const cfgInputs = () => [...document.querySelectorAll('[id^="cfg-"]')];

async function loadSiteConfig() {
  const {data} = await api('GET', '/api/admin/site-config');
  cfgInputs().forEach(el => { el.value = data[el.id.slice(4)] ?? ''; });
}

document.getElementById('save-config-btn').onclick = async () => {
  const body = {};
  cfgInputs().forEach(el => { body[el.id.slice(4)] = el.value.trim(); });
  const btn = document.getElementById('save-config-btn');
  btn.disabled = true;
  try {
    const {data} = await api('PUT', '/api/admin/site-config', body);
    cfgInputs().forEach(el => { el.value = data[el.id.slice(4)] ?? ''; });
    toast('Site numbers saved — the website now shows them', 'ok');
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
};

// ── Change password ────────────────────────────────────────────────────────
const pwFields = ['current', 'new', 'confirm'];

function pwError(field, msg) {
  document.getElementById(`pw-${field}`).classList.toggle('bad', !!msg);
  const el = document.getElementById(`pw-${field}-err`);
  el.textContent = msg || '';
  el.classList.toggle('show', !!msg);
}

function resetPasswordForm() {
  document.getElementById('pw-form').reset();
  document.getElementById('pw-username').value = ADMIN_NAME;
  pwFields.forEach(f => pwError(f, ''));
}

document.getElementById('pw-form').onsubmit = async e => {
  e.preventDefault();
  const val = f => document.getElementById(`pw-${f}`).value;
  pwFields.forEach(f => pwError(f, ''));
  const errs = {};
  if (!val('current')) errs.current = 'Enter your current password';
  if (val('new').length < 12) errs.new = 'Use at least 12 characters';
  else if (!/[A-Za-z]/.test(val('new')) || !/\d/.test(val('new'))) errs.new = 'Use both letters and numbers';
  if (val('confirm') !== val('new')) errs.confirm = 'Passwords do not match';
  if (Object.keys(errs).length) {
    Object.entries(errs).forEach(([f, m]) => pwError(f, m));
    document.getElementById(`pw-${Object.keys(errs)[0]}`).focus();
    return;
  }
  const btn = document.getElementById('pw-submit');
  btn.disabled = true;
  try {
    const j = await api('POST', '/api/admin/auth/change-password', {currentPassword: val('current'), newPassword: val('new')});
    acceptTokens(j); // the old tokens stopped working with the old password
    resetPasswordForm();
    toast('Password updated. Use the new password next time you sign in.', 'ok');
  } catch (ex) {
    const map = {currentPassword: 'current', newPassword: 'new'};
    const named = Object.entries(ex.fields || {}).filter(([k]) => map[k]);
    named.forEach(([k, m]) => pwError(map[k], m));
    if (named.length) document.getElementById(`pw-${map[named[0][0]]}`).focus();
    else toast(ex.message, 'err');
  } finally { btn.disabled = false; }
};

// ── Utilities ──────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
// The database stores UTC ("2026-10-27 07:45:53") — show it in the admin's local time
function fmtDate(dt) {
  if (!dt) return '—';
  const d = new Date(String(dt).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(dt) ? '' : 'Z'));
  if (isNaN(d)) return esc(dt);
  return d.toLocaleString('en-IN', {day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});
}
function fmtDay(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return isNaN(dt) ? d : dt.toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'});
}
const TOAST_ICONS = {
  ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  err: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9.5"/></svg>',
};
let toastTimer;
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-ico">${TOAST_ICONS[type] || TOAST_ICONS.ok}</span><span class="toast-msg"></span><span class="toast-bar"></span>`;
  el.querySelector('.toast-msg').textContent = msg;
  el.setAttribute('role', type === 'err' ? 'alert' : 'status');
  void el.offsetWidth; // restart the slide-in and progress animation
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

// ── Styled dialogs (instead of the browser's confirm / prompt) ─────────────
const DIALOG_ICONS = {
  danger: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>',
  ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v5M12 7.5v.5"/></svg>',
  reject: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};
let dialogClose = null;

/**
 * Opens a dialog. Resolves true/false (confirm) or the typed text / null (when opts.label is set).
 * opts: title, message, confirmText, cancelText, tone ('danger' | 'ok' | 'info'), icon (defaults to the tone's),
 *       label, placeholder, type, multiline, required
 */
function dialogBox(opts) {
  if (dialogClose) dialogClose(false, false);
  const tone = opts.tone || 'info';
  const asks = !!opts.label;
  const wrap = document.createElement('div');
  wrap.className = 'dlg-overlay';
  wrap.innerHTML = `<div class="dlg dlg-${tone}" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-msg">
    <div class="dlg-ico">${DIALOG_ICONS[opts.icon || tone] || DIALOG_ICONS.info}</div>
    <h3 class="dlg-title" id="dlg-title"></h3>
    <p class="dlg-msg" id="dlg-msg"></p>
    ${asks ? `<label class="dlg-label" for="dlg-input"></label>${opts.multiline
      ? '<textarea class="form-control dlg-input" id="dlg-input" rows="3" maxlength="300"></textarea>'
      : `<input class="form-control dlg-input" id="dlg-input" type="${opts.type === 'email' ? 'email' : 'text'}" maxlength="254">`}<div class="dlg-err" id="dlg-err"></div>` : ''}
    <div class="dlg-actions">
      <button type="button" class="dlg-btn dlg-cancel"></button>
      <button type="button" class="dlg-btn dlg-confirm"></button>
    </div>
  </div>`;
  wrap.querySelector('.dlg-title').textContent = opts.title || 'Are you sure?';
  wrap.querySelector('.dlg-msg').textContent = opts.message || '';
  wrap.querySelector('.dlg-cancel').textContent = opts.cancelText || 'Cancel';
  wrap.querySelector('.dlg-confirm').textContent = opts.confirmText || 'OK';
  const input = wrap.querySelector('.dlg-input');
  if (input) {
    wrap.querySelector('.dlg-label').textContent = opts.label;
    input.placeholder = opts.placeholder || '';
  }
  document.body.appendChild(wrap);
  const opener = document.activeElement;
  pushLayer();
  requestAnimationFrame(() => wrap.classList.add('show'));
  (input || wrap.querySelector('.dlg-confirm')).focus();

  return new Promise(resolve => {
    const finish = (confirmed, fromBack) => {
      dialogClose = null;
      wrap.classList.remove('show');
      setTimeout(() => wrap.remove(), 200);
      if (!fromBack) popLayer();
      if (opener?.isConnected) opener.focus({preventScroll: true});
      resolve(asks ? (confirmed ? input.value.trim() : null) : confirmed);
    };
    dialogClose = finish;
    const confirm = () => {
      if (asks && opts.required) {
        const v = input.value.trim();
        const bad = !v || (opts.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
        if (bad) {
          wrap.querySelector('.dlg-err').textContent = opts.type === 'email' ? 'Enter a valid email address' : 'This field is required';
          input.focus();
          return;
        }
      }
      finish(true, false);
    };
    wrap.querySelector('.dlg-confirm').onclick = confirm;
    wrap.querySelector('.dlg-cancel').onclick = () => finish(false, false);
    wrap.addEventListener('click', e => { if (e.target === wrap) finish(false, false); });
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false, false); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !e.target.classList.contains('dlg-cancel')) { e.preventDefault(); confirm(); }
      else if (e.key === 'Tab') { // keep focus inside the dialog
        const f = [...wrap.querySelectorAll('input, textarea, button')];
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
  });
}
const confirmBox = opts => dialogBox(opts);
const promptBox = opts => dialogBox({tone: 'info', ...opts});

// ── Start ──────────────────────────────────────────────────────────────────
// Restore the session silently from the refresh cookie; otherwise show the login form
refreshSession().then(ok => { if (ok) { loginOverlay.style.display = "none"; init(); } });

// ── Functions callable from data-on-* attributes (see /js/actions.js) ─────
LRActions.register({ clearOwnerFilter, closeGenericDrawer, decideRequest, deleteContent, deleteLead, deleteProp, markImageRemoved, openEdit, openGenericDrawer, previewImg, resendLink, reviewProp, showOwnerProps,
  openManage, closeManage, reviewAction, saveListingStatus, saveVerify, uploadDoc, toggleDocPublic, setDocKind, downloadDoc, deleteDoc,
  bulkPlots, setPlotStatus, editPlot, deletePlot, addApproval, editApproval, toggleApprovalReviewed, deleteApproval,
  decideReport, openManageFromReport, toggleGalleryPhoto });
