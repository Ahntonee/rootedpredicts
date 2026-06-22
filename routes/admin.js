// routes/admin.js
// Rooted Predictions — Admin API routes
'use strict';

const express    = require('express');
const router     = express.Router();
const admin      = require('../controllers/admin');
const { authenticate, requireAdmin, requireAdminRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// ── Dashboard ──────────────────────────────────────────────────
router.get('/stats', asyncHandler(admin.getStats));

// ── Predictions ────────────────────────────────────────────────
// Read: all admin roles
router.get ('/predictions',               asyncHandler(admin.getPredictions));
router.get ('/predictions/:id',           asyncHandler(admin.getPrediction));
// Write: superadmin + editor
router.post('/predictions',               requireAdminRole('superadmin','editor'), asyncHandler(admin.createPrediction));
router.put ('/predictions/:id',           requireAdminRole('superadmin','editor'), asyncHandler(admin.updatePrediction));
router.post('/predictions/:id/score',     requireAdminRole('superadmin','editor'), asyncHandler(admin.scorePrediction));
router.post('/predictions/score-all',     requireAdminRole('superadmin','editor'), asyncHandler(admin.scoreAllPredictions));
router.post('/predictions/preview-score', requireAdminRole('superadmin','editor'), asyncHandler(admin.previewScore));
// Delete: superadmin only
router.delete('/predictions/:id',         requireAdminRole('superadmin'), asyncHandler(admin.deletePrediction));

// ── Users ──────────────────────────────────────────────────────
// Read: superadmin only
router.get('/users',     requireAdminRole('superadmin'), asyncHandler(admin.getUsers));
router.put('/users/:id', requireAdminRole('superadmin'), asyncHandler(admin.updateUser));

// ── Leagues ────────────────────────────────────────────────────
router.get('/leagues',       asyncHandler(admin.getLeagues));
router.put('/leagues/:id',   requireAdminRole('superadmin','editor'), asyncHandler(admin.updateLeague));

// ── Image upload ───────────────────────────────────────────────
router.post('/upload/image', requireAdminRole('superadmin','editor'), asyncHandler(admin.uploadBlogImage));

// ── Blog ───────────────────────────────────────────────────────
router.get   ('/blog',       requireAdminRole('superadmin','editor'), asyncHandler(admin.getBlogPosts));
router.post  ('/blog',       requireAdminRole('superadmin','editor'), asyncHandler(admin.createBlogPost));
router.get   ('/blog/:id',   requireAdminRole('superadmin','editor'), asyncHandler(admin.getBlogPost));
router.put   ('/blog/:id',   requireAdminRole('superadmin','editor'), asyncHandler(admin.updateBlogPost));
router.delete('/blog/:id',   requireAdminRole('superadmin','editor'), asyncHandler(admin.deleteBlogPost));

// ── SEO ────────────────────────────────────────────────────────
router.get('/seo',           asyncHandler(admin.getSeoSettings));
router.put('/seo/:page',     requireAdminRole('superadmin','editor'), asyncHandler(admin.updateSeoSettings));

// ── Homepage stat overrides ────────────────────────────────────
router.get('/site-stats',    asyncHandler(admin.getSiteStats));
router.put('/site-stats',    requireAdminRole('superadmin'), asyncHandler(admin.updateSiteStats));

// ── Prediction form helpers ────────────────────────────────────
router.get('/form/leagues',  requireAdminRole('superadmin','editor'), asyncHandler(admin.getFormLeagues));
router.get('/form/fixtures', requireAdminRole('superadmin','editor'), asyncHandler(admin.getLeagueFixtures));
router.get('/form/odds',     requireAdminRole('superadmin','editor'), asyncHandler(admin.getFixtureOdds));

// ── Audit log ──────────────────────────────────────────────────
router.get('/audit', asyncHandler(admin.getAuditLog));

// ── Admin profile (own account) ────────────────────────────────
router.get('/profile',          asyncHandler(admin.getProfile));
router.put('/profile',          asyncHandler(admin.updateProfile));
router.put('/profile/password', asyncHandler(admin.changePassword));

// ── Admin account management (superadmin only) ─────────────────
router.get   ('/admins',     requireAdminRole('superadmin'), asyncHandler(admin.getAdmins));
router.post  ('/admins',     requireAdminRole('superadmin'), asyncHandler(admin.createAdminAccount));
router.put   ('/admins/:id', requireAdminRole('superadmin'), asyncHandler(admin.updateAdminAccount));
router.delete('/admins/:id', requireAdminRole('superadmin'), asyncHandler(admin.deleteAdminAccount));

module.exports = router;
