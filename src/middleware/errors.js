'use strict';
const path = require('path');
const multer = require('multer');
const { removeUpload } = require('../utils/files');

const NOT_FOUND_VIEW = path.join(__dirname, '..', 'views', '404.html');

/** Unknown URL: JSON for API calls, a friendly page for visitors */
function notFound(req, res) {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(NOT_FOUND_VIEW);
}

/** Final error handler — never exposes stack traces or file-system paths */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (req.file) removeUpload(req.file.filename); // don't keep files from failed requests

  let status = err.status || err.statusCode || 500;
  let message = err.expose === false ? '' : err.message;

  if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large (max 10 MB)' : 'Invalid file upload';
  } else if (err.type === 'entity.parse.failed') {
    status = 400; message = 'Invalid request body';
  } else if (err.type === 'entity.too.large') {
    status = 413; message = 'Request is too large';
  }

  if (status >= 500) {
    console.error(err);
    message = 'Something went wrong. Please try again.';
  }

  if (req.path.startsWith('/api/')) return res.status(status).json({ error: message });
  res.status(status).type('text/plain').send(message);
}

module.exports = { notFound, errorHandler };
