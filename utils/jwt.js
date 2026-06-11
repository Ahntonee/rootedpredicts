// utils/jwt.js
// Rooted Predictions — JWT token generation and verification
// Tokens are stored in httpOnly cookies for XSS protection

'use strict';

const jwt = require('jsonwebtoken');

const SECRET      = process.env.JWT_SECRET;
const EXPIRES_IN  = process.env.JWT_EXPIRES_IN || '7d';
const COOKIE_NAME = 'rp_token';

if (!SECRET) {
  console.error('[JWT] FATAL: JWT_SECRET is not set in environment variables.');
  process.exit(1);
}

/**
 * Generate a signed JWT for a user
 * @param {Object} payload - Data to embed (id, role, email)
 * @returns {string} Signed JWT string
 */
function generateToken(payload, rememberMe = false) {
  const expiresIn = rememberMe ? '30d' : EXPIRES_IN;
  return jwt.sign(payload, SECRET, { expiresIn });
}

/**
 * Verify and decode a JWT
 * @param {string} token - JWT string
 * @returns {Object|null} Decoded payload or null if invalid
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Set JWT as httpOnly cookie on the response
 * httpOnly = not accessible via JS (XSS protection)
 * secure = HTTPS only in production
 * sameSite = CSRF protection
 */
function setTokenCookie(res, token, rememberMe = false) {
  const isProduction = process.env.NODE_ENV === 'production';
  const maxAge = rememberMe
    ? 30 * 24 * 60 * 60 * 1000  // 30 days
    :  7 * 24 * 60 * 60 * 1000; // 7 days

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure:   isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge,
    path:     '/',
  });
}

/**
 * Clear the auth cookie (used on logout)
 */
function clearTokenCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/**
 * Extract token from either cookie or Authorization header
 * Supports both cookie-based (frontend) and header-based (API clients)
 */
function extractToken(req) {
  // 1. Try httpOnly cookie first (browser-based sessions)
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }

  // 2. Fallback: Authorization: Bearer <token> header (API access)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return null;
}

module.exports = {
  generateToken,
  verifyToken,
  setTokenCookie,
  clearTokenCookie,
  extractToken,
  COOKIE_NAME,
};
