'use strict';
// Express 4 doesn't catch rejected promises; this forwards them to the error handler.
module.exports = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
