'use strict';
// Resolves the secret used to sign JWTs.
//  1. JWT_SECRET from .env (required in production, at least 32 characters)
//  2. Otherwise, in development, a random secret generated once and saved next to the
//     database, so logins survive restarts without any setup.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JWT_SECRET, NODE_ENV, DB_PATH } = require('./env');

function resolveSecret() {
  if (JWT_SECRET) {
    if (JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters long');
    return JWT_SECRET;
  }
  if (NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is not set. Add a long random value to .env before starting in production.');
  }
  const file = path.join(path.dirname(DB_PATH), '.jwt-secret');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch { /* not created yet */ }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  console.warn(`ℹ️  JWT_SECRET not set — generated a development secret in ${file}`);
  return secret;
}

module.exports = resolveSecret();
