// routes/predictions.js
// Rooted Predictions — Predictions routes
// GET /api/predictions          — Filtered prediction listing
// GET /api/predictions/:slug    — Single prediction by slug
// GET /api/predictions/stats    — Accuracy statistics

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { asyncHandler, successResponse, errorResponse, parsePagination, paginate } = require('../utils/helpers');
const { optionalAuth } = require('../middleware/auth');

// ── GET /api/predictions/stats — Overall accuracy stats
router.get('/stats', asyncHandler(async (req, res) => {
  const { period } = req.query; // 'today' | 'month' | 'year' | 'all'

  let dateFilter = '';
  if (period === 'today') {
    dateFilter = 'AND DATE(match_date) = CURDATE()';
  } else if (period === 'month') {
    dateFilter = 'AND YEAR(match_date) = YEAR(NOW()) AND MONTH(match_date) = MONTH(NOW())';
  } else if (period === 'year') {
    dateFilter = 'AND YEAR(match_date) = YEAR(NOW())';
  }

  const [rows] = await db.query(
    `SELECT
       COUNT(*) as total,
       SUM(result = 'won')     as won,
       SUM(result = 'lost')    as lost,
       SUM(result = 'pending') as pending,
       ROUND(SUM(result='won') / NULLIF(SUM(result IN ('won','lost')),0) * 100, 1) as accuracy
     FROM predictions
     WHERE result != 'void' ${dateFilter}`
  );

  return successResponse(res, rows[0]);
}));

// ── GET /api/predictions — Main filtered listing
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const {
    date,
    league,
    market,
    continent,
    country,
    visibility,
    result,
    confidence_min,
    sort = 'match_date',
    order = 'ASC',
  } = req.query;

  const { page, limit, offset } = parsePagination(req.query);

  // Base query joining leagues table for meta
  let sql = `
    SELECT
      p.id, p.fixture_id, p.league_id, p.home_team, p.away_team,
      p.home_team_logo, p.away_team_logo, p.match_date,
      p.tip, p.market, p.odds, p.confidence_score,
      p.visibility, p.result, p.slug, p.published_at,
      p.home_form, p.away_form, p.h2h_summary,
      l.name as league_name, l.country as league_country,
      l.continent, l.logo_url as league_logo, l.flag_url as league_flag
    FROM predictions p
    LEFT JOIN leagues l ON p.league_id = l.id
    WHERE p.published_at IS NOT NULL
  `;
  const args = [];

  // Date filter — default today
  if (date) {
    sql += ' AND DATE(p.match_date) = ?';
    args.push(date);
  } else {
    sql += ' AND DATE(p.match_date) = CURDATE()';
  }

  // League filter
  if (league && league !== 'all') {
    const col = isNaN(league) ? 'l.name' : 'l.api_league_id';
    sql += ` AND ${col} = ?`;
    args.push(league);
  }

  // Market filter
  if (market && market !== 'all') {
    const marketMap = {
      '1x2':           '1X2',
      'over-2-5':      'Over/Under',
      'btts':          'BTTS',
      'correct-score': 'Correct Score',
      'draw':          'Draw No Bet',
      'acca':          'Accumulator',
    };
    sql += ' AND p.market = ?';
    args.push(marketMap[market] || market);
  }

  // Continent filter
  if (continent && continent !== 'all') {
    sql += ' AND l.continent = ?';
    args.push(continent);
  }

  // Country filter
  if (country) {
    sql += ' AND l.country = ?';
    args.push(country);
  }

  // Visibility — VIP content hidden from non-VIP users
  if (visibility && visibility !== 'all') {
    sql += ' AND p.visibility = ?';
    args.push(visibility);
  } else if (!req.user || !['vip', 'admin'].includes(req.user.role)) {
    // Non-VIP users can see free predictions plus VIP teasers (without tip details)
    // Full VIP content restriction handled in response masking below
  }

  // Result filter
  if (result && result !== 'all') {
    sql += ' AND p.result = ?';
    args.push(result);
  }

  // Confidence minimum
  if (confidence_min) {
    sql += ' AND p.confidence_score >= ?';
    args.push(parseInt(confidence_min));
  }

  // Sorting — whitelist to prevent injection
  const allowedSort  = ['match_date', 'confidence_score', 'published_at', 'market'];
  const allowedOrder = ['ASC', 'DESC'];
  const safeSort  = allowedSort.includes(sort)   ? sort  : 'match_date';
  const safeOrder = allowedOrder.includes(order.toUpperCase()) ? order.toUpperCase() : 'ASC';
  sql += ` ORDER BY p.${safeSort} ${safeOrder}`;

  // Count query
  const countSql = sql.replace(
    /SELECT[\s\S]+?FROM predictions/,
    'SELECT COUNT(*) as total FROM predictions'
  );

  // Apply pagination
  sql += ' LIMIT ? OFFSET ?';
  args.push(limit, offset);

  const [[countRows], [predictions]] = await Promise.all([
    db.query(countSql.split('LIMIT')[0], args.slice(0, -2)),
    db.query(sql, args),
  ]);
  const total = (countRows[0] && countRows[0].total) || 0;

  // Mask VIP tip content for non-VIP users
  const isVip = req.user && ['vip', 'admin'].includes(req.user.role);
  const masked = predictions.map(p => {
    if (p.visibility === 'vip' && !isVip) {
      return { ...p, tip: null, odds: null, analysis: null, locked: true };
    }
    return { ...p, locked: false };
  });

  return successResponse(res, {
    predictions: masked,
    pagination:  paginate(parseInt(total), page, limit),
  });
}));

// ── GET /api/predictions/:slug — Single prediction detail
router.get('/:slug', optionalAuth, asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    `SELECT
       p.*, l.name as league_name, l.country as league_country,
       l.continent, l.logo_url as league_logo, l.flag_url as league_flag,
       l.api_league_id
     FROM predictions p
     LEFT JOIN leagues l ON p.league_id = l.id
     WHERE p.slug = ? AND p.published_at IS NOT NULL`,
    [req.params.slug]
  );

  if (!rows.length) return errorResponse(res, 'Prediction not found', 404);

  const prediction = rows[0];

  // Mask VIP content
  const isVip = req.user && ['vip', 'admin'].includes(req.user.role);
  if (prediction.visibility === 'vip' && !isVip) {
    prediction.tip      = null;
    prediction.odds     = null;
    prediction.analysis = null;
    prediction.locked   = true;
  } else {
    prediction.locked = false;
  }

  // Fetch comments count
  const [[{ comment_count }]] = await db.query(
    'SELECT COUNT(*) as comment_count FROM comments WHERE prediction_id = ? AND is_approved = 1',
    [prediction.id]
  );
  prediction.comment_count = comment_count;

  return successResponse(res, prediction);
}));

module.exports = router;
