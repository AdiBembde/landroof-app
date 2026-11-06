'use strict';
// JWT authentication.
//
//  • Access token  — a signed JWT (HS256), valid for ACCESS_TOKEN_TTL (15 min by default).
//                    Sent by the browser in the "Authorization: Bearer <jwt>" header and kept
//                    only in page memory (never in localStorage).
//  • Refresh token — a random opaque string in an httpOnly, SameSite=Strict cookie that
//                    JavaScript cannot read. It is used only to get a new access token.
//                    Every refresh rotates it; re-using an old one revokes the whole login
//                    (theft detection).
//
// Admin and visitor tokens use different audiences and cookie paths, so one can never
// be used in place of the other.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const SECRET = require('../config/jwtSecret');
const env = require('../config/env');
const RefreshToken = require('../models/RefreshToken');

const AUDIENCES = { admin: 'landroof-admin', user: 'landroof-web' };
const COOKIES = {
  admin: { name: 'lr_admin_rt', path: '/api/admin/auth' },
  user:  { name: 'lr_rt',       path: '/api/auth' },
};
// Cookies are HTTPS-only in production (and whenever the site URL is https), so they can never travel in clear text
const SECURE_COOKIES = env.NODE_ENV === 'production' || env.SITE_URL.startsWith('https://');

class AuthError extends Error {
  constructor(message, code, status = 401) {
    super(message);
    Object.assign(this, { code, status });
  }
}

// ── Access tokens (JWT) ───────────────────────────────────────────────────
/**
 * @param {'admin'|'user'} audience
 * @param {{sub:string|number, role:string, tv?:number, pv?:string, name?:string}} claims
 */
function signAccessToken(audience, { sub, ...claims }) {
  return jwt.sign(claims, SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: env.JWT_ISSUER,
    audience: AUDIENCES[audience],
    subject: String(sub),
    jwtid: crypto.randomBytes(8).toString('hex'),
  });
}

/** Verifies signature, expiry, issuer and audience. Throws AuthError. */
function verifyAccessToken(token, audience) {
  if (!token) throw new AuthError('Please sign in', 'no_token');
  try {
    return jwt.verify(token, SECRET, {
      algorithms: ['HS256'],          // never accept "none" or other algorithms
      issuer: env.JWT_ISSUER,
      audience: AUDIENCES[audience],
    });
  } catch (e) {
    if (e.name === 'TokenExpiredError') throw new AuthError('Your session has expired', 'token_expired');
    throw new AuthError('Invalid sign-in token', 'invalid_token');
  }
}

function accessTokenTtlSeconds(token) {
  const { exp, iat } = jwt.decode(token);
  return exp - iat;
}

// ── Refresh tokens ────────────────────────────────────────────────────────
function refreshLifetimeMs(audience) {
  return audience === 'admin' ? env.ADMIN_REFRESH_HOURS * 3600e3 : env.USER_REFRESH_DAYS * 86400e3;
}

const sqlDate = d => d.toISOString().replace('T', ' ').slice(0, 19);

/** Creates a refresh token. `family` groups all rotations of one sign-in. */
function issueRefreshToken(audience, { userId = null, family, req }) {
  const token = crypto.randomBytes(48).toString('base64url');
  const expires = new Date(Date.now() + refreshLifetimeMs(audience));
  RefreshToken.create({
    token, audience, userId,
    family: family || crypto.randomBytes(12).toString('hex'),
    expiresAt: sqlDate(expires),
    ip: req?.ip, userAgent: req?.headers?.['user-agent'],
  });
  return { token, expires };
}

const parseSqlDate = s => new Date(String(s).replace(' ', 'T') + 'Z');

// Several tabs of the same browser share one refresh cookie. When they reload together, the
// second tab presents a token the first one has just rotated. Within this window that is
// treated as a normal concurrent refresh, not as theft.
const REUSE_GRACE_MS = 30 * 1000;

/**
 * Exchanges a refresh token for a new one (rotation).
 * Returns { row, token, expires } or throws AuthError.
 */
function rotateRefreshToken(audience, token, req) {
  if (!token) throw new AuthError('Please sign in', 'no_refresh_token');
  const row = RefreshToken.findByToken(token);
  if (!row || row.audience !== audience) throw new AuthError('Please sign in again', 'invalid_refresh_token');
  if (parseSqlDate(row.expires_at) <= new Date()) {
    throw new AuthError('Your session has expired. Please sign in again.', 'refresh_token_expired');
  }
  if (row.revoked_at) {
    const justRotated = row.rotated && Date.now() - parseSqlDate(row.revoked_at).getTime() <= REUSE_GRACE_MS;
    if (justRotated && RefreshToken.familyActive(row.family)) {
      // Concurrent refresh from another tab — give it its own token in the same login
      return { row, ...issueRefreshToken(audience, { userId: row.user_id, family: row.family, req }) };
    }
    // An old token is being replayed — assume it was stolen and end that login everywhere
    RefreshToken.revokeFamily(row.family);
    throw new AuthError('Please sign in again', 'refresh_token_reused');
  }
  RefreshToken.markRotated(row.id);
  const next = issueRefreshToken(audience, { userId: row.user_id, family: row.family, req });
  return { row, ...next };
}

function revokeRefreshToken(token) {
  const row = token && RefreshToken.findByToken(token);
  if (row) RefreshToken.revokeFamily(row.family);
}

// ── Cookies ───────────────────────────────────────────────────────────────
function setRefreshCookie(res, audience, token, expires) {
  const c = COOKIES[audience];
  res.cookie(c.name, token, { httpOnly: true, secure: SECURE_COOKIES, sameSite: 'strict', path: c.path, expires });
}

function clearRefreshCookie(res, audience) {
  const c = COOKIES[audience];
  res.clearCookie(c.name, { httpOnly: true, secure: SECURE_COOKIES, sameSite: 'strict', path: c.path });
}

function readRefreshCookie(req, audience) {
  return req.cookies?.[COOKIES[audience].name] || '';
}

/** Issues a fresh access + refresh token pair and writes the JSON response. */
function sendTokens(res, audience, { claims, refresh, user }) {
  setRefreshCookie(res, audience, refresh.token, refresh.expires);
  const accessToken = signAccessToken(audience, claims);
  res.json({ ok: true, accessToken, tokenType: 'Bearer', expiresIn: accessTokenTtlSeconds(accessToken), user });
}

// Housekeeping: drop dead refresh tokens once an hour
setInterval(() => { try { RefreshToken.purge(); } catch { /* db closed */ } }, 3600e3).unref();

module.exports = {
  AuthError,
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  clearRefreshCookie,
  readRefreshCookie,
  sendTokens,
};
