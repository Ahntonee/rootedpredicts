'use strict';
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { verifyToken, extractToken } = require('../utils/jwt');

const authActions = new Set(['/auth/login', '/auth/register', '/auth/register/verify', '/auth/forgot-password', '/auth/reset-password']);
function identity(req) {
  const token = extractToken(req);
  const session = token && verifyToken(token);
  return session && session.id ? session : null;
}
function makeLimiter(name, options) {
  return rateLimit({
    standardHeaders: true, legacyHeaders: false,
    handler(req, res) {
      const reset = req.rateLimit && req.rateLimit.resetTime;
      const retryAfter = reset ? Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000)) : 60;
      console.warn('[RATE_LIMIT]', name, req.method, req.path, 'client=' + req.ip);
      res.status(429).json({ success: false, code: 'RATE_LIMITED', retry_after: retryAfter,
        message: `Too many ${name} requests. Please try again in ${retryAfter} seconds.` });
    },
    ...options,
  });
}
function createApiLimiter(overrides = {}) {
  const keyGenerator = req => req.rateLimitSession
    ? 'account:' + req.rateLimitSession.id : 'ip:' + ipKeyGenerator(req.ip);
  const publicLimiter = makeLimiter('browsing', {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    limit: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 300,
    keyGenerator, ...overrides.public,
  });
  const adminLimiter = makeLimiter('admin', {
    windowMs: 60000, limit: 300, keyGenerator, ...overrides.admin,
  });
  return (req, res, next) => {
    // Auth actions have their own limiter after body parsing, in routes/auth.js.
    const route = req.path.replace(/\/$/, '').toLowerCase();
    if (req.method === 'POST' && authActions.has(route)) return next();
    req.rateLimitSession = identity(req);
    const adminRoute = /^\/(admin|sync)(\/|$)/.test(route);
    // A signed claim selects only a quota; route middleware still checks current DB permissions.
    return (adminRoute || req.rateLimitSession?.role === 'admin' ? adminLimiter : publicLimiter)(req, res, next);
  };
}
function createAuthLimiter(options = {}) {
  const requestWasSuccessful = (req, res) => req.path.toLowerCase() === '/login' && res.statusCode < 400;
  const attemptsByIp = makeLimiter('authentication', {
    windowMs: 15 * 60000, limit: 100, skipSuccessfulRequests: true, requestWasSuccessful,
  });
  const attemptsByAccount = makeLimiter('authentication', {
    windowMs: 15 * 60000, limit: 10, skipSuccessfulRequests: true,
    requestWasSuccessful,
    keyGenerator: req => ipKeyGenerator(req.ip) + ':' + req.path.toLowerCase() + ':' +
      String(req.body?.email || '').trim().toLowerCase().slice(0, 254),
    ...options,
  });
  return (req, res, next) => attemptsByIp(req, res, error => error ? next(error) : attemptsByAccount(req, res, next));
}
module.exports = { createApiLimiter, createAuthLimiter };
