'use strict';
// Image uploads.
//  • Only JPG / PNG / WebP / GIF, max 10 MB, one file, limited form fields.
//  • The stored file extension comes from the whitelisted MIME type, never from the user's
//    filename, so nothing can be saved as .html/.svg/.js.
//  • After upload the file's first bytes ("magic number") must match the declared type,
//    otherwise it is deleted — a renamed HTML or script file is rejected.
//  • Uploaded files are served with "X-Content-Type-Options: nosniff".
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { UPLOAD_DIR, DOCS_DIR } = require('../config/env');
const { removeUpload } = require('../utils/files');

const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
// Listing documents: PDF or a scanned page
const DOC_EXT = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };

const SIGNATURES = {
  'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png':  b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/gif':  b => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii')),
  'image/webp': b => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  'application/pdf': b => b.subarray(0, 5).toString('ascii') === '%PDF-',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${IMAGE_EXT[file.mimetype]}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 40, fieldSize: 64 * 1024, parts: 50 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_EXT[file.mimetype]) return cb(null, true);
    const err = new Error('Only JPG, PNG, WebP or GIF images are allowed');
    err.status = 400;
    cb(err);
  },
});

function hasImageSignature(filePath, mimetype) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    return !!SIGNATURES[mimetype]?.(head);
  } finally {
    fs.closeSync(fd);
  }
}

function verifyImageContent(req, res, next) {
  if (!req.file) return next();
  let ok = false;
  try { ok = hasImageSignature(req.file.path, req.file.mimetype); } catch { ok = false; }
  if (ok) return next();
  removeUpload(req.file.filename);
  req.file = undefined;
  res.status(400).json({ error: 'That file is not a valid image. Please upload a real JPG, PNG, WebP or GIF.', fields: { image: 'Not a valid image file' } });
}

/** Accepts one optional image in the given form field and checks its content */
const singleImage = (field = 'image') => [upload.single(field), verifyImageContent];

// ── Listing form: main photo, more photos, floor plan and (private) documents in one request ──
const isDocField = field => field === 'documents' || field === 'document';
const listingUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, file, cb) => cb(null, isDocField(file.fieldname) ? DOCS_DIR : UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${(isDocField(file.fieldname) ? DOC_EXT : IMAGE_EXT)[file.mimetype]}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 20, fields: 60, fieldSize: 64 * 1024, parts: 90 },
  fileFilter: (_req, file, cb) => {
    if ((isDocField(file.fieldname) ? DOC_EXT : IMAGE_EXT)[file.mimetype]) return cb(null, true);
    const err = new Error(isDocField(file.fieldname) ? 'Documents must be PDF, JPG or PNG files' : 'Only JPG, PNG, WebP or GIF images are allowed');
    err.status = 400;
    cb(err);
  },
});

const LISTING_FIELDS = [{ name: 'image', maxCount: 1 }, { name: 'floor_plan', maxCount: 1 }, { name: 'gallery', maxCount: 12 }, { name: 'documents', maxCount: 5 }];

/** Every uploaded file of a request as a flat list */
const allFiles = req => (req.file ? [req.file] : []).concat(...Object.values(req.files || {}));

/** Deletes the files of a request that is rejected */
function discardFiles(req) {
  allFiles(req).forEach(f => { try { fs.unlinkSync(f.path); } catch { /* gone */ } });
}

function verifyAllContent(req, res, next) {
  const bad = allFiles(req).find(f => {
    try { return !hasImageSignature(f.path, f.mimetype); } catch { return true; }
  });
  if (!bad) return next();
  discardFiles(req);
  req.file = undefined; req.files = {};
  res.status(400).json({ error: `"${String(bad.originalname).slice(0, 80)}" is not a valid ${isDocField(bad.fieldname) ? 'PDF or image' : 'image'} file.`, fields: { [bad.fieldname]: 'Not a valid file' } });
}

/** Listing photos + documents. Files end up in req.files.image / floor_plan / gallery / documents. */
const listingFiles = () => [listingUpload.fields(LISTING_FIELDS), verifyAllContent];
/** One document (field "document") for the admin documents panel */
const singleDocument = () => [listingUpload.single('document'), verifyAllContent];

module.exports = { singleImage, hasImageSignature, listingFiles, singleDocument, discardFiles };
