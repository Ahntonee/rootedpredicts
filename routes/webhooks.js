// routes/webhooks.js
// AfroPredict — Payment provider webhook receivers
// IMPORTANT: Stripe webhook requires raw body (handled in server.js middleware)
'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/subscriptions');

// POST /api/webhooks/stripe   — Stripe sends signed events here
router.post('/stripe', express.raw({ type: 'application/json' }), ctrl.stripeWebhook);

// POST /api/webhooks/paystack — Paystack sends charge events here
router.post('/paystack', express.json(), ctrl.paystackWebhook);

module.exports = router;
