'use strict';
const Property = require('../models/Property');
const User = require('../models/User');
const ListingEvent = require('../models/ListingEvent');
const ListingReport = require('../models/ListingReport');
const PropertyDocument = require('../models/PropertyDocument');
const Plot = require('../models/Plot');
const ProjectApproval = require('../models/ProjectApproval');
const { discardFiles } = require('../middleware/upload');
const { applyListingFiles, removeListing } = require('../services/listingFiles');

// Who listed it, as shown to visitors. An owner's phone and email are never shown:
// enquiries go through Landroof, which passes them on.
function lister(p) {
  if (p.listed_by === 'owner') {
    const u = p.owner_id && User.findById(p.owner_id);
    const [first = 'Owner', last = ''] = String(u?.name || '').trim().split(/\s+/);
    return { kind: 'owner', name: `${first}${last ? ' ' + last[0] + '.' : ''}`, note: 'Property owner · email verified by Landroof' };
  }
  if (p.listed_by === 'developer') return { kind: 'developer', name: p.developer_name || 'Developer', note: 'Developer / builder' };
  if (p.listed_by === 'agent') return { kind: 'agent', name: p.developer_name || 'Partner agent', note: 'Channel partner' };
  return { kind: 'landroof', name: 'Landroof Buildcon', note: 'Listed and managed by Landroof' };
}

const publicDocs = id => PropertyDocument.forProperty(id, { publicOnly: true }).map(PropertyDocument.publicView);

// ── Public ──────────────────────────────────────────────────────────────
exports.list = (req, res) => {
  const { data, total } = Property.searchPage(req.query);
  res.json({ ok: true, data: data.map(Property.publicJSON), total });
};

exports.show = (req, res) => {
  const p = Property.findLive(req.params.id);
  if (!p) return res.status(404).json({ error: 'Property not found' });
  const docs = publicDocs(p.id);
  const publicDocIds = new Set(docs.map(d => d.id));
  const approvals = ProjectApproval.forProperty(p.id, { reviewedOnly: true }).map(a => ({
    ...ProjectApproval.publicView(a),
    document_url: a.document_id && publicDocIds.has(a.document_id) ? `/api/documents/${a.document_id}` : null,
  }));
  res.json({
    ok: true,
    data: {
      ...Property.publicJSON(p),
      lister: lister(p),
      documents: docs,
      approvals,
      plot_counts: p.is_project ? Plot.counts(p.id) : null,
    },
  });
};

exports.similar = (req, res) => {
  const p = Property.findLive(req.params.id);
  if (!p) return res.status(404).json({ error: 'Property not found' });
  res.json({ ok: true, data: Property.similar(p).map(Property.publicJSON) });
};

exports.plots = (req, res) => {
  const p = Property.findLive(req.params.id);
  if (!p) return res.status(404).json({ error: 'Property not found' });
  res.json({ ok: true, data: Plot.forProperty(p.id).map(Plot.publicView), counts: Plot.counts(p.id) });
};

exports.cityCounts = (_req, res) => {
  res.json({ ok: true, data: Property.cityCounts() });
};

exports.suggestions = (req, res) => {
  res.json({ ok: true, data: Property.suggestions({ city: String(req.query.city || '').slice(0, 80), type: String(req.query.type || '') }) });
};

/** POST /api/properties/:id/report {reason, details, email?} */
exports.report = (req, res) => {
  const p = Property.findLive(req.params.id);
  if (!p) return res.status(404).json({ error: 'Property not found' });
  const { data, error, fields } = ListingReport.validate(req.body);
  if (error) return res.status(400).json({ error, fields });
  ListingReport.create(p.id, data, req.ip);
  res.json({ ok: true });
};

/** GET /api/documents/:id — only documents an admin published, of a listing that is on the website */
exports.publicDocument = (req, res) => {
  const doc = PropertyDocument.find(req.params.id);
  if (!doc || !doc.is_public || !Property.findLive(doc.property_id)) return res.status(404).json({ error: 'Document not found' });
  sendDocument(res, doc, true);
};

function sendDocument(res, doc, inline) {
  const name = String(doc.original_name || `document-${doc.id}`).replace(/[^\w.\- ]+/g, '_');
  res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(PropertyDocument.filePath(doc.filename), err => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Document file is missing' });
  });
}
exports.sendDocument = sendDocument;

// ── Admin ───────────────────────────────────────────────────────────────
const adminActor = req => `admin:${req.auth.sub}`;

exports.adminList = (_req, res) => {
  // Every listing, including drafts and ones waiting for review, with the owner who added it
  const owners = {};
  const reports = {};
  ListingReport.list('open').forEach(r => { reports[r.property_id] = (reports[r.property_id] || 0) + 1; });
  const data = Property.search({ limit: 500, sort: 'newest' }, { all: true }).map(p => {
    if (p.owner_id && !(p.owner_id in owners)) {
      const u = User.findById(p.owner_id);
      owners[p.owner_id] = u ? { id: u.id, name: u.name, email: u.email, phone: u.phone } : null;
    }
    return { ...p, owner: p.owner_id ? owners[p.owner_id] : null, open_reports: reports[p.id] || 0 };
  });
  res.json({ ok: true, data });
};

exports.create = (req, res) => {
  const { data, error, fields } = Property.validate(req.body, false);
  if (error) { discardFiles(req); return res.status(400).json({ error, fields }); }
  const created = Property.create(data);
  applyListingFiles(req, created.id, null, adminActor(req));
  ListingEvent.record(created.id, adminActor(req), 'admin.create', { to: 'approved', note: 'Added from the admin panel' });
  res.locals.createdId = created.id;
  res.json({ ok: true, id: created.id, data: Property.find(created.id) });
};

exports.update = (req, res) => {
  const existing = Property.find(req.params.id);
  if (!existing) { discardFiles(req); return res.status(404).json({ error: 'Property not found' }); }
  const { data, error, fields } = Property.validate(req.body, true);
  if (error) { discardFiles(req); return res.status(400).json({ error, fields }); }
  Property.update(existing.id, data);
  applyListingFiles(req, existing.id, existing, adminActor(req));
  ListingEvent.record(existing.id, adminActor(req), 'admin.edit');
  res.json({ ok: true, data: Property.find(existing.id) });
};

exports.remove = (req, res) => {
  const row = removeListing(req.params.id);
  if (!row) return res.status(404).json({ error: 'Property not found' });
  res.json({ ok: true });
};
