// routes/sync.js
// AfroPredict — Manual sync routes (admin only)
// POST /api/sync/leagues         — Sync all leagues from API-Football
// POST /api/sync/fixtures        — Sync fixtures for a date/league
// POST /api/sync/results         — Update results for finished matches
// POST /api/sync/teams/:leagueId — Sync teams for a league
// GET  /api/sync/status          — Current API request count

'use strict';

const express   = require('express');
const router    = express.Router();
const apiSvc    = require('../services/apiFootball');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler, successResponse, errorResponse } = require('../utils/helpers');

// All sync routes require admin authentication
router.use(authenticate, requireAdmin);

// ── GET /api/sync/status
router.get('/status', asyncHandler(async (req, res) => {
  return successResponse(res, {
    requests_used:      apiSvc.getRequestCount(),
    requests_remaining: apiSvc.getRemainingCount(),
    daily_limit:        7400,
    season:             apiSvc.CURRENT_SEASON,
  });
}));

// ── POST /api/sync/leagues
router.post('/leagues', asyncHandler(async (req, res) => {
  if (!process.env.API_FOOTBALL_KEY) {
    return errorResponse(res, 'API_FOOTBALL_KEY not configured in .env', 400);
  }
  const result = await apiSvc.syncLeagues();
  return successResponse(res, result, `League sync complete: ${result.synced} synced`);
}));

// ── POST /api/sync/fixtures
// Body: { date: 'YYYY-MM-DD', league_id?: number }
router.post('/fixtures', asyncHandler(async (req, res) => {
  const { date, league_id } = req.body;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return errorResponse(res, 'Valid date required in YYYY-MM-DD format', 400);
  }

  const result = await apiSvc.syncFixtures(date, league_id || null);
  return successResponse(res, result, `Fixture sync complete for ${date}`);
}));

// ── POST /api/sync/results
// Body: { date: 'YYYY-MM-DD' }
router.post('/results', asyncHandler(async (req, res) => {
  const date = req.body.date || new Date().toISOString().split('T')[0];
  const result = await apiSvc.syncResults(date);
  return successResponse(res, result, `Results sync complete for ${date}`);
}));

// ── POST /api/sync/teams/:leagueId
router.post('/teams/:leagueId', asyncHandler(async (req, res) => {
  const leagueId = parseInt(req.params.leagueId);
  if (isNaN(leagueId)) return errorResponse(res, 'Valid league ID required', 400);
  const count = await apiSvc.syncTeams(leagueId);
  return successResponse(res, { synced: count }, `${count} teams synced for league ${leagueId}`);
}));

// ── POST /api/sync/auto-predict
// Body: { limit?: number, min_confidence?: number, auto_publish?: boolean }
router.post('/auto-predict', asyncHandler(async (req, res) => {
  if (!process.env.API_FOOTBALL_KEY) {
    return errorResponse(res, 'API_FOOTBALL_KEY not configured in .env', 400);
  }
  const db      = require('../config/db');
  const options = {
    limit:         parseInt(req.body.limit)          || 20,
    minConfidence: parseInt(req.body.min_confidence) || 55,
    autoPublish:   req.body.auto_publish !== false,
  };
  const result = await apiSvc.autoPredictFixtures(db, options);
  return successResponse(res, result,
    `Auto-predict done: ${result.enriched} predictions generated, ${result.errors} errors`);
}));

// ── GET /api/sync/research/:fixtureId — Live research data for a fixture
router.get('/research/:fixtureId', asyncHandler(async (req, res) => {
  if (!process.env.API_FOOTBALL_KEY) {
    return errorResponse(res, 'API_FOOTBALL_KEY not configured in .env', 400);
  }
  const fixtureId = parseInt(req.params.fixtureId);
  if (isNaN(fixtureId)) return errorResponse(res, 'Valid fixture ID required', 400);
  const data = await apiSvc.researchFixture(fixtureId);
  return successResponse(res, data);
}));

// ── POST /api/sync/today — Sync today + tomorrow fixtures for popular leagues
router.post('/today', asyncHandler(async (req, res) => {
  const today    = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const results = [];

  // Sync popular leagues for today and tomorrow
  const POPULAR = [39, 140, 135, 78, 61, 2, 3, 253, 71, 6];

  for (const leagueId of POPULAR) {
    try {
      const r1 = await apiSvc.syncFixtures(today, leagueId);
      results.push({ league: leagueId, date: today, ...r1 });
      // Small delay between requests
      await new Promise(r => setTimeout(r, 200));

      const r2 = await apiSvc.syncFixtures(tomorrow, leagueId);
      results.push({ league: leagueId, date: tomorrow, ...r2 });
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      results.push({ league: leagueId, error: e.message });
    }
  }

  const totalCreated = results.reduce((s, r) => s + (r.created || 0), 0);
  return successResponse(res, { results, total_created: totalCreated },
    `Daily sync complete: ${totalCreated} new fixtures`);
}));

module.exports = router;
