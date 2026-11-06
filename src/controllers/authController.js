'use strict';
// Website visitor accounts: register (signed in immediately), sign in, token refresh,
// sign out, password change / reset, and saved properties.
//
// Forgot-password gives the same answer whether or not the email has an account,
// and sign-in takes the same time for unknown emails.
const User = require('../models/User');
const Lead = require('../models/Lead');
const ListingRequest = require('../models/ListingRequest');
const RefreshToken = require('../models/RefreshToken');
const UserToken = require('../models/UserToken');
const AuditLog = require('../models/AuditLog');
const Mailer = require('../services/mailer');
const tokens = require('../services/tokenService');
const { limiters } = require('../middleware/rateLimit');
const { SITE_URL } = require('../config/env');
const { FORMS, validateForm } = require('../../shared/validation');

/** Sends 400 with the first message plus per-field messages the form can show under each input */
function invalid(res, errors) {
  return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
}

/** Signs the user in: sets the refresh cookie and returns a JWT access token */
function signIn(res, user, req, family) {
  const refresh = tokens.issueRefreshToken('user', { userId: user.id, family, req });
  tokens.sendTokens(res, 'user', {
    claims: { sub: user.id, role: user.role, tv: user.token_version },
    refresh,
    user: User.publicFields(user),
  });
}

const link = (param, token) => `${SITE_URL}/?${param}=${encodeURIComponent(token)}`;
const audit = (req, user, action, details) => AuditLog.record({ actor: user ? `user:${user.id}` : 'anonymous', action, target: 'user', targetId: user?.id, details, req });

/** POST /api/auth/register — creates the account and signs the user straight in (no email confirmation) */
exports.register = async (req, res) => {
  const b = req.body || {};
  if (limiters.register.isBlocked(req.ip)) return res.status(429).json({ error: limiters.register.message });
  const { valid, values, errors } = validateForm(FORMS.register, b);
  if (!valid) return invalid(res, errors);
  const { name, email, phone, password, interest } = values;
  limiters.register.hit(req.ip);

  const existing = User.findByEmail(email);
  if (existing) {
    audit(req, existing, 'user.register_existing_email');
    return res.status(409).json({
      error: 'An account with this email already exists. Please sign in, or use "Forgot password?" to reset it.',
      code: 'email_taken', fields: { email: 'An account with this email already exists' },
    });
  }

  const user = await User.create({ name, email, phone, password });
  audit(req, user, 'user.register');

  // Registration is also a lead for the sales team
  const lead = Lead.validate({ email, name, phone, source: 'register', search_type: interest, message: interest });
  if (lead.data) Lead.create(lead.data, { ip: req.ip, userAgent: req.headers['user-agent'] });

  signIn(res, user, req);
};

exports.login = async (req, res) => {
  const lim = limiters.userLogin;
  if (lim.isBlocked(req.ip)) return res.status(429).json({ error: lim.message });
  const { valid, values, errors } = validateForm(FORMS.login, req.body || {});
  if (!valid) return invalid(res, errors);
  const user = await User.verify(values.email, values.password);
  if (!user) {
    lim.hit(req.ip);
    return res.status(401).json({ error: 'Incorrect email or password', code: 'invalid_credentials' });
  }
  lim.reset(req.ip);
  audit(req, user, 'user.login');
  signIn(res, user, req);
};

/** POST /api/auth/forgot-password {email} — always the same answer */
exports.forgotPassword = (req, res) => {
  if (limiters.emailLinks.isBlocked(req.ip)) return res.status(429).json({ error: limiters.emailLinks.message });
  const { valid, values, errors } = validateForm(FORMS.forgotPassword, req.body || {});
  if (!valid) return invalid(res, errors);
  limiters.emailLinks.hit(req.ip);
  const user = User.findByEmail(values.email);
  if (user) {
    Mailer.resetPassword(user.email, user.name, link('reset', UserToken.create(user.id, 'reset')));
    audit(req, user, 'user.password_reset_requested');
  }
  res.json({ ok: true, message: 'If an account exists for that email, we\'ve sent a link to reset the password. It expires in 30 minutes.' });
};

/** POST /api/auth/reset-password {token, password} — sets a new password and signs in */
exports.resetPassword = async (req, res) => {
  const token = req.body?.token;
  // Validate the password before using up the one-time token
  const pending = UserToken.peekUser(token, 'reset');
  const { valid, values, errors } = validateForm(FORMS.resetPassword, { password: req.body?.password, email: pending?.email || '' });
  if (!valid) return invalid(res, errors);
  const userId = UserToken.consume(token, 'reset');
  if (!userId) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.', code: 'invalid_link' });
  const user = User.markVerified(userId); // receiving the email proves the address
  const updated = await User.changePassword(user.id, values.password);
  RefreshToken.revokeAllForUser(user.id);
  Mailer.passwordChanged(user.email, user.name);
  audit(req, user, 'user.password_reset');
  signIn(res, updated, req);
};

/**
 * POST /api/auth/owner-link {token, password?} — the link in the "listing request approved" email.
 * Signs the owner straight in. If the email has no account yet, the first call answers
 * { needsPassword } and a second call with a password creates the account.
 */
exports.ownerLink = async (req, res) => {
  const b = req.body || {};
  const request = ListingRequest.peekLink(b.token);
  const expired = () => res.status(400).json({
    error: 'This link has expired or was already used. Please sign in with the email address you used for your request.', code: 'link_invalid',
  });
  if (!request) return expired();
  let user = User.findByEmail(request.email);
  if (!user) {
    if (!b.password) return res.json({ ok: true, needsPassword: true, email: request.email, name: request.name });
    const { valid, values, errors } = validateForm(FORMS.resetPassword, { password: b.password, email: request.email });
    if (!valid) return invalid(res, errors);
    if (!ListingRequest.useLink(b.token)) return expired();
    user = await User.create({ name: request.name || request.email.split('@')[0], email: request.email, phone: request.phone || null, password: values.password });
    audit(req, user, 'user.register', 'owner link');
  } else {
    if (!ListingRequest.useLink(b.token)) return expired();
    audit(req, user, 'user.login', 'owner link');
  }
  signIn(res, user, req);
};

/** POST /api/auth/refresh — new access token from the httpOnly refresh cookie */
exports.refresh = (req, res) => {
  if (limiters.refresh.isBlocked(req.ip)) return res.status(429).json({ error: limiters.refresh.message });
  limiters.refresh.hit(req.ip);
  try {
    const { row, token, expires } = tokens.rotateRefreshToken('user', tokens.readRefreshCookie(req, 'user'), req);
    const user = User.findById(row.user_id);
    if (!user) throw new tokens.AuthError('Please sign in again', 'invalid_refresh_token');
    tokens.sendTokens(res, 'user', {
      claims: { sub: user.id, role: user.role, tv: user.token_version },
      refresh: { token, expires },
      user: User.publicFields(user),
    });
  } catch (e) {
    if (!(e instanceof tokens.AuthError)) throw e;
    tokens.clearRefreshCookie(res, 'user');
    res.status(401).json({ error: e.message, code: e.code });
  }
};

/** POST /api/auth/logout — ends this sign-in (works even if the access token has expired) */
exports.logout = (req, res) => {
  tokens.revokeRefreshToken(tokens.readRefreshCookie(req, 'user'));
  tokens.clearRefreshCookie(res, 'user');
  res.json({ ok: true });
};

/** POST /api/auth/logout-all — signs this account out on every device */
exports.logoutAll = (req, res) => {
  User.bumpTokenVersion(req.user.id);
  RefreshToken.revokeAllForUser(req.user.id);
  tokens.clearRefreshCookie(res, 'user');
  audit(req, req.user, 'user.logout_all');
  res.json({ ok: true });
};

/** POST /api/auth/change-password — {currentPassword, newPassword} */
exports.changePassword = async (req, res) => {
  const user = User.findById(req.user.id);
  const { valid, values, errors } = validateForm(FORMS.changePassword, { ...req.body, email: user.email });
  if (!valid) return invalid(res, errors);
  const { currentPassword: current, newPassword: next } = values;
  if (!(await User.checkPassword(user, current))) return invalid(res, { currentPassword: 'Your current password is incorrect' });
  if (next === current) return invalid(res, { newPassword: 'New password must be different from the current one' });

  // Every other device is signed out; this one gets fresh tokens
  const updated = await User.changePassword(user.id, next);
  RefreshToken.revokeAllForUser(user.id);
  Mailer.passwordChanged(user.email, user.name);
  audit(req, user, 'user.password_changed');
  signIn(res, updated, req);
};

exports.me = (req, res) => res.json({ ok: true, user: req.user });

exports.getWishlist = (req, res) => res.json({ ok: true, data: User.wishlist(req.user.id) });

exports.setWishlist = (req, res) => res.json({ ok: true, data: User.setWishlist(req.user.id, req.body?.ids) });
