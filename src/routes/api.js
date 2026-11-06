'use strict';
// Public JSON API used by the website (no admin rights needed).
const router = require('express').Router();
const property = require('../controllers/propertyController');
const lead = require('../controllers/leadController');
const auth = require('../controllers/authController');
const admin = require('../controllers/adminController');
const contentController = require('../controllers/contentController');
const content = require('../models/content');
const { requireUser } = require('../middleware/auth');
const { limiters } = require('../middleware/rateLimit');
const asyncHandler = require('../utils/asyncHandler');
const owner = require('../controllers/ownerController');
const { listingFiles } = require('../middleware/upload');
const Property = require('../models/Property');
const ListingReport = require('../models/ListingReport');
const { sameOriginOnly } = require('../middleware/security');

// Listings
router.get('/properties', property.list);
router.get('/properties/:id', property.show);
router.get('/properties/:id/similar', property.similar);
router.get('/properties/:id/plots', property.plots);
router.post('/properties/:id/report', limiters.leads.middleware(), property.report);
router.get('/property-suggestions', property.suggestions);
router.get('/documents/:id', property.publicDocument);
// Choices for the search filters and listing forms
router.get('/listing-options', (_req, res) => res.json({ ok: true, data: {
  amenities: Property.AMENITIES, furnishing: Property.FURNISHING.filter(Boolean), age_bands: Property.AGE_BANDS.filter(Boolean),
  report_reasons: ListingReport.REASONS,
} }));
router.get('/city-counts', property.cityCounts);

// Website content managed from the admin panel
const publicContent = {
  testimonials: content.Testimonial,
  team: content.TeamMember,
  cities: content.City,
  events: content.Event,
  announcements: content.Announcement,
  schemes: content.Scheme,
  'social-posts': content.SocialPost,
  media: content.Media,
};
for (const [path, Model] of Object.entries(publicContent)) {
  router.get(`/${path}`, contentController(Model).listPublic);
}
router.get('/site-config', admin.publicSiteConfig);

// Lead capture (search, enquiries, contact forms)
router.post('/leads', limiters.leads.middleware(), lead.create);

// Visitor accounts (JWT access token + httpOnly refresh cookie scoped to /api/auth)
// Endpoints that set or use the refresh cookie only accept same-site requests
router.use(['/auth/login', '/auth/register', '/auth/reset-password', '/auth/refresh', '/auth/logout', '/auth/change-password', '/auth/owner-link'], sameOriginOnly);
router.post('/auth/register', asyncHandler(auth.register));
router.post('/auth/login', asyncHandler(auth.login));
router.post('/auth/forgot-password', auth.forgotPassword);
router.post('/auth/reset-password', asyncHandler(auth.resetPassword));
router.post('/auth/refresh', auth.refresh);
router.post('/auth/logout', auth.logout);
router.post('/auth/logout-all', requireUser, auth.logoutAll);
router.post('/auth/change-password', requireUser, asyncHandler(auth.changePassword));
router.get('/auth/me', requireUser, auth.me);
router.post('/auth/owner-link', asyncHandler(auth.ownerLink));

// Owners (approved "List your property" requests) manage their own listings; each one is reviewed before it goes live
router.get('/owner/properties', requireUser, owner.list);
router.post('/owner/properties', requireUser, owner.requireOwner, listingFiles(), owner.create);
router.put('/owner/properties/:id', requireUser, owner.requireOwner, listingFiles(), owner.update);
router.post('/owner/properties/:id/status', requireUser, owner.requireOwner, owner.setStatus);
router.get('/owner/properties/:id/history', requireUser, owner.history);
router.delete('/owner/properties/:id', requireUser, owner.remove);

// Saved properties — signed-in visitors only
router.get('/wishlist', requireUser, auth.getWishlist);
router.put('/wishlist', requireUser, auth.setWishlist);

module.exports = router;
