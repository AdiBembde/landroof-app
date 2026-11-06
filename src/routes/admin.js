'use strict';
// Admin JSON API. Everything except /auth/login, /auth/refresh and /auth/logout requires
// a valid admin JWT (authentication) with the "admin" role (authorization).
const router = require('express').Router();
const admin = require('../controllers/adminController');
const property = require('../controllers/propertyController');
const lead = require('../controllers/leadController');
const contentController = require('../controllers/contentController');
const content = require('../models/content');
const { requireAdmin } = require('../middleware/auth');
const { singleImage, listingFiles, singleDocument } = require('../middleware/upload');
const listing = require('../controllers/listingAdminController');
const AuditLog = require('../models/AuditLog');
const { sameOriginOnly } = require('../middleware/security');
const asyncHandler = require('../utils/asyncHandler');

// Public auth endpoints (the refresh token travels in an httpOnly cookie scoped to /api/admin/auth)
router.use('/auth', sameOriginOnly);
router.post('/auth/login', asyncHandler(admin.login));
router.post('/auth/refresh', admin.refresh);
router.post('/auth/logout', admin.logout);

router.use(requireAdmin);

// Activity log: every successful change, plus lead exports (they contain personal data)
const VERBS = { POST: 'create', PUT: 'update', DELETE: 'delete' };
router.use((req, res, next) => {
  const isExport = req.method === 'GET' && req.path === '/leads' && req.query.csv === '1';
  if ((!VERBS[req.method] && !isExport) || req.path === '/privacy/erase') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    const [, target = '', targetId = ''] = req.path.split('/');
    AuditLog.record({
      actor: `admin:${req.auth.sub}`, action: isExport ? 'export' : VERBS[req.method], target,
      targetId: targetId || res.locals.createdId || '', req,
      details: req.method === 'POST' || req.method === 'PUT' ? (req.body?.title || req.body?.name || '') : '',
    });
  });
  next();
});

router.get('/auth/me', admin.me);
router.post('/auth/change-password', asyncHandler(admin.changePassword));
router.get('/stats', admin.stats);
router.get('/users', admin.users);
router.get('/leads', lead.adminList);
router.delete('/leads/:id', admin.deleteLead);
router.get('/audit', admin.auditLog);
router.post('/privacy/erase', admin.eraseByEmail);

router.get('/mail-settings', admin.getMailSettings);
router.put('/mail-settings', admin.saveMailSettings);
router.delete('/mail-settings', admin.resetMailSettings);
router.post('/mail-settings/test', asyncHandler(admin.testMail));
router.get('/site-config', admin.getSiteConfig);
router.put('/site-config', admin.updateSiteConfig);

router.get('/properties', property.adminList);
router.get('/properties/:id/details', listing.details);
router.post('/properties/:id/review', listing.review);
router.post('/properties/:id/verify', listing.verify);
router.post('/properties/:id/listing-status', listing.listingStatus);
router.post('/properties/:id/documents', singleDocument(), listing.uploadDocument);
router.put('/documents/:docId', listing.updateDocument);
router.delete('/documents/:docId', listing.deleteDocument);
router.get('/documents/:docId/file', listing.downloadDocument);
router.post('/properties/:id/plots', listing.createPlot);
router.post('/properties/:id/plots/bulk', listing.bulkPlots);
router.put('/plots/:plotId', listing.updatePlot);
router.delete('/plots/:plotId', listing.deletePlot);
router.post('/properties/:id/approvals', listing.createApproval);
router.put('/approvals/:approvalId', listing.updateApproval);
router.post('/approvals/:approvalId/review', listing.reviewApproval);
router.delete('/approvals/:approvalId', listing.deleteApproval);
router.get('/reports', listing.reports);
router.post('/reports/:id', listing.decideReport);

router.get('/listing-requests', admin.listingRequests);
router.post('/listing-requests/:id/decision', admin.decideRequest);
router.post('/listing-requests/:id/resend', admin.resendOwnerLink);
router.get('/owners', admin.owners);
router.post('/properties', listingFiles(), property.create);
router.put('/properties/:id', listingFiles(), property.update);
router.delete('/properties/:id', property.remove);

// Generic CRUD for every content type. Multer ignores non-multipart (JSON) requests,
// so the same routes accept both.
const adminContent = {
  testimonials: [content.Testimonial],
  team: [content.TeamMember, 'image'],
  cities: [content.City, 'image'],
  events: [content.Event, 'image'],
  announcements: [content.Announcement],
  schemes: [content.Scheme, 'image'],
  'social-posts': [content.SocialPost, 'image'],
  media: [content.Media, 'image'],
};
for (const [path, [Model, fileField]] of Object.entries(adminContent)) {
  const c = contentController(Model);
  const files = fileField ? [singleImage(fileField)] : [];
  router.get(`/${path}`, c.list);
  router.post(`/${path}`, ...files, c.create);
  router.put(`/${path}/:id`, ...files, c.update);
  router.delete(`/${path}/:id`, c.remove);
}

module.exports = router;
