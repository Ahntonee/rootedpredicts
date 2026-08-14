// routes/marketing.js
// Rooted Predictions — SEO Pages, Backlinks, Ads, Announcements routes
'use strict';

const express  = require('express');
const router   = express.Router();
const mkt      = require('../controllers/marketing');
const { authenticate, requireAdmin, requireAdminRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');

// ── Public endpoints (no auth) ────────────────────────────────────────────────
router.get('/backlinks/active',           asyncHandler(mkt.getActiveBacklinks));
router.get('/ads/placement/:placement',   asyncHandler(mkt.getAdsByPlacement));
router.post('/ads/:id/impression',        asyncHandler(mkt.trackImpression));
router.get('/ads/:id/click',              asyncHandler(mkt.trackClick));
router.get('/announcements/active',       asyncHandler(mkt.getActiveAnnouncements));

// ── Admin-only endpoints ──────────────────────────────────────────────────────
router.use(authenticate, requireAdmin);

// SEO Pages
router.get   ('/seo-pages',                 asyncHandler(mkt.listSeoPages));
router.get   ('/seo-pages/blog-import',     asyncHandler(mkt.getBlogPostsForImport));
router.get   ('/seo-pages/:id',             asyncHandler(mkt.getSeoPage));
router.post  ('/seo-pages',                 requireAdminRole('superadmin','editor'), asyncHandler(mkt.createSeoPage));
router.put   ('/seo-pages/:id',             requireAdminRole('superadmin','editor'), asyncHandler(mkt.updateSeoPage));
router.delete('/seo-pages/:id',             requireAdminRole('superadmin'),          asyncHandler(mkt.deleteSeoPage));

// Backlinks
router.get   ('/backlinks',                 asyncHandler(mkt.listBacklinks));
router.post  ('/backlinks',                 requireAdminRole('superadmin','editor'), asyncHandler(mkt.createBacklink));
router.put   ('/backlinks/:id',             requireAdminRole('superadmin','editor'), asyncHandler(mkt.updateBacklink));
router.post  ('/backlinks/:id/renew',       requireAdminRole('superadmin','editor'), asyncHandler(mkt.renewBacklink));
router.delete('/backlinks/:id',             requireAdminRole('superadmin'),          asyncHandler(mkt.deleteBacklink));

// Ads
router.get   ('/ads',                       asyncHandler(mkt.listAds));
router.get   ('/ads/:id',                   asyncHandler(mkt.getAd));
router.post  ('/ads',                       requireAdminRole('superadmin','editor'), asyncHandler(mkt.createAd));
router.put   ('/ads/:id',                   requireAdminRole('superadmin','editor'), asyncHandler(mkt.updateAd));
router.post  ('/ads/:id/toggle',            requireAdminRole('superadmin','editor'), asyncHandler(mkt.toggleAd));
router.delete('/ads/:id',                   requireAdminRole('superadmin'),          asyncHandler(mkt.deleteAd));

// Announcements
router.get   ('/announcements',             asyncHandler(mkt.listAnnouncements));
router.post  ('/announcements',             requireAdminRole('superadmin','editor'), asyncHandler(mkt.createAnnouncement));
router.put   ('/announcements/:id',         requireAdminRole('superadmin','editor'), asyncHandler(mkt.updateAnnouncement));
router.post  ('/announcements/:id/publish', requireAdminRole('superadmin','editor'), asyncHandler(mkt.publishAnnouncement));
router.delete('/announcements/:id',         requireAdminRole('superadmin'),          asyncHandler(mkt.deleteAnnouncement));

module.exports = router;
