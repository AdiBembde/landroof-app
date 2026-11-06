'use strict';
// Security headers for every response.
//
// Content-Security-Policy: scripts may only come from this site (no inline scripts, no eval).
// That is why the pages use data-on-* attributes (public/js/actions.js) instead of onclick="…".
// Inline *styles* are still allowed because the markup uses style="…" attributes.
const { NODE_ENV, SITE_URL } = require('../config/env');

const IS_PROD = NODE_ENV === 'production';
const HTTPS = SITE_URL.startsWith('https://');

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // Map tiles come from OpenStreetMap
  "img-src 'self' data: blob: https://tile.openstreetmap.org",
  // Video tours: YouTube embeds in privacy-enhanced mode only
  "frame-src https://www.youtube-nocookie.com",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(HTTPS ? ['upgrade-insecure-requests'] : []),
].join('; ');

function securityHeaders(_req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Tell browsers to use HTTPS only (only meaningful — and only safe — when the site is served over HTTPS)
  if (IS_PROD && HTTPS) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

/**
 * Blocks cross-site requests to endpoints that act on cookies (sign-in, token refresh, sign-out).
 * SameSite=Strict cookies already stop browsers sending them cross-site; this is a second,
 * server-side check (CSRF defence in depth). Requests without these headers (e.g. curl, older
 * browsers) are allowed because they can't carry a victim's cookies from another site.
 */
function sameOriginOnly(req, res, next) {
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site') return res.status(403).json({ error: 'Cross-site request blocked', code: 'cross_site' });
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    let host = '';
    try { host = new URL(origin).host; } catch { /* malformed */ }
    if (host !== req.headers.host) return res.status(403).json({ error: 'Cross-site request blocked', code: 'cross_site' });
  }
  next();
}

module.exports = { securityHeaders, sameOriginOnly, CSP };
