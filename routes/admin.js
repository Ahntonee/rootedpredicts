// routes/admin.js
// Rooted Predictions — Admin API routes
'use strict';

const express    = require('express');
const router     = express.Router();
const admin      = require('../controllers/admin');
const subCtrl    = require('../controllers/subscriptions');
const { authenticate, requireAdmin, requireAdminRole } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// ── Dashboard ──────────────────────────────────────────────────
router.get('/stats', asyncHandler(admin.getStats));
router.get('/request-diagnostics', requireAdminRole('superadmin'), (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, data: { client_ip: req.ip, proxy_chain: req.ips,
    socket_ip: req.socket.remoteAddress, trust_proxy: req.app.get('trust proxy'),
    account_quota: req.rateLimitSession ? 'account:' + req.rateLimitSession.id : 'ip' } });
});
router.put('/predictions/:id/homepage', requireAdminRole('superadmin','editor'), asyncHandler(async (req, res) => {
  try {
    await require('../services/homepagePicks').selectHomepagePick(require('../config/db'), req.params.id, req.body.selected);
    res.json({ success: true, message: req.body.selected ? 'Added to homepage.' : 'Removed from homepage. Still published in its category.' });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
}));
router.post('/users/:id/notify-expiry', requireAdminRole('superadmin'), asyncHandler(async (req, res) => {
  const db = require('../config/db');
  const expiry = require('../services/subscriptionExpiry');
  await expiry.expireDue(db, req.params.id);
  const [rows] = await db.query(`SELECT n.id FROM subscription_expiry_notifications n
    WHERE n.user_id=? AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id=n.user_id
      AND s.status IN ('active','trialing','cancelled') AND s.expires_at > NOW()) ORDER BY n.id DESC LIMIT 1`, [req.params.id]);
  if (!rows.length) return res.status(409).json({ success: false, message: 'This user has no expired subscription to notify about, or already has an active plan.' });
  await db.query('UPDATE subscription_expiry_notifications SET read_at=NULL, email_sent_at=NULL WHERE id=?', [rows[0].id]);
  const sent = await expiry.sendExpiryEmails(db, req.params.id);
  res.json({ success: true, message: sent ? 'Expiry email sent and login popup queued.' : 'Login popup queued. Email is queued for retry.' });
}));
router.post('/users/:id/grant-vip', requireAdminRole('superadmin'), asyncHandler((req, res) => {
  req.body.user_id = req.params.id;
  return subCtrl.adminGrantVip(req, res);
}));

// ── Predictions ────────────────────────────────────────────────
// Read: all admin roles
router.get ('/predictions',               asyncHandler(admin.getPredictions));
// literal sub-routes MUST be before /:id so Express doesn't match them as ids
router.get ('/predictions/multi-tip',     asyncHandler(admin.getMultiTipReview));
router.post('/predictions/batch',         requireAdminRole('superadmin','editor'), asyncHandler(admin.batchPredictions));
router.get ('/predictions/:id',           asyncHandler(admin.getPrediction));
// Write: superadmin + editor
router.post('/predictions',               requireAdminRole('superadmin','editor'), asyncHandler(admin.createPrediction));
router.put ('/predictions/:id',           requireAdminRole('superadmin','editor'), asyncHandler(admin.updatePrediction));
router.post('/predictions/:id/score',        requireAdminRole('superadmin','editor'), asyncHandler(admin.scorePrediction));
router.post('/predictions/:id/grade-manual', requireAdminRole('superadmin','editor'), asyncHandler(admin.gradeManual));
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

// ── Payment submissions (superadmin only) ──────────────────────
router.get ('/payment-submissions',              requireAdminRole('superadmin'), asyncHandler(subCtrl.adminListSubmissions));
router.get ('/payment-submissions/:id/image',    requireAdminRole('superadmin'), asyncHandler(subCtrl.adminViewImage));
router.post('/payment-submissions/:id/approve',  requireAdminRole('superadmin'), asyncHandler(subCtrl.adminApproveSubmission));
router.post('/payment-submissions/:id/reject',   requireAdminRole('superadmin'), asyncHandler(subCtrl.adminRejectSubmission));

// ── Newsletter (superadmin only) ───────────────────────────────
const nlCtrl = require('../controllers/newsletter');
router.get ('/newsletter/subscribers', requireAdminRole('superadmin'), asyncHandler(nlCtrl.adminListSubscribers));
router.post('/newsletter/send',        requireAdminRole('superadmin'), asyncHandler(nlCtrl.adminSend));

module.exports = router;
