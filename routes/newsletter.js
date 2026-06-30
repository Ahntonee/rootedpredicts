'use strict';

const express = require('express');
const router  = express.Router();
const nl      = require('../controllers/newsletter');
const { asyncHandler } = require('../utils/helpers');

router.post('/subscribe',   asyncHandler(nl.subscribe));
router.get ('/unsubscribe', asyncHandler(nl.unsubscribe));
router.post('/unsubscribe', asyncHandler(nl.unsubscribe));

module.exports = router;
