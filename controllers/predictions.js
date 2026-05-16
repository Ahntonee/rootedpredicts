// controllers/predictions.js
// AfroPredict — Prediction data access layer
// Shared query helpers used by routes and the scheduler

'use strict';

const db = require('../config/db');

/**
 * Get today's predictions with league info — used by home page and scheduler
 */
async function getTodaysPredictions(options = {}) {
  const {
    limit      = 50,
    visibility = null,  // 'free' | 'vip' | null (all)
    market     = null,
    continent  = null,
    leagueId   = null,
  } = options;

  let sql = `
    SELECT
      p.id, p.fixture_id, p.league_id, p.home_team, p.away_team,
      p.home_team_logo, p.away_team_logo, p.match_date,
      p.tip, p.market, p.odds, p.confidence_score, p.visibility,
      p.result, p.slug, p.home_form, p.away_form, p.h2h_summary,
      l.name as league_name, l.country as league_country,
      l.continent, l.logo_url as league_logo, l.flag_url as league_flag
    FROM predictions p
    LEFT JOIN leagues l ON p.league_id = l.id
    WHERE DATE(p.match_date) = CURDATE()
      AND p.published_at IS NOT NULL
  `;
  const args = [];

  if (visibility)  { sql += ' AND p.visibility = ?';  args.push(visibility); }
  if (market)      { sql += ' AND p.market = ?';      args.push(market); }
  if (continent)   { sql += ' AND l.continent = ?';   args.push(continent); }
  if (leagueId)    { sql += ' AND p.league_id = ?';   args.push(leagueId); }

  sql += ' ORDER BY p.confidence_score DESC, p.match_date ASC LIMIT ?';
  args.push(limit);

  const [rows] = await db.query(sql, args);
  return rows;
}

/**
 * Get accuracy statistics for a given period
 */
async function getAccuracyStats(period = 'month') {
  let dateFilter = '';
  if (period === 'today')
    dateFilter = "AND DATE(match_date) = CURDATE()";
  else if (period === 'month')
    dateFilter = "AND YEAR(match_date)=YEAR(NOW()) AND MONTH(match_date)=MONTH(NOW())";
  else if (period === 'year')
    dateFilter = "AND YEAR(match_date)=YEAR(NOW())";

  const [[overall]] = await db.query(`
    SELECT
      COUNT(*) as total,
      SUM(result='won') as won, SUM(result='lost') as lost,
      SUM(result='pending') as pending,
      ROUND(SUM(result='won')/NULLIF(SUM(result IN ('won','lost')),0)*100,1) as accuracy
    FROM predictions WHERE result != 'void' ${dateFilter}
  `);

  const [byMarket] = await db.query(`
    SELECT market,
      COUNT(*) as total, SUM(result='won') as won, SUM(result='lost') as lost,
      ROUND(SUM(result='won')/NULLIF(SUM(result IN ('won','lost')),0)*100,1) as accuracy
    FROM predictions WHERE result != 'void' ${dateFilter}
    GROUP BY market ORDER BY accuracy DESC
  `);

  const [byLeague] = await db.query(`
    SELECT l.name as league_name, l.logo_url,
      COUNT(*) as total, SUM(p.result='won') as won,
      ROUND(SUM(p.result='won')/NULLIF(SUM(p.result IN ('won','lost')),0)*100,1) as accuracy
    FROM predictions p
    LEFT JOIN leagues l ON p.league_id = l.id
    WHERE p.result != 'void' ${dateFilter}
    GROUP BY p.league_id HAVING total >= 5
    ORDER BY accuracy DESC LIMIT 10
  `);

  return { overall, byMarket, byLeague };
}

/**
 * Get prediction by ID with full details
 */
async function getPredictionById(id) {
  const [rows] = await db.query(
    `SELECT p.*, l.name as league_name, l.country as league_country,
            l.logo_url as league_logo, l.flag_url as league_flag, l.api_league_id
     FROM predictions p LEFT JOIN leagues l ON p.league_id = l.id
     WHERE p.id = ?`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Get recent results for leaderboard page
 */
async function getRecentResults(limit = 20) {
  const [rows] = await db.query(
    `SELECT p.home_team, p.away_team, p.tip, p.market, p.odds,
            p.result, p.match_date, p.confidence_score, p.slug,
            l.name as league_name, l.logo_url as league_logo
     FROM predictions p LEFT JOIN leagues l ON p.league_id = l.id
     WHERE p.result IN ('won','lost') AND p.published_at IS NOT NULL
     ORDER BY p.match_date DESC LIMIT ?`,
    [limit]
  );
  return rows;
}

module.exports = {
  getTodaysPredictions,
  getAccuracyStats,
  getPredictionById,
  getRecentResults,
};
