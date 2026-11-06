'use strict';
// Time-based one-time passwords (RFC 6238) — the 6-digit codes shown by Google Authenticator,
// Microsoft Authenticator, Authy, etc. Used for the optional admin 2-step login.
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of String(str).replace(/=+$/, '').toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 secret');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function hotp(secretBuf, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secretBuf).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 1e6).padStart(6, '0');
}

const STEP = 30;
const step = (now = Date.now()) => Math.floor(now / 1000 / STEP);

const TOTP = {
  generateSecret: () => base32Encode(crypto.randomBytes(20)),

  codeAt(secret, now = Date.now()) {
    return hotp(base32Decode(secret), step(now));
  },

  /**
   * Checks a code, allowing one 30-second step of clock drift either way.
   * Returns the matching time step (to block re-use of the same code), or null.
   */
  verify(secret, code, now = Date.now()) {
    if (!/^\d{6}$/.test(String(code || ''))) return null;
    const key = base32Decode(secret);
    const current = step(now);
    for (const s of [current - 1, current, current + 1]) {
      const expected = hotp(key, s);
      if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(code)))) return s;
    }
    return null;
  },

  otpauthUrl(secret, account, issuer = 'Landroof Admin') {
    return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  },
};

module.exports = TOTP;
