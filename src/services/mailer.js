'use strict';
// Sends account emails (password reset, security notices).
// SMTP settings come from the admin panel (Email Settings) or, if none are saved there, from SMTP_* in .env.
// Without an SMTP server the email is saved as an .html file in data/outbox so the links can still be
// used while developing.
const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const MailSettings = require('../models/MailSettings');

const OUTBOX = path.join(path.dirname(env.DB_PATH), 'outbox');
let transport = null, transportKey = '';

/** The SMTP connection for the current settings (rebuilt when they change), or null without a server */
function getTransport(cfg = MailSettings.current()) {
  if (!cfg.host) return null;
  const key = JSON.stringify([cfg.host, cfg.port, cfg.secure, cfg.user, cfg.pass]);
  if (!transport || key !== transportKey) {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: !!cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      disableFileAccess: true,
      disableUrlAccess: true,
      connectionTimeout: 15000,
    });
    transportKey = key;
  }
  return transport;
}
const fromAddress = cfg => cfg.from || (cfg.user ? `Landroof <${cfg.user}>` : env.MAIL_FROM);

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f6fa;padding:24px;color:#1a2233">
<div style="max-width:520px;margin:auto;background:#fff;border-radius:12px;padding:28px">
<h2 style="margin:0 0 16px;color:#FF7B00">Landroof</h2><h3 style="margin:0 0 12px">${esc(title)}</h3>${bodyHtml}
<p style="font-size:12px;color:#888;margin-top:28px">If you didn't request this, you can ignore this email.</p></div></body></html>`;
}

function button(url, label) {
  return `<p style="margin:24px 0"><a href="${esc(url)}" style="background:#FF7B00;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(label)}</a></p>
<p style="font-size:12px;color:#888">Or copy this link: ${esc(url)}</p>`;
}

/** Sends (or saves) an email. Never throws — failures are logged so the HTTP response isn't delayed or changed. */
async function send({ to, subject, html, text }) {
  try {
    const cfg = MailSettings.current();
    const t = getTransport(cfg);
    if (t) {
      await t.sendMail({ from: fromAddress(cfg), to, subject, html, text });
      return;
    }
    fs.mkdirSync(OUTBOX, { recursive: true });
    const file = path.join(OUTBOX, `${Date.now()}-${String(to).replace(/[^a-z0-9@._-]/gi, '_')}.html`);
    fs.writeFileSync(file, `<!-- To: ${esc(to)} | Subject: ${esc(subject)} -->\n${html}`);
    if (env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') console.log(`✉️  Email to ${to} saved to ${file}`);
  } catch (e) {
    console.error('Email could not be sent:', e.message);
  }
}

const Mailer = {
  OUTBOX,

  /** Admin "Send test email": unlike other emails this one reports the SMTP error. Returns how it was delivered. */
  async sendTest(to) {
    const cfg = MailSettings.current();
    const t = getTransport(cfg);
    if (!t) throw new Error('No SMTP server is set, so emails are only saved to data/outbox on the server.');
    await t.sendMail({
      from: fromAddress(cfg), to, subject: 'Landroof test email',
      text: 'This is a test email from your Landroof admin panel. Email sending works.',
      html: layout('Test email', '<p>This is a test email from your Landroof admin panel.</p><p><b>Email sending works.</b></p>'),
    });
    return { host: cfg.host, from: fromAddress(cfg) };
  },

  /** To the admin: someone submitted the "List your property" form */
  listingRequestReceived(to, r) {
    if (!to) return;
    const rows = [['Name', r.name], ['Email', r.email], ['Mobile', r.phone], ['City', r.city], ['Type', r.property_type], ['Details', r.message]]
      .filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#888">${k}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('');
    return send({
      to, subject: `New listing request from ${r.name || r.email}`,
      text: `New "List your property" request\n\nName: ${r.name}\nEmail: ${r.email}\nMobile: ${r.phone}\nCity: ${r.city}\n\nApprove or reject it in the admin panel: ${env.SITE_URL}/admin#requests`,
      html: layout('New listing request', `<p>Someone wants to list a property on Landroof.</p><table style="font-size:14px">${rows}</table>${button(`${env.SITE_URL}/admin#requests`, 'Review in admin panel')}`),
    });
  },

  /** To the visitor: their request was approved; the link signs them in (or lets them choose a password) */
  listingApproved(to, name, link) {
    return send({
      to, subject: 'You can now list your property on Landroof',
      text: `Hi ${name || ''},\n\nGood news: your request to list on Landroof is approved.\n\nOpen this link to go straight to "My Properties" and add your property (works once, for 7 days):\n${link}\n\nAfter that, sign in at ${env.SITE_URL} with this email address (${to}) and open "My Properties" from your account menu.\n\nEvery listing is checked by our team before it appears on the website.`,
      html: layout('Your listing request is approved', `<p>Hi ${esc(name)},</p><p>Good news: you can now add your properties to Landroof.</p>${button(link, 'Add my property')}<p style="font-size:13px">This link takes you straight to <b>My Properties</b>. It works once and for 7 days.</p><p style="font-size:13px">Later, simply sign in at <a href="${esc(env.SITE_URL)}">${esc(env.SITE_URL.replace(/^https?:\/\//, ''))}</a> with <b>${esc(to)}</b> and open <b>My Properties</b> from your account menu.</p><p style="font-size:13px">Every listing is checked by our team before it appears on the website.</p>`),
    });
  },

  /** To the visitor: their request was not approved */
  listingRejected(to, name) {
    return send({
      to, subject: 'About your Landroof listing request',
      text: `Hi ${name || ''},\n\nThank you for your interest in listing with Landroof. We're unable to approve your request right now.\n\nIf you have questions or more details to share, just reply to this email or contact us at ${env.SITE_URL}.`,
      html: layout('About your listing request', `<p>Hi ${esc(name)},</p><p>Thank you for your interest in listing your property with Landroof. We're unable to approve your request right now.</p><p>If you have questions or more details to share, just reply to this email or contact us through <a href="${esc(env.SITE_URL)}">our website</a>. We'd be happy to help.</p>`),
    });
  },

  /** To the admin: an owner added or changed a listing that needs review */
  ownerPropertySubmitted(to, p, owner, edited = false) {
    if (!to) return;
    return send({
      to, subject: `${edited ? 'Updated' : 'New'} listing to review: ${p.title}`,
      text: `${owner.name} (${owner.email}) ${edited ? 'updated' : 'added'} "${p.title}" (${p.price_label}, ${p.city}).\n\nReview it in the admin panel: ${env.SITE_URL}/admin#properties`,
      html: layout(`${edited ? 'Updated' : 'New'} listing to review`, `<p><b>${esc(owner.name)}</b> (${esc(owner.email)}) ${edited ? 'updated' : 'added'} a listing:</p><p style="font-size:15px"><b>${esc(p.title)}</b><br>${esc(p.price_label)} · ${esc([p.locality, p.city].filter(Boolean).join(', '))}</p>${button(`${env.SITE_URL}/admin#properties`, 'Review in admin panel')}`),
    });
  },

  /** To the owner: their listing was approved (live), not approved, or needs corrections */
  propertyReviewed(to, name, p, outcome) {
    const status = outcome === true ? 'approved' : outcome === false ? 'rejected' : outcome;
    if (status === 'changes') {
      return send({
        to, subject: `Please update your listing: ${p.title}`,
        text: `Hi ${name || ''},\n\nOur team reviewed "${p.title}" and needs a few corrections before it can go live.${p.review_note ? '\n\nWhat to change: ' + p.review_note : ''}\n\nOpen "My Properties" on ${env.SITE_URL}, edit the listing and send it again.`,
        html: layout('Please update your listing', `<p>Hi ${esc(name)},</p><p>Our team reviewed <b>${esc(p.title)}</b> and needs a few corrections before it can go live.</p>${p.review_note ? `<p><b>What to change:</b> ${esc(p.review_note)}</p>` : ''}<p>Open <b>My Properties</b>, edit the listing and send it again.</p>${button(env.SITE_URL, 'Open Landroof')}`),
      });
    }
    const approved = status === 'approved';
    return send({
      to, subject: approved ? `Your listing is live: ${p.title}` : `About your listing: ${p.title}`,
      text: approved
        ? `Hi ${name || ''},\n\n"${p.title}" has been approved and is now live on Landroof: ${env.SITE_URL}`
        : `Hi ${name || ''},\n\nWe couldn't publish "${p.title}" as it is.${p.review_note ? ' Note from our team: ' + p.review_note : ''}\n\nYou can edit it under "My Properties" and it will be reviewed again.`,
      html: approved
        ? layout('Your listing is live', `<p>Hi ${esc(name)},</p><p><b>${esc(p.title)}</b> has been approved and is now visible on Landroof.</p>${button(env.SITE_URL, 'View the website')}`)
        : layout('About your listing', `<p>Hi ${esc(name)},</p><p>We couldn't publish <b>${esc(p.title)}</b> as it is.</p>${p.review_note ? `<p><b>Note from our team:</b> ${esc(p.review_note)}</p>` : ''}<p>You can edit it under <b>My Properties</b> on the website and it will be reviewed again.</p>`),
    });
  },

  resetPassword(to, name, link) {
    return send({
      to, subject: 'Reset your Landroof password',
      text: `Hi ${name || ''},\n\nReset your password here (valid for 30 minutes):\n${link}`,
      html: layout('Reset your password', `<p>Hi ${esc(name)},</p><p>We received a request to reset your password.</p>${button(link, 'Choose a new password')}<p style="font-size:13px">This link expires in 30 minutes and can be used once.</p>`),
    });
  },

  passwordChanged(to, name) {
    return send({
      to, subject: 'Your Landroof password was changed',
      text: `Hi ${name || ''},\n\nYour password was just changed and all other devices were signed out. If this wasn't you, reset your password immediately.`,
      html: layout('Your password was changed', `<p>Hi ${esc(name)},</p><p>Your Landroof password was just changed, and every other device was signed out.</p><p><strong>If this wasn't you</strong>, reset your password immediately using "Forgot password" on the sign-in screen.</p>`),
    });
  },
};

module.exports = Mailer;
