// routes/subscriptions.js
// Rooted Predictions — VIP subscription endpoints
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/subscriptions');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');

// GET /api/subscriptions/bank-details — public, no auth needed
router.get('/bank-details', asyncHandler(ctrl.getBankDetails));
router.get('/pricing', asyncHandler(async (req, res) => {
  const pricing = require('../services/planPricing');
  const currency = String(req.query.currency || 'NGN').toUpperCase();
  try {
    return res.json({ success: true, data: await pricing.quote(currency) });
  } catch (_) {
    return res.json({ success: true, data: { ...await pricing.quote('NGN'), notice: 'Conversion is unavailable. Showing the exact naira price.' } });
  }
}));

// All routes below require a logged-in user
router.use(authenticate);
router.get('/notifications', asyncHandler(async (req, res) => {
  const db = require('../config/db');
  await require('../services/subscriptionExpiry').expireDue(db, req.user.id);
  const [rows] = await db.query(
    `SELECT id, plan, status, notes, reviewed_at FROM payment_submissions
     WHERE user_id = ? AND status IN ('approved', 'rejected') AND notification_read_at IS NULL
     ORDER BY reviewed_at ASC, id ASC`, [req.user.id]);
  res.setHeader('Cache-Control', 'no-store');
  const [expired] = await db.query(`SELECT CONCAT('expiry-', id) AS id, plan, 'expired' AS status, created_at AS reviewed_at
    FROM subscription_expiry_notifications WHERE user_id=? AND read_at IS NULL ORDER BY id`, [req.user.id]);
  res.json({ success: true, data: [...rows, ...expired] });
}));
router.post('/notifications/:id/read', asyncHandler(async (req, res) => {
  const db = require('../config/db');
  if (/^expiry-\d+$/.test(req.params.id)) {
    await db.query('UPDATE subscription_expiry_notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=? AND user_id=?', [req.params.id.slice(7), req.user.id]);
    return res.json({ success: true });
  }
  await db.query(
    `UPDATE payment_submissions SET notification_read_at = COALESCE(notification_read_at, NOW())
     WHERE id = ? AND user_id = ? AND status IN ('approved', 'rejected')`,
    [req.params.id, req.user.id]);
  res.json({ success: true });
}));
router.post('/manual/quote', asyncHandler(async (req, res) => {
  try {
    const data = await require('../services/manualPayments').createQuote(req.user.id, req.body.plan, req.body.method);
    res.json({success:true,data});
  } catch (e) { res.status(400).json({success:false,message:e.message}); }
}));

// GET  /api/subscriptions/status
router.get('/status', asyncHandler(ctrl.getStatus));

// POST /api/subscriptions/stripe/create-checkout
router.post('/stripe/create-checkout', asyncHandler(ctrl.stripeCreateCheckout));

// POST /api/subscriptions/paystack/initialize
router.post('/paystack/initialize', asyncHandler(ctrl.paystackInitialize));

// POST /api/subscriptions/paystack/verify
router.post('/paystack/verify', asyncHandler(ctrl.paystackVerify));

// POST /api/subscriptions/cancel
router.post('/cancel', asyncHandler(ctrl.cancelSubscription));

// POST /api/subscriptions/admin/grant — admin manually grants VIP
router.post('/admin/grant', requireAdmin, asyncHandler(ctrl.adminGrantVip));

// POST /api/subscriptions/manual/submit — user submits bank transfer proof
router.post('/manual/submit', asyncHandler(ctrl.manualSubmit));

// GET /api/subscriptions/my-payments — user's own payment submission history
router.get('/my-payments', asyncHandler(ctrl.getMyPayments));

module.exports = router;
