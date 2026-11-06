'use strict';
// Serves the HTML views, robots.txt and sitemap.xml.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SITE_URL, NODE_ENV } = require('../config/env');
const Property = require('../models/Property');

const VIEWS = path.join(__dirname, '..', 'views');
const ROOT = path.join(__dirname, '..', '..');
const cache = new Map();

// Browsers cache /css, /js and /shared for a day, so each link gets ?v=<hash of the file>:
// a deploy that changes a file changes its URL, and the HTML never meets a stale stylesheet.
// If a file can't be read (e.g. not bundled with the serverless function), the deploy's
// commit or the start-up time is used instead — still unique per deploy.
const DEPLOY_VERSION = (process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(36)).slice(0, 10);
function assetVersion(url) {
  const file = url.startsWith('/shared/') ? path.join(ROOT, url) : path.join(ROOT, 'public', url);
  try { return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10); }
  catch { return DEPLOY_VERSION; }
}
const versionAssets = html => html.replace(/(href|src)="(\/(?:css|js|shared)\/[^"?#]+)"/g,
  (_m, attr, url) => `${attr}="${url}?v=${assetVersion(url)}"`);

/** Reads a view, fills {{SITE_URL}} / {{YEAR}} and versions asset links. Cached in production. */
function render(name) {
  if (NODE_ENV === 'production' && cache.has(name)) return cache.get(name);
  const html = versionAssets(fs.readFileSync(path.join(VIEWS, name), 'utf8')
    .replace(/\{\{SITE_URL\}\}/g, SITE_URL)
    .replace(/\{\{YEAR\}\}/g, String(new Date().getFullYear())));
  cache.set(name, html);
  return html;
}

exports.home = (_req, res) => res.type('html').send(render('index.html'));

const attr = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const listingUrl = p => `${SITE_URL}/${p.is_project ? 'project' : 'property'}/${p.id}`;

/** /property/12, /project/9: the website, with the title, description and share image of that listing */
exports.listing = (req, res) => {
  const p = Property.findLive(req.params.id);
  if (!p) return res.status(404).type('html').send(render('404.html'));
  const url = listingUrl(p);
  const title = `${p.title} — ${[p.locality, p.city].filter(Boolean).join(', ')} | Landroof`;
  const summary = String(p.description || '').replace(/\s+/g, ' ').trim().slice(0, 155);
  const description = `${p.price_label}. ${summary}`.trim();
  const image = p.image_url ? SITE_URL + p.image_url : `${SITE_URL}/images/landroof-logo.png`;
  const data = {
    '@context': 'https://schema.org', '@type': 'RealEstateListing', name: p.title, url, description: summary, image,
    datePosted: String(p.published_at || p.created_at || '').slice(0, 10),
    address: { '@type': 'PostalAddress', addressLocality: p.locality || p.city, addressRegion: p.city, addressCountry: 'IN' },
    ...(p.price_val > 0 ? { offers: { '@type': 'Offer', price: p.price_val, priceCurrency: 'INR', availability: p.listing_status === 'active' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut' } } : {}),
  };
  const html = render('index.html')
    .replace(/<title>[^<]*<\/title>/, `<title>${attr(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, (_m, a) => a + attr(description))
    .replace(/(<link rel="canonical" href=")[^"]*/, (_m, a) => a + attr(url))
    .replace(/(<meta property="og:title" content=")[^"]*/, (_m, a) => a + attr(title))
    .replace(/(<meta property="og:description" content=")[^"]*/, (_m, a) => a + attr(description))
    .replace(/(<meta property="og:image" content=")[^"]*/, (_m, a) => a + attr(image))
    .replace(/(<meta property="og:url" content=")[^"]*/, (_m, a) => a + attr(url))
    .replace(/(<meta name="twitter:title" content=")[^"]*/, (_m, a) => a + attr(title))
    .replace(/(<meta name="twitter:description" content=")[^"]*/, (_m, a) => a + attr(description))
    .replace('</head>', () => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>\n</head>`)
    .replace(/href="\?/g, 'href="/?'); // search links must not stay under /property/
  res.type('html').send(html);
};

exports.admin = (_req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.type('html').send(render('admin.html'));
};

exports.robots = (_req, res) => {
  res.type('text/plain').send(
`User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin

Sitemap: ${SITE_URL}/sitemap.xml
`);
};

exports.sitemap = (_req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const urls = [{ loc: '/', priority: '1.0', freq: 'daily' }];

  // One URL per listing type, and per type+city combination that actually has listings.
  // The homepage reads ?type= and ?city= and shows those listings.
  Property.TYPES.forEach(type => urls.push({ loc: `/?type=${type}`, priority: '0.9', freq: 'daily' }));
  Property.cities().forEach(city => {
    Property.TYPES.forEach(type => {
      if (Property.search({ type, city, limit: 1 }).length) {
        urls.push({ loc: `/?type=${type}&city=${encodeURIComponent(city)}`, priority: '0.8', freq: 'daily' });
      }
    });
  });

  // Every live listing (projects open their project page)
  Property.search({ limit: 500, sort: 'newest' }).forEach(p => {
    urls.push({ loc: `/${p.is_project ? 'project' : 'property'}/${p.id}`, priority: p.is_project ? '0.8' : '0.6', freq: 'weekly' });
  });

  const xmlEscape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${xmlEscape(SITE_URL + u.loc)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.freq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;
  res.type('application/xml').send(xml);
};
