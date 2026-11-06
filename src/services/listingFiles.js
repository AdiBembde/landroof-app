'use strict';
// Saves the files sent with a listing form (see listingFiles() in middleware/upload.js) and removes
// the ones they replace.
const Property = require('../models/Property');
const PropertyDocument = require('../models/PropertyDocument');
const { removeUpload, uploadUrl } = require('../utils/files');

const MAX_GALLERY = 20;

function parseList(v) {
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}

/**
 * body.remove_gallery: JSON list of photo URLs to drop; body.remove_floor_plan = '1' drops the floor plan.
 * Documents are saved as private; staff decide later whether one may be published.
 */
function applyListingFiles(req, propertyId, existing, actor) {
  const img = req.files?.image?.[0];
  const plan = req.files?.floor_plan?.[0];
  const set = {};
  if (img) set.image = img.filename;
  if (plan) set.floor_plan = plan.filename;
  else if (req.body?.remove_floor_plan === '1') set.floor_plan = null;

  const current = Property.gallery(propertyId);
  const drop = new Set(parseList(req.body?.remove_gallery));
  const removed = current.filter(g => drop.has(uploadUrl(g)));
  const kept = current.filter(g => !drop.has(uploadUrl(g)));
  const added = (req.files?.gallery || []).map(f => f.filename);
  const room = Math.max(MAX_GALLERY - kept.length, 0);
  added.slice(room).forEach(removeUpload); // over the limit
  if (added.length || removed.length) Property.setGallery(propertyId, [...kept, ...added.slice(0, room)]);
  if (Object.keys(set).length) Property.update(propertyId, set);

  (req.files?.documents || []).forEach(file => PropertyDocument.create({
    propertyId, kind: 'other', title: file.originalname, file, uploadedBy: actor,
  }));

  if (img && existing?.image) removeUpload(existing.image);
  if ((plan || set.floor_plan === null) && existing?.floor_plan) removeUpload(existing.floor_plan);
  removed.forEach(removeUpload);
}

/** Deletes a listing with its photos and documents. Returns the deleted row or undefined. */
function removeListing(id) {
  PropertyDocument.removeForProperty(id); // before the row: deleting it cascades to the document rows
  const row = Property.remove(id);
  if (row) {
    removeUpload(row.image);
    removeUpload(row.floor_plan);
    row.gallery_files.forEach(removeUpload);
  }
  return row;
}

module.exports = { applyListingFiles, removeListing, MAX_GALLERY };
