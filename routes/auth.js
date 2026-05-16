// routes/auth.js
'use strict';

const express  = require('express');
const router   = express.Router();

const authCtrl = require('../controllers/auth');
const { authenticate } = require('../middleware/auth');
const { validateRegister, validateLogin } = require('../middleware/validate');

// Debug — remove after confirming it works
console.log('[AUTH ROUTE] authCtrl:', typeof authCtrl.register);
console.log('[AUTH ROUTE] validateRegister:', typeof validateRegister);

router.post('/register',        validateRegister, authCtrl.register);
router.post('/login',           validateLogin,    authCtrl.login);
router.post('/logout',                            authCtrl.logout);
router.post('/forgot-password',                   authCtrl.forgotPassword);
router.post('/reset-password',                    authCtrl.resetPassword);
router.get ('/me',              authenticate,     authCtrl.me);
router.post('/change-password', authenticate,     authCtrl.changePassword);

module.exports = router;