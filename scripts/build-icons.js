#!/usr/bin/env node
'use strict';
// Renders public/favicon.svg into the PNG / ICO icons the site links to, using a local
// Chrome or Edge in headless mode. Run after changing the SVG:  npm run build-icons
//
// Writes to public/: favicon.ico (16+32+48), favicon-32.png, apple-touch-icon.png (180, no
// transparency — iOS fills it with black), icon-192.png and icon-512.png (web app manifest).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PUBLIC = path.join(__dirname, '..', 'public');
const svg = fs.readFileSync(path.join(PUBLIC, 'favicon.svg'), 'utf8');
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const browser = BROWSERS.find(p => fs.existsSync(p));
if (!browser) { console.error('No Chrome / Edge found — set CHROME_PATH.'); process.exit(1); }

const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`, '--disable-gpu',
    `--user-data-dir=${path.join(os.tmpdir(), 'lr-icons')}`, 'about:blank']);
  try {
    let targets;
    for (let i = 0; i < 60 && !targets; i++) {
      try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await wait(250); }
    }
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(r => { ws.onopen = r; });
    let id = 0; const pending = {};
    ws.onmessage = m => { const d = JSON.parse(m.data); if (pending[d.id]) { pending[d.id](d.result); delete pending[d.id]; } };
    const send = (method, params = {}) => new Promise(r => { pending[++id] = r; ws.send(JSON.stringify({ id, method, params })); });

    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const render = async (size, { square = false } = {}) => {
      // The Apple icon must be opaque and square — iOS adds its own rounded mask
      const mark = square ? svg.replace(/rx="\d+"/, 'rx="0"') : svg;
      const html = `<html><body style="margin:0;background:transparent">${mark.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`;
      await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
      await wait(300);
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
      return Buffer.from(shot.data, 'base64');
    };

    const out = (name, buf) => { fs.writeFileSync(path.join(PUBLIC, name), buf); console.log('wrote public/' + name); };
    const png16 = await render(16), png32 = await render(32), png48 = await render(48);
    out('favicon-32.png', png32);
    out('apple-touch-icon.png', await render(180, { square: true }));
    out('icon-192.png', await render(192));
    out('icon-512.png', await render(512));
    out('favicon.ico', ico([[16, png16], [32, png32], [48, png48]]));
    ws.close();
  } finally {
    proc.kill();
  }
}

/** An .ico file that embeds PNG images (supported by every current browser and Windows Vista+) */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(([size, data]) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map(([, data]) => data)]);
}

main().catch(e => { console.error(e); process.exit(1); });
