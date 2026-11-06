'use strict';
// Property owners: visitors whose "List your property" request an admin approved.
// They add and manage their own listings from the website. A listing can be saved as a draft;
// once submitted it waits for an admin review (draft → submitted → under review → approved / rejected /
// corrections asked) before it appears on the site. Owners can mark a live listing sold, rented or withdrawn.
const Property = require('../models/Property');
const ListingRequest = require('../models/ListingRequest');
const ListingEvent = require('../models/ListingEvent');
const PropertyDocument = require('../models/PropertyDocument');
const Mailer = require('../services/mailer');
const { adminEmail } = require('../services/notify');
const { discardFiles } = require('../middleware/upload');
const { applyListingFiles, removeListing } = require('../services/listingFiles');

const MAX_LISTINGS = 50;
const actor = req => `owner:${req.user.id}`;

// Fields an owner may set (featuring, verification and project settings are the admin's decision)
function ownerData(data) {
  const out = { ...data };
  Property.ADMIN_ONLY.forEach(k => delete out[k]);
  return out;
}

/** Mandatory details before a listing can be sent for review. Returns { field: message }. */
function missingForReview(p, hasPhoto) {
  const m = {};
  if (!p.subtype) m.subtype = 'Choose the property type';
  if (!(p.price_val > 0)) m.price_val = 'Enter the price in ₹ (numbers only)';
  if (!p.locality) m.locality = 'Enter the locality';
  if (!Property.parseSqft(p.area)) m.area = 'Enter the area in sq ft';
  if (String(p.description || '').trim().length < 30) m.description = 'Describe the property (at least 30 characters)';
  if (/Apartment|Villa|Independent House|Builder Floor/.test(p.subtype || '') && !(p.beds > 0)) m.beds = 'Enter the number of bedrooms';
  if (!hasPhoto) m.image = 'Add at least one photo';
  return m;
}

const wantsDraft = req => req.body?.draft === '1' || req.body?.draft === true;

/** Only approved owners may add or change listings */
exports.requireOwner = (req, res, next) => {
  if (ListingRequest.isApproved(req.user.email)) return next();
  discardFiles(req);
  res.status(403).json({ error: 'Your listing request has not been approved yet.', code: 'not_owner' });
};

/** GET /api/owner/properties — this owner's listings, any status, with their documents count */
exports.list = (req, res) => {
  const data = Property.ownedBy(req.user.id).map(p => ({
    ...Property.publicJSON(p),
    review_note: p.review_note,
    submitted_at: p.submitted_at,
    documents: PropertyDocument.forProperty(p.id).map(d => ({ id: d.id, title: d.title, is_public: d.is_public })),
  }));
  res.json({ ok: true, data, owner: ListingRequest.isApproved(req.user.email) });
};

/** GET /api/owner/properties/:id/history */
exports.history = (req, res) => {
  const p = Property.find(req.params.id);
  if (!p || p.owner_id !== req.user.id) return res.status(404).json({ error: 'Property not found' });
  res.json({ ok: true, data: ListingEvent.forOwner(p.id) });
};

function afterSave(req, res, saved, { draft, edited, before }) {
  const dups = draft ? [] : Property.duplicates(saved, saved.id);
  Property.update(saved.id, { duplicate_of: dups.map(d => d.id).join(',') || null });
  ListingEvent.record(saved.id, actor(req), draft ? 'draft.saved' : (edited ? 'resubmitted' : 'submitted'), {
    from: before?.review_status || null, to: draft ? 'draft' : 'pending',
    note: dups.length ? `Possible duplicate of ${dups.map(d => Property.listingCode(d.id)).join(', ')}` : null,
  });
  if (!draft) Mailer.ownerPropertySubmitted(adminEmail(), saved, req.user, edited);
  res.json({ ok: true, data: Property.find(saved.id), possible_duplicate: dups.length > 0 });
}

/** POST /api/owner/properties (multipart: image, gallery[], floor_plan, documents[]; draft=1 to save without sending) */
exports.create = (req, res) => {
  if (Property.ownedBy(req.user.id).length >= MAX_LISTINGS) {
    discardFiles(req);
    return res.status(400).json({ error: `You can have up to ${MAX_LISTINGS} listings. Please contact us to add more.` });
  }
  const { data, error, fields } = Property.validate(req.body, false);
  if (error) { discardFiles(req); return res.status(400).json({ error, fields }); }
  const draft = wantsDraft(req);
  const clean = ownerData(data);
  if (!draft) {
    const missing = missingForReview(clean, !!req.files?.image?.[0]);
    if (Object.keys(missing).length) { discardFiles(req); return res.status(400).json({ error: Object.values(missing)[0], fields: missing }); }
  }
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const created = Property.create({
    ...clean, is_featured: 0, owner_id: req.user.id, listed_by: 'owner',
    review_status: draft ? 'draft' : 'pending', submitted_at: draft ? null : now, published_at: null,
  });
  applyListingFiles(req, created.id, null, actor(req));
  res.locals.createdId = created.id;
  afterSave(req, res, Property.find(created.id), { draft, edited: false });
};

/** PUT /api/owner/properties/:id — a change to a submitted or live listing goes back to review */
exports.update = (req, res) => {
  const existing = Property.find(req.params.id);
  if (!existing || existing.owner_id !== req.user.id) {
    discardFiles(req);
    return res.status(404).json({ error: 'Property not found' });
  }
  const { data, error, fields } = Property.validate(req.body, true);
  if (error) { discardFiles(req); return res.status(400).json({ error, fields }); }
  // Only listings that aren't with the review team can stay a draft
  const draft = wantsDraft(req) && ['draft', 'changes', 'rejected'].includes(existing.review_status);
  const merged = { ...existing, ...ownerData(data) };
  if (!draft) {
    const missing = missingForReview(merged, !!(req.files?.image?.[0] || existing.image));
    if (Object.keys(missing).length) { discardFiles(req); return res.status(400).json({ error: Object.values(missing)[0], fields: missing }); }
  }
  Property.update(existing.id, {
    ...ownerData(data),
    review_status: draft ? existing.review_status : 'pending',
    review_note: draft ? existing.review_note : null,
    ...(draft ? {} : { submitted_at: new Date().toISOString().replace('T', ' ').slice(0, 19) }),
  });
  applyListingFiles(req, existing.id, existing, actor(req));
  afterSave(req, res, Property.find(existing.id), { draft, edited: existing.review_status !== 'draft', before: existing });
};

/** POST /api/owner/properties/:id/status {status: sold | rented | withdrawn | active} */
exports.setStatus = (req, res) => {
  const p = Property.find(req.params.id);
  if (!p || p.owner_id !== req.user.id) return res.status(404).json({ error: 'Property not found' });
  const status = req.body?.status;
  if (!['sold', 'rented', 'withdrawn', 'active'].includes(status)) return res.status(400).json({ error: 'Unknown status' });
  if (p.review_status !== 'approved') return res.status(400).json({ error: 'Only a published listing can be marked sold, rented or withdrawn' });
  if (status === 'active' && p.listing_status !== 'withdrawn') {
    return res.status(400).json({ error: p.listing_status === 'expired' ? 'This listing expired. Edit it and send it for review to publish it again.' : 'Only a withdrawn listing can be put back' });
  }
  if (status === 'rented' && p.type !== 'rent' && !Property.isLease(p)) return res.status(400).json({ error: 'Only rental listings can be marked rented' });
  const updated = Property.update(p.id, { listing_status: status });
  ListingEvent.record(p.id, actor(req), 'listing.status', { from: p.listing_status, to: status });
  res.json({ ok: true, data: updated });
};

/** DELETE /api/owner/properties/:id */
exports.remove = (req, res) => {
  const existing = Property.find(req.params.id);
  if (!existing || existing.owner_id !== req.user.id) return res.status(404).json({ error: 'Property not found' });
  removeListing(existing.id);
  res.json({ ok: true });
};
