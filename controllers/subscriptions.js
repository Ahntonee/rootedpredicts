// controllers/subscriptions.js
// Rooted Predictions — VIP subscription logic (Stripe + Paystack + manual grant)
'use strict';

const db     = require('../config/db');
const fs     = require('fs');
const path   = require('path');
const { randomUUID } = require('crypto');
const { sendMail }   = require('../services/mailer');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'payment-proofs');
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES    = 5 * 1024 * 1024; // 5 MB decoded
const stripe = process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('your_')
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

// Plan config
const PLANS = {
  monthly:   { amount: 4.89,  currency: 'usd', days: 30,  trial_days: 3 },
  quarterly: { amount: 12.99, currency: 'usd', days: 90,  trial_days: 0 },
  annual:    { amount: 39.99, currency: 'usd', days: 365, trial_days: 0 },
};

// Paystack amounts in kobo (NGN) — approximate at ₦1,600/$ rate
const PAYSTACK_AMOUNTS = {
  monthly:   800000,   // ~$4.89 ≈ ₦8,000
  quarterly: 2080000,  // ~$12.99 ≈ ₦20,800
  annual:    6400000,  // ~$39.99 ≈ ₦64,000
};

// ── GET /api/subscriptions/status
async function getStatus(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT id, plan, status, starts_at, expires_at, trial_ends_at, cancelled_at, currency, amount, created_at
       FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    const sub = rows[0] || null;

    // Auto-expire: if expires_at has passed, mark expired and demote user
    if (sub && sub.status === 'active' && sub.expires_at && new Date(sub.expires_at) < new Date()) {
      await db.query(`UPDATE subscriptions SET status='expired', updated_at=NOW() WHERE id=?`, [sub.id]);
      await db.query(`UPDATE users SET role='user', updated_at=NOW() WHERE id=?`, [req.user.id]);
      sub.status = 'expired';
    }

    // Auto-convert trial: if trial_ends_at has passed and still trialing, mark active
    if (sub && sub.status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at) < new Date()) {
      await db.query(`UPDATE subscriptions SET status='active', updated_at=NOW() WHERE id=?`, [sub.id]);
      sub.status = 'active';
    }

    return res.json({ success: true, data: sub });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// ── POST /api/subscriptions/stripe/create-checkout
async function stripeCreateCheckout(req, res) {
  try {
    if (!stripe) {
      return res.status(503).json({ success: false, message: 'Stripe is not configured on this server yet.' });
    }

    const { plan } = req.body;
    if (!PLANS[plan]) {
      return res.status(400).json({ success: false, message: 'Invalid plan. Choose monthly, quarterly, or annual.' });
    }

    const planConfig = PLANS[plan];
    const priceId = process.env[`STRIPE_PRICE_${plan.toUpperCase()}`];
    if (!priceId || priceId.includes('_id_here')) {
      return res.status(503).json({ success: false, message: 'Stripe price IDs not configured yet.' });
    }

    // Ensure Stripe customer exists
    let customerId = req.user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name:  req.user.name,
        metadata: { rootedpredict_user_id: String(req.user.id) },
      });
      customerId = customer.id;
      await db.query(`UPDATE users SET stripe_customer_id=? WHERE id=?`, [customerId, req.user.id]);
    }

    const sessionParams = {
      customer:   customerId,
      mode:       'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.SITE_URL}/dashboard.html?vip=success&plan=${plan}`,
      cancel_url:  `${process.env.SITE_URL}/pricing.html?cancelled=1`,
      metadata:    { user_id: String(req.user.id), plan },
      subscription_data: { metadata: { user_id: String(req.user.id), plan } },
    };

    // Add 3-day trial for monthly plan
    if (plan === 'monthly' && planConfig.trial_days > 0) {
      sessionParams.subscription_data.trial_period_days = planConfig.trial_days;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.json({ success: true, data: { url: session.url } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// ── POST /api/subscriptions/paystack/initialize
async function paystackInitialize(req, res) {
  try {
    const { plan } = req.body;
    if (!PLANS[plan]) {
      return res.status(400).json({ success: false, message: 'Invalid plan.' });
    }

    const paystackKey = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackKey || paystackKey.includes('your_')) {
      return res.status(503).json({ success: false, message: 'Paystack is not configured on this server yet.' });
    }

    const reference = `RP-${req.user.id}-${plan}-${Date.now()}`;
    const amount    = PAYSTACK_AMOUNTS[plan];

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${paystackKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email:        req.user.email,
        amount,
        reference,
        currency:     'NGN',
        callback_url: `${process.env.SITE_URL}/dashboard.html?vip=success&plan=${plan}&provider=paystack`,
        metadata: {
          user_id:  req.user.id,
          plan,
          cancel_action: `${process.env.SITE_URL}/pricing.html`,
        },
      }),
    });

    const data = await response.json();
    if (!data.status) {
      return res.status(502).json({ success: false, message: data.message || 'Paystack error' });
    }

    return res.json({ success: true, data: { url: data.data.authorization_url, reference } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// ── POST /api/subscriptions/paystack/verify  (called after redirect)
async function paystackVerify(req, res) {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ success: false, message: 'Reference required' });

    const paystackKey = process.env.PAYSTACK_SECRET_KEY;
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${paystackKey}` },
    });
    const data = await response.json();

    if (!data.status || data.data.status !== 'success') {
      return res.status(402).json({ success: false, message: 'Payment not confirmed.' });
    }

    // Extract plan from reference: RP-{userId}-{plan}-{ts}
    const parts = reference.split('-');
    const plan  = parts[2];
    if (!PLANS[plan]) return res.status(400).json({ success: false, message: 'Unknown plan in reference.' });

    await _activateSubscription(req.user.id, plan, {
      paystack_reference: reference,
      amount:   PLANS[plan].amount,
      currency: 'NGN',
    });

    return res.json({ success: true, message: 'VIP activated successfully!' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// ── POST /api/subscriptions/cancel
async function cancelSubscription(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT * FROM subscriptions WHERE user_id=? AND status IN ('active','trialing') ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'No active subscription found.' });

    const sub = rows[0];

    // Cancel on Stripe if applicable
    if (stripe && sub.stripe_subscription_id) {
      await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
    }

    await db.query(
      `UPDATE subscriptions SET status='cancelled', cancelled_at=NOW(), updated_at=NOW() WHERE id=?`,
      [sub.id]
    );

    // Keep VIP role until expires_at, demote only if already past
    if (!sub.expires_at || new Date(sub.expires_at) < new Date()) {
      await db.query(`UPDATE users SET role='user', updated_at=NOW() WHERE id=?`, [req.user.id]);
    }

    return res.json({ success: true, message: 'Subscription cancelled. Access continues until expiry.' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// ── POST /api/subscriptions/admin/grant  (admin manually grants VIP)
async function adminGrantVip(req, res) {
  try {
    const { user_id, plan = 'monthly', days } = req.body;
    if (!user_id) return res.status(400).json({ success: false, message: 'user_id required' });

    const planConfig = PLANS[plan] || PLANS.monthly;
    const grantDays  = parseInt(days) || planConfig.days;

    await _activateSubscription(user_id, plan, {
      amount:   planConfig.amount,
      currency: 'USD',
      days:     grantDays,
    });

    return res.json({ success: true, message: `VIP granted for ${grantDays} days.` });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// ── Internal: activate subscription + elevate user role
async function _activateSubscription(userId, plan, opts = {}) {
  const planConfig = PLANS[plan] || PLANS.monthly;
  const days       = opts.days || planConfig.days;
  const now        = new Date();
  const expiresAt  = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  // Expire any existing active subs for this user
  await db.query(
    `UPDATE subscriptions SET status='expired', updated_at=NOW()
     WHERE user_id=? AND status IN ('active','trialing')`,
    [userId]
  );

  await db.query(
    `INSERT INTO subscriptions
       (user_id, stripe_subscription_id, paystack_reference, plan, amount, currency, status, starts_at, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      userId,
      opts.stripe_subscription_id || null,
      opts.paystack_reference      || null,
      plan,
      opts.amount   || planConfig.amount,
      opts.currency || 'USD',
      'active',
      now,
      expiresAt,
    ]
  );

  await db.query(`UPDATE users SET role='vip', updated_at=NOW() WHERE id=?`, [userId]);
}

// ── Stripe webhook handler (raw body)
async function stripeWebhook(req, res) {
  if (!stripe) return res.status(200).send('OK');

  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (e) {
    console.error('[STRIPE WEBHOOK] Signature error:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session  = event.data.object;
        const userId   = parseInt(session.metadata?.user_id);
        const plan     = session.metadata?.plan;
        const stripeSub = session.subscription;
        if (userId && plan) {
          await _activateSubscription(userId, plan, { stripe_subscription_id: stripeSub });
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const sub     = await stripe.subscriptions.retrieve(invoice.subscription);
        const userId  = parseInt(sub.metadata?.user_id);
        const plan    = sub.metadata?.plan;
        if (userId && plan) {
          await _activateSubscription(userId, plan, { stripe_subscription_id: sub.id });
        }
        break;
      }

      case 'customer.subscription.deleted':
      case 'invoice.payment_failed': {
        const obj    = event.data.object;
        const subId  = obj.subscription || obj.id;
        const [rows] = await db.query(
          `SELECT user_id FROM subscriptions WHERE stripe_subscription_id=? LIMIT 1`,
          [subId]
        );
        if (rows.length) {
          await db.query(
            `UPDATE subscriptions SET status='expired', updated_at=NOW() WHERE stripe_subscription_id=?`,
            [subId]
          );
          await db.query(`UPDATE users SET role='user', updated_at=NOW() WHERE id=?`, [rows[0].user_id]);
        }
        break;
      }
    }
  } catch (e) {
    console.error('[STRIPE WEBHOOK] Handler error:', e.message);
  }

  return res.status(200).json({ received: true });
}

// ── Paystack webhook handler
async function paystackWebhook(req, res) {
  try {
    const paystackKey = process.env.PAYSTACK_SECRET_KEY;
    const hash = require('crypto')
      .createHmac('sha512', paystackKey)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(401).send('Invalid signature');
    }

    const event = req.body;
    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      const parts     = reference.split('-');
      const userId    = parseInt(parts[1]);
      const plan      = parts[2];
      if (userId && PLANS[plan]) {
        await _activateSubscription(userId, plan, {
          paystack_reference: reference,
          amount:   PLANS[plan].amount,
          currency: 'NGN',
        });
      }
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('[PAYSTACK WEBHOOK] Error:', e.message);
    return res.status(500).send('Error');
  }
}

// ── GET /api/subscriptions/bank-details  (public — no auth needed)
async function getBankDetails(req, res) {
  const details = {
    bank_name:      process.env.MANUAL_BANK_NAME       || 'Moniepoint Microfinance Bank',
    account_name:   process.env.MANUAL_ACCOUNT_NAME    || 'Anthony Ikpe',
    account_number: process.env.MANUAL_ACCOUNT_NUMBER  || '9077025895',
    sort_code:      process.env.MANUAL_SORT_CODE        || '',
    amounts: {
      monthly:   { ngn: 8000,  label: 'Monthly VIP' },
      quarterly: { ngn: 20800, label: 'Quarterly VIP' },
      annual:    { ngn: 64000, label: 'Annual VIP' },
    },
  };
  return res.json({ success: true, data: details });
}

// ── POST /api/subscriptions/manual/submit
async function manualSubmit(req, res) {
  try {
    const { plan, imageData } = req.body;

    if (!PLANS[plan]) {
      return res.status(400).json({ success: false, message: 'Invalid plan.' });
    }
    if (!imageData || typeof imageData !== 'string') {
      return res.status(400).json({ success: false, message: 'Payment proof image is required.' });
    }

    // Parse and validate data URL
    const match = imageData.match(/^data:([\w+/-]+);base64,(.+)$/s);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Invalid image format. Upload a JPEG or PNG screenshot.' });
    }
    const [, mime, b64] = match;
    if (!ALLOWED_MIME.has(mime)) {
      return res.status(400).json({ success: false, message: 'Only JPEG, PNG, WebP, or GIF images are accepted.' });
    }

    const buffer = Buffer.from(b64, 'base64');
    if (buffer.length > MAX_BYTES) {
      return res.status(400).json({ success: false, message: 'Image must be under 5 MB.' });
    }

    // Write file to disk safely (UUID filename — no user input in path)
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const ext      = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1].replace(/\+.+/, '');
    const filename = `${randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);

    // Check for duplicate pending submission from same user
    const [existing] = await db.query(
      `SELECT id FROM payment_submissions WHERE user_id = ? AND status = 'pending' LIMIT 1`,
      [req.user.id]
    );
    if (existing.length) {
      fs.unlinkSync(path.join(UPLOADS_DIR, filename)); // clean up the file we just saved
      return res.status(409).json({
        success: false,
        message: 'You already have a pending payment submission. Please wait for admin review.',
      });
    }

    const ngnAmounts = { monthly: 8000, quarterly: 20800, annual: 64000 };

    await db.query(
      `INSERT INTO payment_submissions (user_id, plan, amount_ngn, image_path, image_mime)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, plan, ngnAmounts[plan], filename, mime]
    );

    // Email admin
    const adminEmail  = process.env.ADMIN_EMAIL || 'rootedpredict@gmail.com';
    const siteUrl     = process.env.SITE_URL    || 'https://www.rootedpredict.com';
    const planLabels  = { monthly: 'Monthly (8,000)', quarterly: 'Quarterly (20,800)', annual: 'Annual (64,000)' };
    await sendMail({
      to:      adminEmail,
      subject: `New VIP Payment Awaiting Approval — ${req.user.name || req.user.email}`,
      html: `
        <h2 style="font-family:sans-serif;">New Payment Submission</h2>
        <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;">
          <tr><td style="padding:6px 12px 6px 0;color:#666;">User</td><td style="padding:6px 0;font-weight:600;">${req.user.name || ''} (${req.user.email})</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#666;">Plan</td><td style="padding:6px 0;font-weight:600;">&#8358;${planLabels[plan]}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#666;">Submitted</td><td style="padding:6px 0;">${new Date().toUTCString()}</td></tr>
        </table>
        <p style="font-family:sans-serif;margin-top:20px;">
          <a href="${siteUrl}/admin/payments.html" style="background:#e94560;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:600;font-family:sans-serif;">
            Review in Admin Dashboard
          </a>
        </p>
        <p style="font-family:sans-serif;font-size:12px;color:#999;margin-top:24px;">Only superadmins can approve VIP access.</p>
      `,
    });

    return res.json({
      success: true,
      message: 'Submitted! Your payment is under review. This may take up to 24 hours.',
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// ── GET /api/admin/payment-submissions  (superadmin)
async function adminListSubmissions(req, res) {
  try {
    const status = req.query.status || 'pending';
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = 20;
    const offset = (page - 1) * limit;

    const [rows] = await db.query(
      `SELECT ps.id, ps.plan, ps.amount_ngn, ps.status, ps.notes,
              ps.submitted_at, ps.reviewed_at,
              u.name AS user_name, u.email AS user_email, u.id AS user_id
       FROM payment_submissions ps
       JOIN users u ON u.id = ps.user_id
       WHERE ps.status = ?
       ORDER BY ps.submitted_at DESC
       LIMIT ? OFFSET ?`,
      [status, limit, offset]
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM payment_submissions WHERE status = ?`, [status]
    );
    return res.json({ success: true, data: rows, total, page, limit });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// ── GET /api/admin/payment-submissions/:id/image  (superadmin)
async function adminViewImage(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT image_path, image_mime FROM payment_submissions WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Submission not found.' });

    const { image_path, image_mime } = rows[0];
    const filePath = path.join(UPLOADS_DIR, image_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Image file not found on server.' });
    }
    res.setHeader('Content-Type', image_mime);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(filePath);
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// ── POST /api/admin/payment-submissions/:id/approve  (superadmin)
async function adminApproveSubmission(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT ps.*, u.email AS user_email, u.name AS user_name
       FROM payment_submissions ps JOIN users u ON u.id = ps.user_id
       WHERE ps.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Submission not found.' });
    const sub = rows[0];
    if (sub.status !== 'pending') {
      return res.status(409).json({ success: false, message: `Submission is already ${sub.status}.` });
    }

    await _activateSubscription(sub.user_id, sub.plan, {
      amount:   sub.amount_ngn,
      currency: 'NGN',
    });

    await db.query(
      `UPDATE payment_submissions SET status='approved', reviewed_at=NOW(), reviewed_by=?, notes=?
       WHERE id=?`,
      [req.user.id, req.body.notes || null, sub.id]
    );

    // Email the user
    const siteUrl = process.env.SITE_URL || 'https://www.rootedpredict.com';
    const planLabels = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual' };
    await sendMail({
      to:      sub.user_email,
      subject: 'Your VIP Access Has Been Approved — Rooted Predictions',
      html: `
        <h2 style="font-family:sans-serif;color:#22c55e;">Welcome to VIP!</h2>
        <p style="font-family:sans-serif;font-size:15px;">Hi ${sub.user_name || 'there'},</p>
        <p style="font-family:sans-serif;font-size:15px;">Your ${planLabels[sub.plan]} VIP payment has been verified and your account is now active.</p>
        <p style="font-family:sans-serif;margin-top:20px;">
          <a href="${siteUrl}/dashboard.html" style="background:#e94560;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:600;font-family:sans-serif;">
            Go to My Dashboard
          </a>
        </p>
        <p style="font-family:sans-serif;font-size:12px;color:#999;margin-top:24px;">Questions? Email rootedpredict@gmail.com</p>
      `,
    });

    return res.json({ success: true, message: 'VIP activated and user notified.' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// ── POST /api/admin/payment-submissions/:id/reject  (superadmin)
async function adminRejectSubmission(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT ps.*, u.email AS user_email, u.name AS user_name
       FROM payment_submissions ps JOIN users u ON u.id = ps.user_id
       WHERE ps.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Submission not found.' });
    const sub = rows[0];
    if (sub.status !== 'pending') {
      return res.status(409).json({ success: false, message: `Submission is already ${sub.status}.` });
    }

    const notes = req.body.notes || '';
    await db.query(
      `UPDATE payment_submissions SET status='rejected', reviewed_at=NOW(), reviewed_by=?, notes=?
       WHERE id=?`,
      [req.user.id, notes, sub.id]
    );

    await sendMail({
      to:      sub.user_email,
      subject: 'Payment Verification Update — Rooted Predictions',
      html: `
        <h2 style="font-family:sans-serif;">Payment Verification Update</h2>
        <p style="font-family:sans-serif;font-size:15px;">Hi ${sub.user_name || 'there'},</p>
        <p style="font-family:sans-serif;font-size:15px;">Unfortunately we were unable to verify your payment proof.
          ${notes ? `<br><br><strong>Reason:</strong> ${notes}` : ''}</p>
        <p style="font-family:sans-serif;font-size:15px;">Please contact us at
          <a href="mailto:rootedpredict@gmail.com">rootedpredict@gmail.com</a>
          or resubmit with a clearer screenshot of your bank transfer receipt.</p>
      `,
    });

    return res.json({ success: true, message: 'Submission rejected and user notified.' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

module.exports = {
  getStatus, stripeCreateCheckout, paystackInitialize, paystackVerify,
  cancelSubscription, adminGrantVip, stripeWebhook, paystackWebhook,
  getBankDetails, manualSubmit,
  adminListSubmissions, adminViewImage, adminApproveSubmission, adminRejectSubmission,
};
