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
