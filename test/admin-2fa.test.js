'use strict';
// Admin 2-step login (TOTP). Runs in its own process with ADMIN_TOTP_SECRET set.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'landroof-2fa-'));
const TOTP = require('../src/services/totp');
const SECRET = TOTP.generateSecret();
Object.assign(process.env, {
  DB_PATH: path.join(tmp, 'test.db'), UPLOAD_DIR: path.join(tmp, 'uploads'), DOCS_DIR: path.join(tmp, 'documents'), NODE_ENV: 'test',
  ADMIN_USER: 'admin', ADMIN_PASS: 'test-password-123', JWT_SECRET: 'x'.repeat(64),
  ADMIN_TOTP_SECRET: SECRET, PASSWORD_HASH_COST: '12',
  SMTP_HOST: '', ADMIN_EMAIL: '', // never send real email from tests
});
const app = require('../src/app');
let server, base;

const login = async body => {
  const r = await fetch(base + '/api/admin/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
};

before(async () => {
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  require('../src/config/database').close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('with 2-step login on, the admin needs password AND a fresh authenticator code', async () => {
  const creds = { username: 'admin', password: 'test-password-123' };

  const wrongPass = await login({ username: 'admin', password: 'nope', otp: TOTP.codeAt(SECRET) });
  assert.equal(wrongPass.data.code, 'invalid_credentials');

  const noCode = await login(creds);
  assert.equal(noCode.status, 401);
  assert.equal(noCode.data.code, 'otp_required');

  const badCode = await login({ ...creds, otp: '000000' === TOTP.codeAt(SECRET) ? '111111' : '000000' });
  assert.equal(badCode.data.code, 'invalid_otp');

  const code = TOTP.codeAt(SECRET);
  const ok = await login({ ...creds, otp: code });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.ok(ok.data.accessToken);

  const replay = await login({ ...creds, otp: code });
  assert.equal(replay.data.code, 'invalid_otp'); // each code works once
});
