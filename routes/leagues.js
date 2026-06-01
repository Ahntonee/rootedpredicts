// routes/leagues.js
// Rooted Predictions — League routes
// GET /api/leagues              — All active leagues (grouped by continent)
// GET /api/leagues/popular      — Popular/pinned leagues only
// GET /api/leagues/:id/fixtures — Fixtures for a specific league

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { asyncHandler, successResponse, errorResponse, parsePagination } = require('../utils/helpers');

// ── GET /api/leagues — All active leagues grouped by continent
router.get('/', asyncHandler(async (req, res) => {
  const { continent, country, search, grouped } = req.query;

  let sql    = 'SELECT * FROM leagues WHERE is_active = 1';
  const args = [];

  if (continent && continent !== 'all') {
    sql += ' AND continent = ?';
    args.push(continent);
  }
  if (country) {
    sql += ' AND country = ?';
    args.push(country);
  }
  if (search) {
    sql += ' AND (name LIKE ? OR country LIKE ?)';
    args.push(`%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY is_popular DESC, continent ASC, country ASC, name ASC';

  const [leagues] = await db.query(sql, args);

  // Return flat list or grouped by continent
  if (grouped === 'true') {
    const groups = {};
    for (const league of leagues) {
      const key = league.continent || 'World';
      if (!groups[key]) groups[key] = [];
      groups[key].push(league);
    }
    return successResponse(res, groups);
  }

  return successResponse(res, leagues);
}));

// ── GET /api/leagues/popular — Popular leagues only
router.get('/popular', asyncHandler(async (req, res) => {
  const [leagues] = await db.query(
    'SELECT * FROM leagues WHERE is_popular = 1 AND is_active = 1 ORDER BY name ASC'
  );
  return successResponse(res, leagues);
}));

// ── GET /api/leagues/continents — Unique continent list with counts
router.get('/continents', asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    `SELECT continent, COUNT(*) as league_count
     FROM leagues WHERE is_active = 1
     GROUP BY continent ORDER BY continent ASC`
  );
  return successResponse(res, rows);
}));

// ── GET /api/leagues/:id — Single league detail
router.get('/:id', asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    'SELECT * FROM leagues WHERE id = ? AND is_active = 1',
    [req.params.id]
  );
  if (!rows.length) return errorResponse(res, 'League not found', 404);
  return successResponse(res, rows[0]);
}));

module.exports = router;
