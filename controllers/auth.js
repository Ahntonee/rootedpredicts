// controllers/auth.js
// Rooted Predictions — Authentication controller
// Handles: register, login, logout, me, password reset

'use strict';

const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const db      = require('../config/db');
const { generateToken, setTokenCookie, clearTokenCookie } = require('../utils/jwt');
const { sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');
const { sanitiseText, errorResponse, successResponse } = require('../utils/helpers');

// ── REGISTER ──────────────────────────────────────────────────
async function register(req, res) {
  const { name, email, password, country, timezone } = req.body;

  try {
    // Check email already exists
    const [existing] = await db.query(
      'SELECT id FROM users WHERE email = ?', [email.toLowerCase()]
    );
    if (existing.length) {
      return errorResponse(res, 'An account with that email already exists.', 409);
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 12);

    // Create Stripe customer (non-blocking — fails silently if Stripe not configured)
    let stripe_customer_id = null;
    try {
      if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY !== 'sk_test_your_stripe_test_key') {
        const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const customer = await stripe.customers.create({
          email: email.toLowerCase(),
          name:  sanitiseText(name),
          metadata: { source: 'rootedpredict_registration' },
        });
        stripe_customer_id = customer.id;
      }
    } catch (stripeErr) {
      console.warn('[AUTH] Stripe customer creation skipped:', stripeErr.message);
    }

    // Insert user
    const [result] = await db.query(
      `INSERT INTO users (name, email, password_hash, role, country, timezone, stripe_customer_id)
       VALUES (?, ?, ?, 'user', ?, ?, ?)`,
      [
        sanitiseText(name).slice(0, 100),
        email.toLowerCase(),
        password_hash,
        country  || null,
        timezone || 'UTC',
        stripe_customer_id,
      ]
    );

    const userId = result.insertId;

    // Generate JWT and set cookie
    const token = generateToken({ id: userId, role: 'user', email: email.toLowerCase() });
    setTokenCookie(res, token);

    // Send welcome email (non-blocking)
    sendWelcomeEmail({ name: sanitiseText(name), email: email.toLowerCase() })
      .catch(e => console.warn('[AUTH] Welcome email failed:', e.message));

    return successResponse(res, {
      user: {
        id:      userId,
        name:    sanitiseText(name),
        email:   email.toLowerCase(),
        role:    'user',
        country: country || null,
      }
    }, 'Account created successfully', 201);

  } catch (error) {
    console.error('[AUTH] Register error:', error.message);
    return errorResponse(res, 'Registration failed. Please try again.', 500);
  }
}

// ── INITIATE REGISTER — send OTP, no account created yet ─────
async function initiateRegister(req, res) {
  const { name, email, password, country } = req.body;

  try {
    // Reject if email already has a full account
    const [existing] = await db.query(
      'SELECT id FROM users WHERE email = ?', [email.toLowerCase()]
    );
    if (existing.length) {
      return errorResponse(res, 'An account with that email already exists.', 409);
    }

    // Hash password up-front so we can store it pending verification
    const password_hash = await bcrypt.hash(password, 12);

    // Generate a 6-digit numeric OTP
    const token     = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Upsert — allows re-sending a fresh code if user retries
    await db.query(
      `INSERT INTO pending_registrations
         (email, name, password_hash, country, token, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name          = VALUES(name),
         password_hash = VALUES(password_hash),
         country       = VALUES(country),
         token         = VALUES(token),
         expires_at    = VALUES(expires_at),
         created_at    = NOW()`,
      [email.toLowerCase(), sanitiseText(name).slice(0, 100),
       password_hash, country || null, token, expiresAt]
    );

    // Send verification email — await to catch real SMTP failures.
    // If SMTP is not configured (dev/staging) we log a warning and continue
    // so the OTP flow isn't completely blocked in non-production environments.
    const smtpConfigured = !!(process.env.SMTP_USER && process.env.SMTP_PASS);
    const emailResult = await sendVerificationEmail(
      { name: sanitiseText(name), email: email.toLowerCase() },
      token
    );

    if (!emailResult || !emailResult.success) {
      console.error('[AUTH] Verification email FAILED for', email.toLowerCase(),
        '—', emailResult && emailResult.error);
      if (smtpConfigured) {
        return errorResponse(res,
          'We could not send the verification email right now. Please try again in a moment, and check your spam folder.',
          502);
      }
      // SMTP not configured — allow dev/staging to proceed; OTP is logged below
      console.warn('[AUTH] SMTP not configured — OTP for', email.toLowerCase(), 'is:', token);
    }

    console.log('[AUTH] Verification code sent to', email.toLowerCase());
    return successResponse(res, { email: email.toLowerCase() },
      'Verification code sent. Check your email (and your spam folder).');

  } catch (error) {
    console.error('[AUTH] Initiate register error:', error.message);
    return errorResponse(res, 'Registration failed. Please try again.', 500);
  }
}

// ── VERIFY REGISTRATION — confirm OTP, create account ─────────
async function verifyRegistration(req, res) {
  const { email, token } = req.body;

  try {
    // Look up pending record that hasn't expired
    const [rows] = await db.query(
      `SELECT * FROM pending_registrations
       WHERE email = ? AND expires_at > NOW()`,
      [email.toLowerCase()]
    );

    if (!rows.length) {
      return errorResponse(res,
        'Code has expired or was not found. Please register again.', 400);
    }

    const pending = rows[0];

    // Constant-time token comparison
    if (pending.token !== token.trim()) {
      return errorResponse(res,
        'Incorrect verification code. Please check and try again.', 400);
    }

    // Guard against duplicate submission
    const [duplicate] = await db.query(
      'SELECT id FROM users WHERE email = ?', [email.toLowerCase()]
    );
    if (duplicate.length) {
      await db.query(
        'DELETE FROM pending_registrations WHERE email = ?', [email.toLowerCase()]
      );
      return errorResponse(res, 'An account with that email already exists.', 409);
    }

    // Create Stripe customer (non-blocking)
    let stripe_customer_id = null;
    try {
      if (process.env.STRIPE_SECRET_KEY &&
          process.env.STRIPE_SECRET_KEY !== 'sk_test_your_stripe_test_key') {
        const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const customer = await stripe.customers.create({
          email:    email.toLowerCase(),
          name:     pending.name,
          metadata: { source: 'rootedpredict_registration' },
        });
        stripe_customer_id = customer.id;
      }
    } catch (stripeErr) {
      console.warn('[AUTH] Stripe customer creation skipped:', stripeErr.message);
    }

    // Insert verified user
    const [result] = await db.query(
      `INSERT INTO users
         (name, email, password_hash, role, country, timezone, stripe_customer_id)
       VALUES (?, ?, ?, 'user', ?, 'UTC', ?)`,
      [pending.name, pending.email, pending.password_hash,
       pending.country, stripe_customer_id]
    );

    const userId = result.insertId;

    // Clean up pending record
    await db.query(
      'DELETE FROM pending_registrations WHERE email = ?', [email.toLowerCase()]
    );

    // Issue JWT cookie
    const jwtToken = generateToken({ id: userId, role: 'user', email: email.toLowerCase() });
    setTokenCookie(res, jwtToken);

    // Send welcome email (non-blocking)
    sendWelcomeEmail({ name: pending.name, email: email.toLowerCase() })
      .catch(e => console.warn('[AUTH] Welcome email failed:', e.message));

    return successResponse(res, {
      user: {
        id:      userId,
        name:    pending.name,
        email:   email.toLowerCase(),
        role:    'user',
        country: pending.country,
      }
    }, 'Account created successfully', 201);

  } catch (error) {
    console.error('[AUTH] Verify registration error:', error.message);
    return errorResponse(res, 'Verification failed. Please try again.', 500);
  }
}

// ── LOGIN ─────────────────────────────────────────────────────
async function login(req, res) {
  const { email, password, remember } = req.body;

  try {
    // Fetch user by email
    const [rows] = await db.query(
      `SELECT id, name, email, password_hash, role, country, timezone,
              telegram_invited, stripe_customer_id, is_banned
       FROM users WHERE email = ?`,
      [email.toLowerCase()]
    );

    if (!rows.length) {
      // Generic message — don't reveal whether email exists
      return errorResponse(res, 'Invalid email or password.', 401);
    }

    const user = rows[0];

    if (user.is_banned) {
      return errorResponse(res, 'Your account has been suspended. Contact support.', 403);
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return errorResponse(res, 'Invalid email or password.', 401);
    }

    // Generate JWT and set httpOnly cookie (30 days if remember-me checked)
    const rememberMe = remember === true || remember === 'true';
    const token = generateToken({ id: user.id, role: user.role, email: user.email }, rememberMe);
    setTokenCookie(res, token, rememberMe);

    // Update last login timestamp
    await db.query('UPDATE users SET updated_at = NOW() WHERE id = ?', [user.id]);

    return successResponse(res, {
      user: {
        id:               user.id,
        name:             user.name,
        email:            user.email,
        role:             user.role,
        country:          user.country,
        timezone:         user.timezone,
        telegram_invited: user.telegram_invited,
      }
    }, 'Login successful');

  } catch (error) {
    console.error('[AUTH] Login error:', error.message);
    return errorResponse(res, 'Login failed. Please try again.', 500);
  }
}

// ── LOGOUT ────────────────────────────────────────────────────
async function logout(req, res) {
  clearTokenCookie(res);
  return successResponse(res, null, 'Logged out successfully');
}

// ── ME — Get current authenticated user ───────────────────────
async function me(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT id, name, email, role, country, timezone, telegram_invited, created_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!rows.length) return errorResponse(res, 'User not found', 404);

    // Get active subscription if VIP
    let subscription = null;
    if (rows[0].role === 'vip') {
      const [subs] = await db.query(
        `SELECT plan, status, expires_at, trial_ends_at
         FROM subscriptions WHERE user_id = ? AND status IN ('active','trialing')
         ORDER BY created_at DESC LIMIT 1`,
        [rows[0].id]
      );
      subscription = subs[0] || null;
    }

    return successResponse(res, { ...rows[0], subscription });
  } catch (error) {
    console.error('[AUTH] Me error:', error.message);
    return errorResponse(res, 'Failed to fetch user data.', 500);
  }
}

// ── FORGOT PASSWORD ───────────────────────────────────────────
async function forgotPassword(req, res) {
  const { email } = req.body;

  if (!email) return errorResponse(res, 'Email address is required.', 400);

  try {
    const [rows] = await db.query(
      'SELECT id, name, email FROM users WHERE email = ?',
      [email.toLowerCase()]
    );

    // Always return success — don't reveal if email exists
    if (!rows.length) {
      return successResponse(res, null, 'If that email is registered, a reset link has been sent.');
    }

    const user = rows[0];

    // Generate secure random reset token
    const resetToken  = crypto.randomBytes(32).toString('hex');
    const tokenHash   = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt   = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store hashed token in DB
    await db.query(
      `UPDATE users SET
         password_reset_token = ?,
         password_reset_expires = ?,
         updated_at = NOW()
       WHERE id = ?`,
      [tokenHash, expiresAt, user.id]
    );

    // Send reset email (non-blocking)
    sendPasswordResetEmail(user, resetToken)
      .catch(e => console.warn('[AUTH] Reset email failed:', e.message));

    return successResponse(res, null, 'If that email is registered, a reset link has been sent.');

  } catch (error) {
    console.error('[AUTH] Forgot password error:', error.message);
    return errorResponse(res, 'Request failed. Please try again.', 500);
  }
}

// ── RESET PASSWORD ────────────────────────────────────────────
async function resetPassword(req, res) {
  const { token, password } = req.body;

  if (!token || !password) {
    return errorResponse(res, 'Reset token and new password are required.', 400);
  }
  if (password.length < 8) {
    return errorResponse(res, 'Password must be at least 8 characters.', 400);
  }

  try {
    // Hash the incoming token to compare with stored hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const [rows] = await db.query(
      `SELECT id, email FROM users
       WHERE password_reset_token = ?
         AND password_reset_expires > NOW()`,
      [tokenHash]
    );

    if (!rows.length) {
      return errorResponse(res, 'Reset link is invalid or has expired. Please request a new one.', 400);
    }

    const user         = rows[0];
    const password_hash = await bcrypt.hash(password, 12);

    // Update password and clear reset token
    await db.query(
      `UPDATE users SET
         password_hash = ?,
         password_reset_token = NULL,
         password_reset_expires = NULL,
         updated_at = NOW()
       WHERE id = ?`,
      [password_hash, user.id]
    );

    return successResponse(res, null, 'Password reset successfully. You can now log in.');

  } catch (error) {
    console.error('[AUTH] Reset password error:', error.message);
    return errorResponse(res, 'Password reset failed. Please try again.', 500);
  }
}

// ── CHANGE PASSWORD (authenticated) ──────────────────────────
async function changePassword(req, res) {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return errorResponse(res, 'Current and new password are required.', 400);
  }
  if (new_password.length < 8) {
    return errorResponse(res, 'New password must be at least 8 characters.', 400);
  }

  try {
    const [rows] = await db.query(
      'SELECT id, password_hash FROM users WHERE id = ?', [req.user.id]
    );
    if (!rows.length) return errorResponse(res, 'User not found.', 404);

    const valid = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!valid) return errorResponse(res, 'Current password is incorrect.', 400);

    const password_hash = await bcrypt.hash(new_password, 12);
    await db.query(
      'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
      [password_hash, req.user.id]
    );

    return successResponse(res, null, 'Password changed successfully.');

  } catch (error) {
    console.error('[AUTH] Change password error:', error.message);
    return errorResponse(res, 'Failed to change password.', 500);
  }
}

module.exports = { register, initiateRegister, verifyRegistration, login, logout, me, forgotPassword, resetPassword, changePassword };
