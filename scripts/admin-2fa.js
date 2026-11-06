#!/usr/bin/env node
/**
 * Sets up 2-step login for the admin panel.
 *   npm run admin:2fa
 * Prints a new secret. Add it to an authenticator app (Google Authenticator, Microsoft
 * Authenticator, Authy…), put ADMIN_TOTP_SECRET=<secret> in .env and restart the server.
 * From then on the admin login asks for the 6-digit code from the app.
 */
require('dotenv').config();
const TOTP = require('../src/services/totp');

const secret = TOTP.generateSecret();
const account = process.env.ADMIN_USER || 'admin';
console.log(`
Admin 2-step login setup
────────────────────────
1. In your authenticator app choose "Add account" → "Enter a setup key" and enter:

     Account: Landroof Admin (${account})
     Key:     ${secret.match(/.{1,4}/g).join(' ')}
     Type:    Time-based

   (or open this link on the phone: ${TOTP.otpauthUrl(secret, account)})

2. Add this line to .env and restart the server:

     ADMIN_TOTP_SECRET=${secret}

3. Check it works: the code in your app right now should be ${TOTP.codeAt(secret)}.

Keep the key private. To turn 2-step login off, remove ADMIN_TOTP_SECRET from .env.
`);
