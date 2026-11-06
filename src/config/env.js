'use strict';
// Central configuration — every setting the app reads from the environment lives here.
require('dotenv').config();
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = parseInt(process.env.PORT, 10) || 3000;
const DEFAULT_ADMIN_PASS = 'landroof2024';

// Serverless platforms (Vercel, AWS Lambda) only allow writing inside /tmp
const SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || ROOT.startsWith('/var/task'));

function writablePath(configured, localDefault, serverlessDefault) {
  if (!SERVERLESS) return path.resolve(ROOT, configured || localDefault);
  const p = configured && path.posix.resolve('/', configured); // serverless hosts are Linux
  if (p && p.startsWith('/tmp/')) return p;
  return serverlessDefault; // ignore paths inside the read-only project folder
}

module.exports = {
  ROOT,
  PORT,
  NODE_ENV:   process.env.NODE_ENV || 'development',
  ADMIN_USER: process.env.ADMIN_USER || 'admin',
  ADMIN_PASS: process.env.ADMIN_PASS || DEFAULT_ADMIN_PASS,
  ADMIN_PASS_IS_DEFAULT: !process.env.ADMIN_PASS || process.env.ADMIN_PASS === DEFAULT_ADMIN_PASS,
  // On Vercel / AWS Lambda the project folder is read-only, so data goes to /tmp (temporary —
  // see README "Deploying on Vercel"). Paths pointing anywhere else are moved into /tmp.
  IS_SERVERLESS: SERVERLESS,
  DB_PATH:    writablePath(process.env.DB_PATH, './data/landroof.db', '/tmp/landroof.db'),
  UPLOAD_DIR: writablePath(process.env.UPLOAD_DIR, './public/uploads', '/tmp/uploads'),
  // Listing documents (title papers, approvals…) — outside the public folder, served only after a permission check
  DOCS_DIR:   writablePath(process.env.DOCS_DIR, './data/documents', '/tmp/documents'),
  SITE_URL:   (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/+$/, ''),
  // Set TRUST_PROXY=1 when running behind nginx / a load balancer so client IPs are read correctly
  // (always on for Vercel, which sits in front of the app as a proxy)
  TRUST_PROXY: process.env.TRUST_PROXY === '1' || SERVERLESS,
  // Comma-separated list of other origins allowed to call the public API (optional)
  CORS_ORIGINS: (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  // JWT signing secret — see src/config/jwtSecret.js for how it is resolved
  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_ISSUER: 'landroof',
  ACCESS_TOKEN_TTL: process.env.ACCESS_TOKEN_TTL || '15m',      // short-lived JWT sent with each request
  ADMIN_REFRESH_HOURS: parseInt(process.env.ADMIN_REFRESH_HOURS, 10) || 12,
  USER_REFRESH_DAYS:   parseInt(process.env.USER_REFRESH_DAYS, 10) || 30,

  // Optional 2-step login for the admin panel (base32 secret from `npm run admin:2fa`)
  ADMIN_TOTP_SECRET: (process.env.ADMIN_TOTP_SECRET || '').replace(/\s+/g, '').toUpperCase(),

  // Outgoing email (password reset, security notices). Without SMTP_HOST, emails are written to data/outbox.
  SMTP_HOST:   process.env.SMTP_HOST || '',
  SMTP_PORT:   parseInt(process.env.SMTP_PORT, 10) || 587,
  SMTP_SECURE: process.env.SMTP_SECURE === '1',     // 1 for port 465 (implicit TLS)
  SMTP_USER:   process.env.SMTP_USER || '',
  SMTP_PASS:   process.env.SMTP_PASS || '',
  MAIL_FROM:   process.env.MAIL_FROM || 'Landroof <no-reply@landroof.com>',
  // Where admin notifications go (new listing requests, listings to review). Empty → the contact email from Site Numbers.
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || '',

  // Personal-data retention
  LEAD_RETENTION_DAYS: parseInt(process.env.LEAD_RETENTION_DAYS, 10) || 730,  // leads deleted after 2 years
  IP_RETENTION_DAYS:   parseInt(process.env.IP_RETENTION_DAYS, 10) || 90,     // IP + browser info blanked after 90 days
};
