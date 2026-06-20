// utils/helpers.js
// Rooted Predictions — Shared utility functions used across the application

'use strict';

const slugify = require('slugify');

/**
 * Generate a URL-safe slug from a prediction fixture
 * e.g. "Premier League Arsenal vs Chelsea 2026-05-01"
 * → "premier-league-arsenal-vs-chelsea-2026-05-01"
 */
function generatePredictionSlug(leagueName, homeTeam, awayTeam, matchDate) {
  const dateStr = matchDate
    ? new Date(matchDate).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  const raw = `${leagueName} ${homeTeam} vs ${awayTeam} ${dateStr}`;
  return slugify(raw, { lower: true, strict: true, trim: true });
}

/**
 * Generate a URL-safe slug for blog posts
 */
function generateBlogSlug(title) {
  return slugify(title, { lower: true, strict: true, trim: true });
}

/**
 * Format a decimal odds value to 2 decimal places
 */
function formatOdds(odds) {
  return odds ? parseFloat(odds).toFixed(2) : null;
}

/**
 * Calculate profit/loss for a bet
 * Returns positive number for profit, negative for loss
 */
function calculateProfitLoss(stake, odds, result) {
  if (result === 'won') {
    return parseFloat(((stake * odds) - stake).toFixed(2));
  } else if (result === 'lost') {
    return parseFloat((-stake).toFixed(2));
  }
  return 0;
}

/**
 * Map a country name to its continent
 */
const CONTINENT_MAP = {
  // Europe
  England: 'Europe', Scotland: 'Europe', Wales: 'Europe', 'Northern Ireland': 'Europe',
  Spain: 'Europe', Germany: 'Europe', France: 'Europe', Italy: 'Europe', Portugal: 'Europe',
  Netherlands: 'Europe', Belgium: 'Europe', Turkey: 'Europe', Russia: 'Europe',
  Greece: 'Europe', Switzerland: 'Europe', Austria: 'Europe', Poland: 'Europe',
  Ukraine: 'Europe', Sweden: 'Europe', Norway: 'Europe', Denmark: 'Europe',
  'Czech Republic': 'Europe', Croatia: 'Europe', Serbia: 'Europe', Romania: 'Europe',
  Hungary: 'Europe', Slovakia: 'Europe', Slovenia: 'Europe', Bulgaria: 'Europe',
  Finland: 'Europe', Ireland: 'Europe',
  // Africa
  Nigeria: 'Africa', Ghana: 'Africa', Kenya: 'Africa', 'South Africa': 'Africa',
  Egypt: 'Africa', Morocco: 'Africa', Algeria: 'Africa', Tunisia: 'Africa',
  Senegal: 'Africa', Cameroon: 'Africa', 'Ivory Coast': 'Africa', Ethiopia: 'Africa',
  Tanzania: 'Africa', Uganda: 'Africa', Zimbabwe: 'Africa', Zambia: 'Africa',
  Angola: 'Africa', Mozambique: 'Africa', Sudan: 'Africa',
  // Asia
  India: 'Asia', China: 'Asia', Japan: 'Asia', 'South Korea': 'Asia',
  Indonesia: 'Asia', Philippines: 'Asia', Thailand: 'Asia', Malaysia: 'Asia',
  'Saudi Arabia': 'Asia', UAE: 'Asia', Qatar: 'Asia', Iran: 'Asia',
  Iraq: 'Asia', Israel: 'Asia', Vietnam: 'Asia', Pakistan: 'Asia',
  Bangladesh: 'Asia', Singapore: 'Asia', 'Hong Kong': 'Asia', Jordan: 'Asia', Kuwait: 'Asia',
  // Americas
  USA: 'Americas', Brazil: 'Americas', Mexico: 'Americas', Argentina: 'Americas',
  Colombia: 'Americas', Chile: 'Americas', Peru: 'Americas', Uruguay: 'Americas',
  Venezuela: 'Americas', Ecuador: 'Americas', Bolivia: 'Americas', Paraguay: 'Americas',
  Canada: 'Americas', 'Costa Rica': 'Americas', Honduras: 'Americas', Guatemala: 'Americas',
  Panama: 'Americas', Jamaica: 'Americas',
  // Oceania
  Australia: 'Oceania', 'New Zealand': 'Oceania',
  // World
  World: 'World',
};

function getContinentFromCountry(country) {
  return CONTINENT_MAP[country] || 'World';
}

/**
 * Paginate a MySQL query result set
 * Returns pagination metadata alongside data
 */
function paginate(totalCount, page, limit) {
  const totalPages = Math.ceil(totalCount / limit);
  return {
    total:       totalCount,
    page:        page,
    limit:       limit,
    totalPages:  totalPages,
    hasNext:     page < totalPages,
    hasPrev:     page > 1,
  };
}

/**
 * Parse page and limit from query string with sane defaults
 */
function parsePagination(query) {
  const page  = Math.max(1, parseInt(query.page)  || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * Standard API success response
 */
function successResponse(res, data, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

/**
 * Standard API error response
 */
function errorResponse(res, message = 'An error occurred', statusCode = 500, errors = null) {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
}

/**
 * Async wrapper — eliminates try/catch boilerplate in route handlers
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * Convert UTC datetime to a human-readable format
 */
function formatDateTime(datetime, timezone = 'UTC') {
  try {
    return new Date(datetime).toLocaleString('en-GB', {
      timeZone: timezone,
      day:    '2-digit',
      month:  'short',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
    });
  } catch {
    return datetime;
  }
}

/**
 * Sanitise user input — strip HTML tags to prevent XSS
 */
function sanitiseText(str) {
  if (!str) return '';
  return String(str).replace(/<[^>]*>/g, '').trim();
}

module.exports = {
  generatePredictionSlug,
  generateBlogSlug,
  formatOdds,
  calculateProfitLoss,
  getContinentFromCountry,
  paginate,
  parsePagination,
  successResponse,
  errorResponse,
  asyncHandler,
  formatDateTime,
  sanitiseText,
};
