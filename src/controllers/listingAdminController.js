'use strict';
// Admin: review workflow, verification, listing status, documents, plot inventory, approvals and reports.
// Every change is written to the listing's history (listing_events) as well as the admin activity log.
const Property = require('../models/Property');
const User = require('../models/User');
const ListingEvent = require('../models/ListingEvent');
const ListingReport = require('../models/ListingReport');
const PropertyDocument = require('../models/PropertyDocument');
const Plot = require('../models/Plot');
const ProjectApproval = require('../models/ProjectApproval');
const Mailer = require('../services/mailer');
const { sendDocument } = require('./propertyController');
const { discardFiles } = require('../middleware/upload');
const { str } = require('../utils/validators');

const OWNER_LISTING_DAYS = 90; // an owner's listing stays live this long, then expires unless renewed
const actor = req => `admin:${req.auth.sub}`;
const sqlTime = d => d.toISOString().replace('T', ' ').slice(0, 19);
const daysFromNow = n => sqlTime(new Date(Date.now() + n * 864e5));

function load(req, res) {
  const p = Property.find(req.params.id);
  if (!p) res.status(404).json({ error: 'Property not found' });
  return p;
}

// What the verification badge covers; shown to visitors next to the badge
const VERIFY_SCOPES = ['Site visited by our team', 'Photos match the property', 'Owner identity checked', 'Ownership documents seen'];

/** GET /api/admin/properties/:id/details — history, documents, plots, approvals and possible duplicates */
exports.details = (req, res) => {
  const p = load(req, res);
  if (!p) return;
  const dupIds = String(p.duplicate_of || '').split(',').map(Number).filter(Boolean);
  res.json({
    ok: true,
    data: {
      events: ListingEvent.forProperty(p.id),
      documents: PropertyDocument.forProperty(p.id).map(d => ({ ...d, filename: undefined })),
      plots: Plot.forProperty(p.id),
      plot_counts: Plot.counts(p.id),
      approvals: ProjectApproval.forProperty(p.id),
      duplicates: dupIds.map(id => Property.find(id)).filter(Boolean).map(d => ({ id: d.id, title: d.title, listing_code: d.listing_code, review_status: d.review_status })),
      reports: ListingReport.list().filter(r => r.property_id === p.id),
      verify_scopes: VERIFY_SCOPES,
    },
  });
};

/** POST /api/admin/properties/:id/review {status: under_review | changes | approved | rejected, note} */
exports.review = (req, res) => {
  const p = load(req, res);
  if (!p) return;
  const status = req.body?.status;
  if (!['under_review', 'changes', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Choose a review decision' });
  const note = str(req.body?.note, 500) || null;
  if (status === 'changes' && !note) return res.status(400).json({ error: 'Write what the owner should correct', fields: { note: 'Write what the owner should correct' } });

  const set = { review_status: status, review_note: ['changes', 'rejected'].includes(status) ? note : null };
  if (status === 'approved') {
    set.published_at = p.published_at || sqlTime(new Date());
    if (p.listing_status !== 'active' && ['expired', 'withdrawn'].includes(p.listing_status)) set.listing_status = 'active';
    if (p.owner_id && (!p.expires_at || new Date(p.expires_at.replace(' ', 'T') + 'Z') < new Date())) set.expires_at = daysFromNow(OWNER_LISTING_DAYS);
  }
  const updated = Property.update(p.id, set);
  ListingEvent.record(p.id, actor(req), `review.${status}`, { from: p.review_status, to: status, note });

  const owner = p.owner_id && status !== 'under_review' && User.findById(p.owner_id);
  if (owner) Mailer.propertyReviewed(owner.email, owner.name, updated, status);
  res.json({ ok: true, data: updated });
};

/** POST /api/admin/properties/:id/verify {verified, scope: [..]} — only staff can mark a listing verified */
exports.verify = (req, res) => {
  const p = load(req, res);
  if (!p) return;
  const verified = !!req.body?.verified;
  const scope = (Array.isArray(req.body?.scope) ? req.body.scope : []).filter(s => VERIFY_SCOPES.includes(s));
  if (verified && !scope.length) return res.status(400).json({ error: 'Tick what your team checked — the badge explains it to visitors' });
  const updated = Property.update(p.id, verified
    ? { verified_at: sqlTime(new Date()), verified_by: req.auth.sub, verify_scope: scope.join('; ') }
    : { verified_at: null, verified_by: null, verify_scope: null });
  ListingEvent.record(p.id, actor(req), verified ? 'verified' : 'verification.removed', { note: verified ? scope.join('; ') : null });
  res.json({ ok: true, data: updated });
};

/** POST /api/admin/properties/:id/listing-status {status, expires_at?} — sold / rented / expired / withdrawn / active */
exports.listingStatus = (req, res) => {
  const p = load(req, res);
  if (!p) return;
  const status = req.body?.status;
  if (!Property.LISTING_STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown listing status' });
  const set = { listing_status: status };
  const exp = str(req.body?.expires_at, 10);
  if (exp) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) return res.status(400).json({ error: 'Enter the end date as YYYY-MM-DD' });
    set.expires_at = `${exp} 23:59:59`;
  } else if (req.body?.expires_at === '') set.expires_at = null;
  // Re-activating an expired listing needs a future end date (or none)
  if (status === 'active' && p.expires_at && !exp && req.body?.expires_at !== '' && new Date(p.expires_at.replace(' ', 'T') + 'Z') < new Date()) {
    set.expires_at = daysFromNow(OWNER_LISTING_DAYS);
  }
  const updated = Property.update(p.id, set);
  ListingEvent.record(p.id, actor(req), 'listing.status', { from: p.listing_status, to: status, note: set.expires_at ? `Ends ${set.expires_at.slice(0, 10)}` : null });
  res.json({ ok: true, data: updated });
};

// ── Documents (private by default) ─────────────────────────────────────────
exports.uploadDocument = (req, res) => {
  const p = Property.find(req.params.id);
  if (!p) { discardFiles(req); return res.status(404).json({ error: 'Property not found' }); }
  if (!req.file) return res.status(400).json({ error: 'Choose a PDF, JPG or PNG file' });
  const doc = PropertyDocument.create({ propertyId: p.id, kind: req.body?.kind, title: req.body?.title, file: req.file, uploadedBy: actor(req) });
  ListingEvent.record(p.id, actor(req), 'document.added', { note: doc.title });
  res.json({ ok: true, data: { ...doc, filename: undefined } });
};

/** PUT /api/admin/documents/:docId {is_public, title, kind} */
exports.updateDocument = (req, res) => {
  const before = PropertyDocument.find(req.params.docId);
  if (!before) return res.status(404).json({ error: 'Document not found' });
  const doc = PropertyDocument.update(before.id, req.body || {});
  if (before.is_public !== doc.is_public) {
    ListingEvent.record(doc.property_id, actor(req), doc.is_public ? 'document.published' : 'document.unpublished', { note: doc.title });
  }
  res.json({ ok: true, data: { ...doc, filename: undefined } });
};

exports.deleteDocument = (req, res) => {
  const doc = PropertyDocument.remove(req.params.docId);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  ListingEvent.record(doc.property_id, actor(req), 'document.deleted', { note: doc.title });
  res.json({ ok: true });
};

/** GET /api/admin/documents/:docId/file — staff download (always as an attachment) */
exports.downloadDocument = (req, res) => {
  const doc = PropertyDocument.find(req.params.docId);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  sendDocument(res, doc, false);
};

// ── Plot inventory ─────────────────────────────────────────────────────────
const PLOT_LABEL = { available: 'Available', hold: 'On hold', booked: 'Booked', sold: 'Sold' };

exports.createPlot = (req, res) => {
  const p = load(req, res);
  if (!p) return;
  const { data, error } = Plot.clean(req.body);
  if (error) return res.status(400).json({ error });
  const plot = Plot.create(p.id, data);
  if (!p.is_project) Property.update(p.id, { is_project: 1 });
  ListingEvent.record(p.id, actor(req), 'plot.added', { to: plot.status, note: `Plot ${plot.plot_no}` });
  res.json({ ok: true, data: plot });
};

/** POST /api/admin/properties/:id/plots/bulk {from, to, prefix?, block?, area_sqft?, rate_sqft?} — adds plots from..to */
exports.bulkPlots = (req, res) => {
  const p = load(req, res);
  if (!p) return;
  const from = parseInt(req.body?.from, 10), to = parseInt(req.body?.to, 10);
  if (!(from >= 1 && to >= from && to - from < 500)) return res.status(400).json({ error: 'Enter a plot range, e.g. 1 to 40 (up to 500 plots)' });
  const existing = new Set(Plot.forProperty(p.id).map(x => `${x.block || ''}|${x.plot_no}`));
  const prefix = str(req.body?.prefix, 8);
  let added = 0;
  for (let n = from; n <= to; n++) {
    const { data } = Plot.clean({ ...req.body, plot_no: `${prefix}${n}`, status: 'available' });
    if (existing.has(`${data.block || ''}|${data.plot_no}`)) continue;
    Plot.create(p.id, data);
    added++;
  }
  if (!p.is_project) Property.update(p.id, { is_project: 1 });
  ListingEvent.record(p.id, actor(req), 'plot.bulk_added', { note: `${added} plots (${prefix}${from}–${prefix}${to})` });
  res.json({ ok: true, added });
};

exports.updatePlot = (req, res) => {
  const plot = Plot.find(req.params.plotId);
  if (!plot) return res.status(404).json({ error: 'Plot not found' });
  const { data, error } = Plot.clean(req.body, true);
  if (error) return res.status(400).json({ error });
  const updated = Plot.update(plot.id, data);
  if (updated.status !== plot.status) {
    ListingEvent.record(plot.property_id, actor(req), 'plot.status', { from: plot.status, to: updated.status,
      note: `Plot ${updated.plot_no}: ${PLOT_LABEL[plot.status]} → ${PLOT_LABEL[updated.status]}${req.body?.note ? ' · ' + str(req.body.note, 200) : ''}` });
  } else {
    ListingEvent.record(plot.property_id, actor(req), 'plot.edited', { note: `Plot ${updated.plot_no}` });
  }
  res.json({ ok: true, data: updated });
};

exports.deletePlot = (req, res) => {
  const plot = Plot.find(req.params.plotId);
  if (!plot || !Plot.remove(plot.id)) return res.status(404).json({ error: 'Plot not found' });
  ListingEvent.record(plot.property_id, actor(req), 'plot.deleted', { note: `Plot ${plot.plot_no}` });
  res.json({ ok: true });
};

// ── Approvals (NA, land-use, layout, MahaRERA) ─────────────────────────────
exports.createApproval = (req, res) => {
  const p = load(req, res);
  if (!p) return;
  const { data, error } = ProjectApproval.clean(req.body);
  if (error) return res.status(400).json({ error });
  const a = ProjectApproval.create(p.id, data);
  ListingEvent.record(p.id, actor(req), 'approval.added', { note: `${ProjectApproval.KINDS[a.kind]} ${a.reference}` });
  res.json({ ok: true, data: a });
};

exports.updateApproval = (req, res) => {
  const a = ProjectApproval.find(req.params.approvalId);
  if (!a) return res.status(404).json({ error: 'Approval not found' });
  const { data, error } = ProjectApproval.clean(req.body);
  if (error) return res.status(400).json({ error });
  const updated = ProjectApproval.update(a.id, data);
  ListingEvent.record(a.property_id, actor(req), 'approval.edited', { note: `${ProjectApproval.KINDS[updated.kind]} ${updated.reference} — needs review again` });
  res.json({ ok: true, data: updated });
};

/** POST /api/admin/approvals/:approvalId/review {reviewed} — only reviewed approvals appear on the website */
exports.reviewApproval = (req, res) => {
  const a = ProjectApproval.find(req.params.approvalId);
  if (!a) return res.status(404).json({ error: 'Approval not found' });
  const updated = ProjectApproval.setReviewed(a.id, !!req.body?.reviewed, req.auth.sub);
  ListingEvent.record(a.property_id, actor(req), req.body?.reviewed ? 'approval.reviewed' : 'approval.unreviewed', { note: `${ProjectApproval.KINDS[a.kind]} ${a.reference}` });
  res.json({ ok: true, data: updated });
};

exports.deleteApproval = (req, res) => {
  const a = ProjectApproval.find(req.params.approvalId);
  if (!a || !ProjectApproval.remove(a.id)) return res.status(404).json({ error: 'Approval not found' });
  ListingEvent.record(a.property_id, actor(req), 'approval.deleted', { note: `${ProjectApproval.KINDS[a.kind]} ${a.reference}` });
  res.json({ ok: true });
};

// ── Reports from visitors ──────────────────────────────────────────────────
exports.reports = (req, res) => res.json({ ok: true, data: ListingReport.list(String(req.query.status || '')) });

/** POST /api/admin/reports/:id {status: resolved | dismissed | open, note} */
exports.decideReport = (req, res) => {
  const r = ListingReport.decide(req.params.id, req.body?.status, req.body?.note);
  if (!r) return res.status(400).json({ error: 'Report not found or unknown status' });
  ListingEvent.record(r.property_id, actor(req), `report.${r.status}`, { note: `${r.reason}${r.admin_note ? ' — ' + r.admin_note : ''}` });
  res.json({ ok: true, data: r });
};

exports.VERIFY_SCOPES = VERIFY_SCOPES;
exports.OWNER_LISTING_DAYS = OWNER_LISTING_DAYS;
