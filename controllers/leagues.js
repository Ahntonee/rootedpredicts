// controllers/leagues.js
// Rooted Predictions — League data access helpers

'use strict';

const db = require('../config/db');

/**
 * Get all active leagues grouped by continent — used by league filter dropdown
 */
async function getLeaguesGrouped() {
  const [leagues] = await db.query(
    `SELECT id, api_league_id, name, country, continent, flag_url, logo_url, is_popular
     FROM leagues WHERE is_active = 1
     ORDER BY is_popular DESC, continent ASC, country ASC, name ASC`
  );

  const CONTINENT_ORDER = ['World', 'Europe', 'Africa', 'Americas', 'Asia', 'Oceania'];
  const groups = {};

  for (const league of leagues) {
    const cont = league.continent || 'World';
    if (!groups[cont]) groups[cont] = [];
    groups[cont].push(league);
  }

  // Return in ordered array format for frontend consumption
  const ordered = CONTINENT_ORDER
    .filter(c => groups[c] && groups[c].length)
    .map(c => ({ continent: c, leagues: groups[c] }));

  return ordered;
}

/**
 * Get leagues that have predictions for today — for the filter dropdown on predictions page
 */
async function getActiveLeaguesToday() {
  const [rows] = await db.query(
    `SELECT DISTINCT l.id, l.api_league_id, l.name, l.country, l.continent,
            l.logo_url, l.flag_url, l.is_popular,
            COUNT(p.id) as tip_count
     FROM predictions p
     INNER JOIN leagues l ON p.league_id = l.id
     WHERE DATE(p.match_date) = CURDATE() AND p.published_at IS NOT NULL
     GROUP BY l.id
     ORDER BY l.is_popular DESC, tip_count DESC, l.name ASC`
  );
  return rows;
}

/**
 * Get a single league with today's prediction count
 */
async function getLeagueWithStats(leagueId) {
  const [rows] = await db.query(
    `SELECT l.*,
       (SELECT COUNT(*) FROM predictions p WHERE p.league_id = l.id AND DATE(p.match_date) = CURDATE()) as tips_today,
       (SELECT COUNT(*) FROM predictions p WHERE p.league_id = l.id) as tips_total
     FROM leagues l WHERE l.id = ?`,
    [leagueId]
  );
  return rows[0] || null;
}

module.exports = { getLeaguesGrouped, getActiveLeaguesToday, getLeagueWithStats };
