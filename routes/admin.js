// routes/admin.js
// AfroPredict — Admin API routes (admin role only)
'use strict';

const express    = require('express');
const router     = express.Router();
const admin      = require('../controllers/admin');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// Dashboard
router.get('/stats', asyncHandler(admin.getStats));

// Predictions
router.get   ('/predictions',          asyncHandler(admin.getPredictions));
router.post  ('/predictions',          asyncHandler(admin.createPrediction));
router.put   ('/predictions/:id',      asyncHandler(admin.updatePrediction));
router.delete('/predictions/:id',      asyncHandler(admin.deletePrediction));
router.post  ('/predictions/score-all',   asyncHandler(admin.scoreAllPredictions));
router.post  ('/predictions/preview-score',asyncHandler(admin.previewScore));
router.post  ('/predictions/:id/score',   asyncHandler(admin.scorePrediction));

// Users
router.get('/users',         asyncHandler(admin.getUsers));
router.put('/users/:id',     asyncHandler(admin.updateUser));

// Leagues
router.get('/leagues',       asyncHandler(admin.getLeagues));
router.put('/leagues/:id',   asyncHandler(admin.updateLeague));

// Blog
router.get   ('/blog',       asyncHandler(admin.getBlogPosts));
router.post  ('/blog',       asyncHandler(admin.createBlogPost));
router.put   ('/blog/:id',   asyncHandler(admin.updateBlogPost));
router.delete('/blog/:id',   asyncHandler(admin.deleteBlogPost));

// SEO
router.get('/seo',             asyncHandler(admin.getSeoSettings));
router.put('/seo/:page',       asyncHandler(admin.updateSeoSettings));

module.exports = router;
