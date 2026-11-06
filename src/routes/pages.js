'use strict';
// HTML pages and SEO files.
const router = require('express').Router();
const page = require('../controllers/pageController');

router.get('/', page.home);
router.get(['/property/:id(\\d+)', '/project/:id(\\d+)'], page.listing);
router.get(['/admin', '/admin/*'], page.admin);
router.get('/robots.txt', page.robots);
router.get('/sitemap.xml', page.sitemap);

module.exports = router;
