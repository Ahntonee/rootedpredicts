// middleware/auth.js
// Rooted Predictions — Authentication and role-based access control middleware
// Applied to protected API routes throughout the application

'use strict';

const db                = require('../config/db');
const { verifyToken, extractToken } = require('../utils/jwt');
const { errorResponse } = require('../utils/helpers');

/**
 * authenticate
 * Verifies the JWT and attaches the full user object to req.user.
 * Any route requiring a logged-in user must use this middleware.
 */
async function authenticate(req, res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      return errorResponse(res, 'Authentication required. Please log in.', 401);
    }

    const decoded = verifyToken(token);

    if (!decoded) {
      return errorResponse(res, 'Invalid or expired session. Please log in again.', 401);
    }

    // Fetch fresh user from DB — catches banned/deleted accounts mid-session
    const [rows] = await db.query(
      'SELECT id, name, email, role, country, timezone, telegram_invited, is_banned FROM users WHERE id = ?',
      [decoded.id]
    );

    if (!rows.length) {
      return errorResponse(res, 'User account not found.', 401);
    }

    const user = rows[0];

    if (user.is_banned) {
      return errorResponse(res, 'Your account has been suspended. Contact support.', 403);
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('[AUTH] Middleware error:', error.message);
    return errorResponse(res, 'Authentication error.', 500);
  }
}

/**
 * optionalAuth
 * Attaches user to req.user if a valid token exists, but does not block
 * unauthenticated requests. Used on public pages that serve different
 * content to logged-in vs guest users.
 */
async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = verifyToken(token);

    if (!decoded) {
      req.user = null;
      return next();
    }

    const [rows] = await db.query(
      'SELECT id, name, email, role, country, timezone, telegram_invited, is_banned FROM users WHERE id = ?',
      [decoded.id]
    );

    req.user = rows.length && !rows[0].is_banned ? rows[0] : null;
    next();
  } catch {
    req.user = null;
    next();
  }
}

/**
 * requireRole
 * Role hierarchy: guest < user < vip < admin
 * Usage: router.get('/vip-tips', authenticate, requireRole('vip'), handler)
 *
 * @param {...string} roles - One or more roles that are permitted
 */
function requireRole(...roles) {
  const ROLE_LEVELS = { guest: 0, user: 1, vip: 2, admin: 3 };

  return (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, 'Authentication required.', 401);
    }

    const userLevel = ROLE_LEVELS[req.user.role] ?? 0;
    const permitted = roles.some(role => {
      // Admin always passes all role checks
      if (req.user.role === 'admin') return true;
      return userLevel >= (ROLE_LEVELS[role] ?? 0);
    });

    if (!permitted) {
      if (req.user.role === 'user' && roles.includes('vip')) {
        return errorResponse(
          res,
          'VIP subscription required. Upgrade at rootedpredict.com/pricing',
          403
        );
      }
      return errorResponse(res, 'You do not have permission to access this resource.', 403);
    }

    next();
  };
}

/**
 * requireAdmin — shorthand middleware for admin-only routes
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return errorResponse(res, 'Authentication required.', 401);
  }
  if (req.user.role !== 'admin') {
    return errorResponse(res, 'Admin access required.', 403);
  }
  next();
}

/**
 * requireVip — shorthand middleware for VIP-only routes
 */
function requireVip(req, res, next) {
  if (!req.user) {
    return errorResponse(res, 'Authentication required.', 401);
  }
  if (req.user.role !== 'vip' && req.user.role !== 'admin') {
    return errorResponse(
      res,
      'VIP subscription required. Upgrade at rootedpredict.com/pricing',
      403
    );
  }
  next();
}

module.exports = {
  authenticate,
  optionalAuth,
  requireRole,
  requireAdmin,
  requireVip,
};
