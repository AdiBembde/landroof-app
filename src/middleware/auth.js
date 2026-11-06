'use strict';
// Authentication (who are you?) and authorization (what may you do?).
//
//   authenticate('admin' | 'user')  verifies the JWT in "Authorization: Bearer <token>"
//                                   and sets req.auth = { sub, role, audience }
//   authorize(...roles)             allows the request only for the listed roles (403 otherwise)
//
//   requireAdmin = authenticate('admin') + authorize('admin')
//   requireUser  = authenticate('user')  + authorize('user')
const { verifyAccessToken, AuthError } = require('../services/tokenService');
const Admin = require('../models/Admin');
const User = require('../models/User');

function bearerToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function sendAuthError(res, e) {
  if (!(e instanceof AuthError)) throw e;
  if (e.status === 401) res.setHeader('WWW-Authenticate', `Bearer error="${e.code === 'token_expired' ? 'invalid_token' : e.code}"`);
  res.status(e.status).json({ error: e.message, code: e.code });
}

function authenticate(audience) {
  return (req, res, next) => {
    try {
      const claims = verifyAccessToken(bearerToken(req), audience);

      if (audience === 'admin') {
        // Changing ADMIN_USER / ADMIN_PASS invalidates every admin token
        if (claims.pv !== Admin.fingerprint) throw new AuthError('Please sign in again', 'token_revoked');
      } else {
        // The user must still exist, and the token must not predate a password change / sign-out-everywhere
        const user = User.findById(claims.sub);
        if (!user || user.token_version !== claims.tv) throw new AuthError('Please sign in again', 'token_revoked');
        req.user = User.publicFields(user);
        claims.role = user.role; // current role from the database wins over the token
      }

      req.auth = { sub: claims.sub, role: claims.role, audience };
      next();
    } catch (e) {
      sendAuthError(res, e);
    }
  };
}

function authorize(...roles) {
  return (req, res, next) => {
    if (req.auth && roles.includes(req.auth.role)) return next();
    res.status(403).json({ error: 'You do not have permission to do this', code: 'forbidden' });
  };
}

const requireAdmin = [authenticate('admin'), authorize('admin')];
const requireUser = [authenticate('user'), authorize(...User.ROLES)];

module.exports = { bearerToken, authenticate, authorize, requireAdmin, requireUser };
