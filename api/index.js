'use strict';
// Vercel entry point: Vercel runs this file as a serverless function and passes every request
// that isn't a static file (see vercel.json) to the Express app. Locally, use `npm start` (server.js).
//
// If the app can't start (e.g. a missing or weak environment variable), every request gets a
// page explaining what to fix instead of Vercel's generic "FUNCTION_INVOCATION_FAILED".
// The message never contains secret values, only which setting is wrong.

let app = null;
let startError = null;
try {
  app = require('../src/app');
} catch (e) {
  startError = e;
  console.error('Landroof failed to start:', e);
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function startupErrorPage(err) {
  const message = String(err && err.message || err);
  // Configuration problems list one issue per line ("  - …"); other errors show their first line only
  const lines = message.startsWith('Unsafe production configuration') || /JWT_SECRET/.test(message)
    ? message.split('\n').map(l => l.replace(/^\s*-\s*/, '')).filter(Boolean)
    : [message.split('\n')[0]];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Landroof — setup needed</title>
<style>body{font-family:system-ui,sans-serif;background:#F8F9FB;color:#1A2233;padding:40px 20px}main{max-width:640px;margin:auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #E5E7EB}
h1{font-size:20px;color:#D93025;margin:0 0 12px}li{margin:6px 0}code{background:#f3f3f3;padding:2px 6px;border-radius:4px}p{color:#555;line-height:1.6}</style></head>
<body><main><h1>The site can't start yet</h1><ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
<p>Fix this in <strong>Vercel → Project → Settings → Environment Variables</strong>, then redeploy
(Deployments → ⋯ → Redeploy). See "Deploying on Vercel" in the README.</p></main></body></html>`;
}

module.exports = (req, res) => {
  if (app) return app(req, res);
  res.statusCode = 503;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(startupErrorPage(startError));
};
