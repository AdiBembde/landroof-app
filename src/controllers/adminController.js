'use strict';
// Admin sign-in (JWT), dashboard numbers, registered users and site settings.
const crypto = require('crypto');
const Admin = require('../models/Admin');
const Property = require('../models/Property');
const Lead = require('../models/Lead');
const User = require('../models/User');
const SiteConfig = require('../models/SiteConfig');
const AuditLog = require('../models/AuditLog');
const ListingRequest = require('../models/ListingRequest');
const ListingReport = require('../models/ListingReport');
const MailSettings = require('../models/MailSettings');
const { isEmail } = require('../utils/validators');
const Mailer = require('../services/mailer');
const { SITE_URL } = require('../config/env');
const tokens = require('../services/tokenService');
const { limiters } = require('../middleware/rateLimit');

const adminClaims = () => ({ sub: Admin.username, role: Admin.role, pv: Admin.fingerprint });
const adminUser = () => ({ username: Admin.username, role: Admin.role, otpEnabled: Admin.otpEnabled });
const audit = (req, action, details) => AuditLog.record({ actor: `admin:${Admin.username}`, action, details, req });

/** POST /api/admin/auth/login — {username, password, otp?} */
exports.login = async (req, res) => {
  const ipLimit = limiters.adminLogin, accountLimit = limiters.adminAccount;
  if (ipLimit.isBlocked(req.ip)) return res.status(429).json({ error: ipLimit.message });
  if (accountLimit.isBlocked('admin')) {
    audit(req, 'admin.login_blocked_locked');
    return res.status(429).json({ error: accountLimit.message });
  }
  const { username = '', password = '', otp = '' } = req.body || {};
  const fail = (code, error, action) => {
    ipLimit.hit(req.ip);
    accountLimit.hit('admin');
    audit(req, action, { username: String(username).slice(0, 60) });
    return res.status(401).json({ error, code });
  };

  if (!(await Admin.checkCredentials(String(username), String(password)))) {
    return fail('invalid_credentials', 'Invalid username or password', 'admin.login_failed');
  }
  if (Admin.otpEnabled) {
    // Password was right; now the authenticator code is needed
    if (!otp) return res.status(401).json({ error: 'Enter the 6-digit code from your authenticator app', code: 'otp_required' });
    if (!Admin.checkOtp(otp)) return fail('invalid_otp', 'That code is wrong or was already used. Wait for a new code.', 'admin.login_failed_otp');
  }
  ipLimit.reset(req.ip);
  audit(req, 'admin.login');
  startSession(req, res);
};

// The family starts with the credential fingerprint, so a password change also kills refresh tokens
function startSession(req, res) {
  const family = `${Admin.fingerprint}:${crypto.randomBytes(12).toString('hex')}`;
  const refresh = tokens.issueRefreshToken('admin', { family, req });
  tokens.sendTokens(res, 'admin', { claims: adminClaims(), refresh, user: adminUser() });
}

/** POST /api/admin/auth/change-password — {currentPassword, newPassword}
 *  Signs out every other admin session; this one gets fresh tokens. */
exports.changePassword = async (req, res) => {
  const limit = limiters.adminAccount;
  if (limit.isBlocked('admin')) return res.status(429).json({ error: limit.message });
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  const invalid = fields => res.status(400).json({ error: Object.values(fields)[0], fields });

  if (!current) return invalid({ currentPassword: 'Enter your current password' });
  if (!(await Admin.checkCredentials(Admin.username, current))) {
    limit.hit('admin');
    audit(req, 'admin.password_change_failed');
    return invalid({ currentPassword: 'Your current password is incorrect' });
  }
  const problem = Admin.passwordProblem(next);
  if (problem) return invalid({ newPassword: problem });
  if (next === current) return invalid({ newPassword: 'New password must be different from the current one' });

  await Admin.setPassword(next);
  tokens.revokeRefreshToken(tokens.readRefreshCookie(req, 'admin'));
  audit(req, 'admin.password_changed');
  startSession(req, res);
};

/** POST /api/admin/auth/refresh — new access token from the httpOnly refresh cookie */
exports.refresh = (req, res) => {
  if (limiters.refresh.isBlocked(req.ip)) return res.status(429).json({ error: limiters.refresh.message });
  limiters.refresh.hit(req.ip);
  try {
    const { row, token, expires } = tokens.rotateRefreshToken('admin', tokens.readRefreshCookie(req, 'admin'), req);
    if (!row.family.startsWith(Admin.fingerprint + ':')) {
      tokens.revokeRefreshToken(token);
      throw new tokens.AuthError('Admin credentials changed. Please sign in again.', 'token_revoked');
    }
    tokens.sendTokens(res, 'admin', { claims: adminClaims(), refresh: { token, expires }, user: adminUser() });
  } catch (e) {
    if (!(e instanceof tokens.AuthError)) throw e;
    tokens.clearRefreshCookie(res, 'admin');
    res.status(401).json({ error: e.message, code: e.code });
  }
};

/** POST /api/admin/auth/logout */
exports.logout = (req, res) => {
  const cookie = tokens.readRefreshCookie(req, 'admin');
  if (cookie) audit(req, 'admin.logout');
  tokens.revokeRefreshToken(cookie);
  tokens.clearRefreshCookie(res, 'admin');
  res.json({ ok: true });
};

/** GET /api/admin/audit?limit=200&action=admin. — Activity Log */
exports.auditLog = (req, res) => res.json({ ok: true, data: AuditLog.list({ limit: req.query.limit, action: String(req.query.action || '') }) });

/**
 * POST /api/admin/privacy/erase {email} — deletes every lead and the account for an email
 * (right to erasure under India's DPDP Act / GDPR).
 */
exports.eraseByEmail = (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter the email address to erase' });
  const leads = Lead.removeByEmail(email);
  ListingRequest.removeByEmail(email);
  ListingReport.removeByEmail(email);
  const user = User.findByEmail(email);
  if (user) Property.clearOwner(user.id);
  const accounts = user ? User.remove(user.id) : 0;
  audit(req, 'privacy.erase', { email, leads, accounts });
  res.json({ ok: true, data: { leads, accounts } });
};

/** DELETE /api/admin/leads/:id */
exports.deleteLead = (req, res) => {
  if (!Lead.remove(req.params.id)) return res.status(404).json({ error: 'Lead not found' });
  res.json({ ok: true });
};

exports.me = (req, res) => res.json({ ok: true, user: { username: req.auth.sub, role: req.auth.role } });

exports.stats = (_req, res) => {
  const p = Property.stats();
  const l = Lead.stats();
  res.json({
    ok: true,
    data: {
      total_properties: p.total,
      pending_properties: p.pending,
      pending_requests: ListingRequest.pendingCount(),
      open_reports: ListingReport.openCount(),
      total_leads: l.total,
      leads_today: l.today,
      total_users: User.count(),
      leads_by_source: l.bySource,
      latest_leads: l.latest,
    },
  });
};

exports.users = (_req, res) => res.json({ ok: true, data: User.list() });

exports.getSiteConfig = (_req, res) => res.json({ ok: true, data: SiteConfig.getAll() });

exports.updateSiteConfig = (req, res) => {
  const { data, error } = SiteConfig.update(req.body);
  if (error) return res.status(400).json({ error });
  res.json({ ok: true, data });
};

// Public read of the same settings
exports.publicSiteConfig = (_req, res) => res.json({ ok: true, data: SiteConfig.getAll() });

// ── Listing requests and owners ─────────────────────────────────────────────
const ownerLink = token => `${SITE_URL}/?owner=${encodeURIComponent(token)}`;

/** GET /api/admin/listing-requests */
exports.listingRequests = (_req, res) => res.json({ ok: true, data: ListingRequest.list() });

/** POST /api/admin/listing-requests/:id/decision {status: 'approved' | 'rejected'} — emails the visitor */
exports.decideRequest = (req, res) => {
  const status = req.body?.status;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Choose approve or reject' });
  const existing = ListingRequest.find(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Request not found' });
  const { request, token } = ListingRequest.decide(existing.id, status);
  if (status === 'approved') Mailer.listingApproved(request.email, request.name, ownerLink(token));
  else Mailer.listingRejected(request.email, request.name);
  audit(req, `listing.${status}`, { email: request.email });
  res.json({ ok: true, data: request });
};

/** POST /api/admin/listing-requests/:id/resend — new sign-in link for an approved owner */
exports.resendOwnerLink = (req, res) => {
  const existing = ListingRequest.find(req.params.id);
  if (!existing || existing.status !== 'approved') return res.status(400).json({ error: 'Only approved requests have a sign-in link' });
  Mailer.listingApproved(existing.email, existing.name, ownerLink(ListingRequest.newLink(existing.id)));
  res.json({ ok: true });
};

/** GET /api/admin/owners — approved owners and how many listings each has */
exports.owners = (_req, res) => res.json({ ok: true, data: ListingRequest.owners() });

// ── Email (SMTP) settings ───────────────────────────────────────────────────
/** GET /api/admin/mail-settings — never includes the password */
exports.getMailSettings = (_req, res) => res.json({ ok: true, data: MailSettings.view() });

/** PUT /api/admin/mail-settings {host, port, secure, user, pass?, from, admin_email} — empty pass keeps the saved one */
exports.saveMailSettings = (req, res) => {
  const { data, error, fields } = MailSettings.save(req.body || {});
  if (error) return res.status(400).json({ error, fields });
  audit(req, 'mail.settings_changed', { host: data.host, user: data.user });
  res.json({ ok: true, data });
};

/** DELETE /api/admin/mail-settings — go back to the .env settings */
exports.resetMailSettings = (req, res) => {
  audit(req, 'mail.settings_reset');
  res.json({ ok: true, data: MailSettings.reset() });
};

/** POST /api/admin/mail-settings/test {to} — sends a test email and reports the SMTP error, if any */
exports.testMail = async (req, res) => {
  const to = String(req.body?.to || '').trim().toLowerCase();
  if (!isEmail(to)) return res.status(400).json({ error: 'Enter the email address to send the test to', fields: { to: 'Enter a valid email address' } });
  try {
    const r = await Mailer.sendTest(to);
    res.json({ ok: true, data: r });
  } catch (e) {
    res.status(400).json({ error: `The email could not be sent: ${e.message}`, code: 'smtp_failed' });
  }
};
