// routes/auth.js
'use strict';

const express    = require('express');
const router     = express.Router();
const rateLimit  = require('express-rate-limit');

const authCtrl = require('../controllers/auth');
const { authenticate } = require('../middleware/auth');
const { validateRegister, validateVerification, validateLogin } = require('../middleware/validate');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { success: false, message: 'Too many attempts. Try again in 15 minutes.' },
});

// Step 1 — validate fields + send OTP (no account created yet)
router.post('/register',        authLimiter, validateRegister,     authCtrl.initiateRegister);
// Step 2 — verify OTP + create account + log in (strict limit: 10/15min)
router.post('/register/verify', authLimiter, validateVerification, authCtrl.verifyRegistration);
router.post('/login',           validateLogin,    authCtrl.login);
router.post('/logout',                            authCtrl.logout);
router.post('/forgot-password',                   authCtrl.forgotPassword);
router.post('/reset-password',                    authCtrl.resetPassword);
router.get ('/me',              authenticate,     authCtrl.me);
router.post('/change-password', authenticate,     authCtrl.changePassword);

module.exports = router;