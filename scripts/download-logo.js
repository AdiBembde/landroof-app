#!/usr/bin/env node
/**
 * Run this once after installation to download the Landroof logo:
 *   node download-logo.js
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const LOGO_URL = 'https://landroof.com/wp-content/uploads/2025/01/Landroof_header_logo.png';
const OUT_DIR  = path.join(__dirname, '..', 'public', 'images');
const OUT_FILE = path.join(OUT_DIR, 'landroof-logo.png');

fs.mkdirSync(OUT_DIR, { recursive: true });

https.get(LOGO_URL, res => {
  if (res.statusCode !== 200) {
    console.error('Download failed:', res.statusCode);
    process.exit(1);
  }
  const file = fs.createWriteStream(OUT_FILE);
  res.pipe(file);
  file.on('finish', () => { file.close(); console.log('Logo saved to', OUT_FILE); });
}).on('error', err => { console.error('Error:', err.message); process.exit(1); });
