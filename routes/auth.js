// routes/auth.js
'use strict';

const express  = require('express');
const router   = express.Router();

const authCtrl = require('../controllers/auth');
const { authenticate } = require('../middleware/auth');
const { validateRegister, validateVerification, validateLogin } = require('../middleware/validate');

// Step 1 — validate fields + send OTP (no account created yet)
router.post('/register',        validateRegister,     authCtrl.initiateRegister);
// Step 2 — verify OTP + create account + log in
router.post('/register/verify', validateVerification, authCtrl.verifyRegistration);
router.post('/login',           validateLogin,    authCtrl.login);
router.post('/logout',                            authCtrl.logout);
router.post('/forgot-password',                   authCtrl.forgotPassword);
router.post('/reset-password',                    authCtrl.resetPassword);
router.get ('/me',              authenticate,     authCtrl.me);
router.post('/change-password', authenticate,     authCtrl.changePassword);

module.exports = router;