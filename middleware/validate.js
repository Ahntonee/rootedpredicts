// middleware/validate.js
// Rooted Predictions — Input validation middleware
// Applied to POST/PUT routes to sanitise and validate request bodies

'use strict';

const { errorResponse, sanitiseText } = require('../utils/helpers');

/**
 * Validate user registration body
 */
function validateRegister(req, res, next) {
  const { name, email, password, country } = req.body;
  const errors = [];

  if (!name || sanitiseText(name).length < 2) {
    errors.push('Name must be at least 2 characters.');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('A valid email address is required.');
  }
  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters.');
  }
  if (password && !/(?=.*[A-Z])(?=.*[0-9])/.test(password)) {
    errors.push('Password must contain at least one uppercase letter and one number.');
  }

  if (errors.length) {
    return errorResponse(res, 'Validation failed', 400, errors);
  }

  // Sanitise inputs before they reach controllers
  req.body.name    = sanitiseText(name).slice(0, 100);
  req.body.email   = email.toLowerCase().trim();
  req.body.country = country ? sanitiseText(country).slice(0, 100) : null;

  next();
}

/**
 * Validate email verification body (step 2 of registration)
 */
function validateVerification(req, res, next) {
  const { email, token } = req.body;
  const errors = [];

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('A valid email address is required.');
  }
  if (!token || !/^\d{6}$/.test(token.trim())) {
    errors.push('Please enter the 6-digit code sent to your email.');
  }

  if (errors.length) {
    return errorResponse(res, 'Validation failed', 400, errors);
  }

  req.body.email = email.toLowerCase().trim();
  req.body.token = token.trim();
  next();
}

/**
 * Validate login body
 */
function validateLogin(req, res, next) {
  const { email, password } = req.body;
  const errors = [];

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('A valid email address is required.');
  }
  if (!password || password.length < 1) {
    errors.push('Password is required.');
  }

  if (errors.length) {
    return errorResponse(res, 'Validation failed', 400, errors);
  }

  req.body.email = email.toLowerCase().trim();
  next();
}

/**
 * Validate prediction creation/update body
 */
function validatePrediction(req, res, next) {
  const { league_id, home_team, away_team, match_date, tip, market, visibility } = req.body;
  const errors = [];

  if (!league_id || isNaN(parseInt(league_id))) {
    errors.push('A valid league ID is required.');
  }
  if (!home_team || sanitiseText(home_team).length < 2) {
    errors.push('Home team name is required.');
  }
  if (!away_team || sanitiseText(away_team).length < 2) {
    errors.push('Away team name is required.');
  }
  if (!match_date || isNaN(Date.parse(match_date))) {
    errors.push('A valid match date is required.');
  }
  if (!tip || sanitiseText(tip).length < 2) {
    errors.push('Tip is required (e.g. Home Win, Over 2.5, BTTS).');
  }
  if (!market || sanitiseText(market).length < 2) {
    errors.push('Market is required (e.g. 1X2, Over/Under, BTTS).');
  }
  if (visibility && !['free', 'vip'].includes(visibility)) {
    errors.push('Visibility must be free or vip.');
  }

  if (errors.length) {
    return errorResponse(res, 'Validation failed', 400, errors);
  }

  // Sanitise
  req.body.home_team = sanitiseText(home_team).slice(0, 150);
  req.body.away_team = sanitiseText(away_team).slice(0, 150);
  req.body.tip       = sanitiseText(tip).slice(0, 50);
  req.body.market    = sanitiseText(market).slice(0, 50);

  next();
}

/**
 * Validate blog post body
 */
function validateBlogPost(req, res, next) {
  const { title, content } = req.body;
  const errors = [];

  if (!title || sanitiseText(title).length < 5) {
    errors.push('Blog post title must be at least 5 characters.');
  }
  if (!content || content.length < 100) {
    errors.push('Blog post content must be at least 100 characters.');
  }

  if (errors.length) {
    return errorResponse(res, 'Validation failed', 400, errors);
  }

  req.body.title = sanitiseText(title).slice(0, 300);
  next();
}

/**
 * Validate bet history entry
 */
function validateBetHistory(req, res, next) {
  const { stake, odds, result } = req.body;
  const errors = [];

  if (!stake || isNaN(parseFloat(stake)) || parseFloat(stake) <= 0) {
    errors.push('Stake must be a positive number.');
  }
  if (!odds || isNaN(parseFloat(odds)) || parseFloat(odds) < 1) {
    errors.push('Odds must be 1.0 or greater.');
  }
  if (result && !['won', 'lost', 'pending', 'void'].includes(result)) {
    errors.push('Result must be won, lost, pending, or void.');
  }

  if (errors.length) {
    return errorResponse(res, 'Validation failed', 400, errors);
  }

  next();
}

module.exports = {
  validateRegister,
  validateVerification,
  validateLogin,
  validatePrediction,
  validateBlogPost,
  validateBetHistory,
};
