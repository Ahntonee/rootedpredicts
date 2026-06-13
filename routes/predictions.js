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
  res.set('Cache-Control', 'no-store');
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
     WHERE published_at IS NOT NULL AND result != 'void' ${dateFilter}`
  );

  // Site-wide live metrics (not period-dependent)
  const [[{ leagues_covered }]] = await db.query(
    `SELECT COUNT(DISTINCT league_id) as leagues_covered
     FROM predictions WHERE published_at IS NOT NULL`
  );
  const [[{ members }]] = await db.query(`SELECT COUNT(*) as members FROM users`);

  // Admin overrides: each metric is LIVE unless an override string is set
  const overrides = {};
  try {
    const [ov] = await db.query('SELECT metric_key, override_value FROM site_stat_overrides');
    ov.forEach(r => { if (r.override_value) overrides[r.metric_key] = r.override_value; });
  } catch (e) { /* table may not exist on older deployments */ }

  // Per-day won/lost for the last 7 days — drives the homepage premium calendar
  const [dailyRows] = await db.query(
    `SELECT
       DATE(match_date)               as date,
       SUM(result = 'won')            as won,
       SUM(result = 'lost')           as lost
     FROM predictions
     WHERE published_at IS NOT NULL
       AND result IN ('won','lost')
       AND DATE(match_date) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
     GROUP BY DATE(match_date)
     ORDER BY date ASC`
  );
  const daily_results = dailyRows.map(r => ({
    date:   r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date).split('T')[0],
    result: parseInt(r.won) >= parseInt(r.lost) ? 'won' : 'lost',
    won:    parseInt(r.won)  || 0,
    lost:   parseInt(r.lost) || 0,
  }));

  const live = rows[0];
  const display = {
    accuracy:        overrides.accuracy        || (live.accuracy != null ? live.accuracy + '%' : 'New'),
    leagues_covered: overrides.leagues_covered || String(leagues_covered),
    members:         overrides.members         || String(members),
    predictions:     overrides.predictions     || String(live.total || 0),
  };

  return successResponse(res, { ...live, leagues_covered, members, display, overrides, daily_results });
}));

// ── GET /api/predictions/leaderboard — real verified results breakdown
router.get('/leaderboard', asyncHandler(async (req, res) => {
  const decided = "published_at IS NOT NULL AND result IN ('won','lost')";

  const [[overall]] = await db.query(
    `SELECT COUNT(*) total, SUM(result='won') won, SUM(result='lost') lost,
            ROUND(SUM(result='won')/NULLIF(COUNT(*),0)*100,1) accuracy
     FROM predictions WHERE ${decided}`
  );
  const [byMarket] = await db.query(
    `SELECT market, COUNT(*) total, SUM(result='won') won,
            ROUND(SUM(result='won')/NULLIF(COUNT(*),0)*100,1) accuracy
     FROM predictions WHERE ${decided}
     GROUP BY market HAVING total >= 1 ORDER BY total DESC`
  );
  const [byLeague] = await db.query(
    `SELECT l.name league, l.country, COUNT(*) total, SUM(p.result='won') won,
            ROUND(SUM(p.result='won')/NULLIF(COUNT(*),0)*100,1) accuracy
     FROM predictions p JOIN leagues l ON l.id = p.league_id
     WHERE p.published_at IS NOT NULL AND p.result IN ('won','lost')
     GROUP BY l.id, l.name, l.country HAVING total >= 1 ORDER BY total DESC, accuracy DESC LIMIT 12`
  );
  const [recent] = await db.query(
    `SELECT home_team, away_team, tip, odds, result, home_score, away_score, match_date
     FROM predictions WHERE ${decided}
     ORDER BY match_date DESC LIMIT 30`
  );

  return successResponse(res, { overall, by_market: byMarket, by_league: byLeague, recent });
}));

// ── GET /api/predictions — Main filtered listing
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
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
      p.category, p.visibility, p.result, p.slug, p.published_at,
      p.home_score, p.away_score, p.status_short, p.elapsed,
      p.home_form, p.away_form, p.h2h_summary,
      l.name as league_name, l.country as league_country,
      l.continent, l.logo_url as league_logo, l.flag_url as league_flag
    FROM predictions p
    LEFT JOIN leagues l ON p.league_id = l.id
    WHERE p.published_at IS NOT NULL
      AND p.result != 'void'
  `;
  const args = [];

  // Date filter
  if (date) {
    sql += ' AND DATE(p.match_date) = ?';
    args.push(date);
  } else if (req.query.upcoming) {
    // today onwards — keeps the homepage populated even when today is empty
    sql += ' AND DATE(p.match_date) >= CURDATE()';
  } else if (req.query.all_dates || (result && result !== 'all' && result !== 'pending')) {
    // No date restriction when browsing settled results (won/lost/void) or
    // when caller explicitly passes all_dates=1
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

  // Category filter — matches against the predictions.category DB column.
  // URL slugs (e.g. '2-5-goals') map to DB display values (e.g. '2.5 Goals').
  // 'free'/'all' = no extra filter; 'banker' also sorts by confidence DESC.
  const CATEGORY_MAP = {
    'free-pick':    'Free Pick',
    '1-5-goals':    '1.5 Goals',
    '2-5-goals':    '2.5 Goals',
    '3-5-goals':    '3.5 Goals',
    'acca':         'Acca Tips',
    'away-win':     'Away Win',
    'btts':         'BTTS',
    'double-chance':'Double Chance',
    'home-win':     'Home Win',
    'banker':       'Banker of the Day',
  };
  let categorySort = null;
  const category = (req.query.category || '').toLowerCase();
  if (category && category !== 'free' && category !== 'all') {
    if (category === 'banker') {
      sql += " AND p.category = 'Banker of the Day'";
      categorySort = 'confidence_score DESC';
    } else {
      const dbCat = CATEGORY_MAP[category];
      if (dbCat) {
        sql += ' AND p.category = ?';
        args.push(dbCat);
      }
    }
  }

  // Sorting — whitelist to prevent injection
  const allowedSort  = ['match_date', 'confidence_score', 'published_at', 'market'];
  const allowedOrder = ['ASC', 'DESC'];
  const safeSort  = allowedSort.includes(sort)   ? sort  : 'match_date';
  const safeOrder = allowedOrder.includes(order.toUpperCase()) ? order.toUpperCase() : 'ASC';
  sql += categorySort ? ` ORDER BY p.${categorySort}` : ` ORDER BY p.${safeSort} ${safeOrder}`;

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
