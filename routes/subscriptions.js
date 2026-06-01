// routes/subscriptions.js
// Rooted Predictions — VIP subscription endpoints
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/subscriptions');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');

// All subscription routes require a logged-in user
router.use(authenticate);

// GET  /api/subscriptions/status          — current user's sub status
router.get('/status', asyncHandler(ctrl.getStatus));

// POST /api/subscriptions/stripe/create-checkout
router.post('/stripe/create-checkout', asyncHandler(ctrl.stripeCreateCheckout));

// POST /api/subscriptions/paystack/initialize
router.post('/paystack/initialize', asyncHandler(ctrl.paystackInitialize));

// POST /api/subscriptions/paystack/verify — verify after Paystack redirect
router.post('/paystack/verify', asyncHandler(ctrl.paystackVerify));

// POST /api/subscriptions/cancel
router.post('/cancel', asyncHandler(ctrl.cancelSubscription));

// POST /api/subscriptions/admin/grant     — admin manually grants VIP
router.post('/admin/grant', requireAdmin, asyncHandler(ctrl.adminGrantVip));

module.exports = router;
