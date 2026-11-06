'use strict';
// Refuses to start a production server with unsafe settings, and warns in development.
const env = require('./env');

const WEAK_ADMIN_PASSWORDS = ['landroof2024', 'admin', 'admin123', 'password', 'password123', 'changeme', 'change-me-to-a-long-random-password'];

function problems() {
  const errors = [];   // block production start
  const warnings = []; // shown, never block
  const pass = env.ADMIN_PASS;

  if (env.ADMIN_PASS_IS_DEFAULT || WEAK_ADMIN_PASSWORDS.includes(pass.toLowerCase())) {
    errors.push('ADMIN_PASS is the default or a well-known password. Set a unique one in .env.');
  } else if (pass.length < 12) {
    errors.push('ADMIN_PASS must be at least 12 characters.');
  } else if (!/[A-Za-z]/.test(pass) || !/\d/.test(pass)) {
    errors.push('ADMIN_PASS must contain letters and numbers.');
  }
  if (!env.JWT_SECRET) errors.push('JWT_SECRET is not set (at least 32 random characters).');
  if (!env.SITE_URL.startsWith('https://')) warnings.push('SITE_URL is not https:// — logins and cookies need HTTPS on a live site.');
  let smtpHost = env.SMTP_HOST;
  try { smtpHost = require('../models/MailSettings').current().host; } catch { /* JWT_SECRET missing: reported above */ }
  if (!smtpHost) warnings.push('SMTP is not configured (admin → Email Settings, or SMTP_* in .env) — password-reset emails are saved to data/outbox instead of being sent.');
  return { errors, warnings };
}

function runStartupChecks() {
  const { errors, warnings } = problems();
  if (env.NODE_ENV === 'production') {
    warnings.forEach(w => console.warn('⚠️  ' + w));
    if (errors.length) {
      throw new Error('Unsafe production configuration:\n  - ' + errors.join('\n  - '));
    }
  } else {
    errors.forEach(e => console.warn('⚠️  ' + e + ' (required before going live)'));
  }
}

module.exports = { runStartupChecks, problems };
