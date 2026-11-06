'use strict';
const fs = require('fs');
const path = require('path');
const { UPLOAD_DIR } = require('../config/env');

// Sample listings point at photos shipped with the site (e.g. "/images/properties/villa.jpg")
// instead of an uploaded file; those are served as-is and never deleted.
const isSiteImage = filename => /^\/images\/[\w/-]+\.(jpe?g|png|webp)$/i.test(String(filename || ''));

// Deletes an uploaded file. basename() guarantees we never leave the upload folder.
function removeUpload(filename) {
  if (!filename || isSiteImage(filename)) return;
  try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(filename))); } catch (_) { /* already gone */ }
}

function uploadUrl(filename) {
  if (!filename) return null;
  return isSiteImage(filename) ? filename : `/uploads/${encodeURIComponent(filename)}`;
}

module.exports = { removeUpload, uploadUrl };
