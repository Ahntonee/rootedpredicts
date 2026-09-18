// routes/auth.js
'use strict';

const express    = require('express');
const router     = express.Router();
const { createAuthLimiter } = require('../middleware/rateLimits');

const authCtrl = require('../controllers/auth');
const { authenticate } = require('../middleware/auth');
const { validateRegister, validateVerification, validateLogin } = require('../middleware/validate');

const authLimiter = createAuthLimiter();

// Step 1 — validate fields + send OTP (no account created yet)
router.post('/register',        authLimiter, validateRegister,     authCtrl.initiateRegister);
// Step 2 — verify OTP + create account + log in (strict limit: 10/15min)
router.post('/register/verify', authLimiter, validateVerification, authCtrl.verifyRegistration);
router.post('/login',           authLimiter, validateLogin,    authCtrl.login);
router.post('/logout',                            authCtrl.logout);
router.post('/forgot-password', authLimiter,      authCtrl.forgotPassword);
router.post('/reset-password',  authLimiter,      authCtrl.resetPassword);
router.get ('/me',              authenticate,     authCtrl.me);
router.post('/change-password', authenticate,     authCtrl.changePassword);

module.exports = router;