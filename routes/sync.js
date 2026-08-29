// routes/sync.js
// Rooted Predictions — Manual sync routes (admin only)
// POST /api/sync/leagues         — Sync all leagues from API-Football
// POST /api/sync/fixtures        — Sync fixtures for a date/league
// POST /api/sync/results         — Update results for finished matches
// POST /api/sync/teams/:leagueId — Sync teams for a league
// GET  /api/sync/status          — Current API request count

'use strict';

const express   = require('express');
const router    = express.Router();
const apiSvc    = require('../services/apiFootball');
const telegram  = require('../services/telegram');
const accuracy  = require('../services/accuracy');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler, successResponse, errorResponse } = require('../utils/helpers');

// All sync routes require admin authentication
router.use(authenticate, requireAdmin);

// ── GET /api/sync/status
router.get('/status', asyncHandler(async (req, res) => {
  const used      = apiSvc.getRequestCount();
  const limit     = apiSvc.getDailyLimit();
  const remaining = apiSvc.getRemainingCount();
  return successResponse(res, {
    requests_used:      used,
    requests_remaining: remaining,
    daily_limit:        limit,
    pct_used:           Math.round((used / limit) * 100),
    warning:            remaining <= 10 ? `Only ${remaining} requests left today — avoid bulk syncs until UTC midnight.` : null,
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

// ── POST /api/sync/league-season
// Body: { league_id: number, season: number }
// Bulk-syncs ALL fixtures for a league + season (e.g. World Cup 2026)
router.post('/league-season', asyncHandler(async (req, res) => {
  const { league_id, season } = req.body;
  if (!league_id || !season) {
    return errorResponse(res, 'league_id and season are required', 400);
  }
  const result = await apiSvc.syncLeagueSeasonFixtures(parseInt(league_id), parseInt(season));
  return successResponse(res, result,
    `Sync complete: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`);
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

// ── POST /api/sync/scores — scores + status + grading for a whole date
// Body: { date?: 'YYYY-MM-DD' }  (defaults to today)
router.post('/scores', asyncHandler(async (req, res) => {
  const date = req.body.date || new Date().toISOString().split('T')[0];
  const result = await apiSvc.syncScores(date);
  return successResponse(res, result, `Score sync complete for ${date}`);
}));

// ── POST /api/sync/live — update all in-play matches (1 API call)
router.post('/live', asyncHandler(async (req, res) => {
  const result = await apiSvc.syncLive();
  return successResponse(res, result, `Live sync: ${result.updated} updated`);
}));

// ── POST /api/sync/teams/:leagueId
router.post('/teams/:leagueId', asyncHandler(async (req, res) => {
  const leagueId = parseInt(req.params.leagueId);
  if (isNaN(leagueId)) return errorResponse(res, 'Valid league ID required', 400);
  const count = await apiSvc.syncTeams(leagueId);
  return successResponse(res, { synced: count }, `${count} teams synced for league ${leagueId}`);
}));

// ── POST /api/sync/odds
// Body: { date?: 'YYYY-MM-DD' }  (defaults to today; pass 'all' to cover every pending prediction)
// Loops through published predictions that have a fixture_id but no odds, fetches bookmaker
// odds from API-Football and writes them back. Uses 1 API call per prediction.
router.post('/odds', asyncHandler(async (req, res) => {
  if (!process.env.API_FOOTBALL_KEY) {
    return errorResponse(res, 'API_FOOTBALL_KEY not configured in .env', 400);
  }
  // Safety check — refuse if quota is nearly exhausted to avoid burning remaining calls
  const remaining = apiSvc.getRemainingCount();
  if (remaining <= 5) {
    return errorResponse(res, `Daily API quota nearly exhausted (${remaining} requests left). Odds backfill cancelled to protect remaining quota. Try again after UTC midnight.`, 429);
  }
  const db = require('../config/db');
  const dateParam = req.body.date || null;

  let dateFilter = '';
  const args = [];
  if (dateParam && dateParam !== 'all') {
    dateFilter = ' AND DATE(p.match_date) = ?';
    args.push(dateParam);
  } else if (!dateParam) {
    // Default: today
    dateFilter = ' AND DATE(p.match_date) = CURDATE()';
  }

  const [rows] = await db.query(
    `SELECT id, fixture_id, tip, market FROM predictions p
     WHERE p.published_at IS NOT NULL
       AND p.fixture_id IS NOT NULL
       AND p.odds IS NULL
       AND p.result = 'pending'
       ${dateFilter}
     ORDER BY p.match_date ASC`,
    args
  );

  if (!rows.length) {
    return successResponse(res, { updated: 0, skipped: 0, errors: 0 },
      'No predictions missing odds for this date');
  }

  let updated = 0, skipped = 0, errors = 0;
  const log = [];
  let firstApiError = null;

  for (const row of rows) {
    try {
      await new Promise(r => setTimeout(r, 300)); // respect rate limit
      const allOdds = await apiSvc.fetchFixtureOdds(row.fixture_id);
      if (!allOdds) {
        skipped++;
        log.push({ id: row.id, fixture_id: row.fixture_id, status: 'no_odds' });
        continue;
      }
      const marketOdds = allOdds[row.market] || null;
      const primaryOdd = apiSvc.oddsForTip(row.tip, row.market, marketOdds);
      const oddsJson   = marketOdds ? JSON.stringify(marketOdds) : null;

      await db.query(
        `UPDATE predictions SET odds = COALESCE(?, odds), odds_data = COALESCE(?, odds_data) WHERE id = ?`,
        [primaryOdd, oddsJson, row.id]
      );
      updated++;
      log.push({ id: row.id, fixture_id: row.fixture_id, status: 'updated', odds: primaryOdd });
    } catch (e) {
      errors++;
      log.push({ id: row.id, fixture_id: row.fixture_id, status: 'error', error: e.message });
      // If this looks like an API plan/auth error, stop immediately to avoid burning daily quota
      if (!firstApiError && /api error|plan|token|rateLimit|rate limit|access|unauthorized|403|401/i.test(e.message)) {
        firstApiError = e.message;
        log.push({ status: 'aborted', reason: 'API-level error detected — stopping to preserve request quota', error: firstApiError });
        break;
      }
    }
  }

  const msg = firstApiError
    ? `Odds backfill aborted after ${errors} error(s): ${firstApiError}`
    : `Odds backfill done: ${updated} updated, ${skipped} no bookmaker data, ${errors} errors`;

  return successResponse(res, { updated, skipped, errors, total: rows.length, log, aborted: !!firstApiError }, msg);
}));

// ── POST /api/sync/auto-predict
// Body: { limit?: number, min_confidence?: number, auto_publish?: boolean }
router.post('/auto-predict', asyncHandler(async (req, res) => {
  if (!process.env.API_FOOTBALL_KEY) {
    return errorResponse(res, 'API_FOOTBALL_KEY not configured in .env', 400);
  }

  // Apply same budget cap as the scheduler to prevent draining the daily quota.
  // Use DB-backed count so all PM2 cluster workers see the true shared total.
  const CALLS_PER_FIXTURE = 8;
  const DAILY_RESERVED    = 3500; // reserve for live + score syncs
  const HARD_CAP          = 50;
  const trueCount         = await apiSvc.syncCountFromDb();
  const remaining         = Math.max(0, apiSvc.getDailyLimit() - trueCount);
  const budgetLimit       = Math.min(HARD_CAP, Math.max(0, Math.floor((remaining - DAILY_RESERVED) / CALLS_PER_FIXTURE)));
  const requestedLimit    = parseInt(req.body.limit) || 20;
  const effectiveLimit    = Math.min(requestedLimit, budgetLimit);

  if (effectiveLimit <= 0) {
    return errorResponse(res,
      `API budget too low to run auto-predict. ${remaining} requests remaining today — need at least ${DAILY_RESERVED + CALLS_PER_FIXTURE} to process 1 fixture. Try again after UTC midnight.`,
      429);
  }

  const db      = require('../config/db');
  const options = {
    limit:         effectiveLimit,
    minConfidence: parseInt(req.body.min_confidence) || 55,
    autoPublish:   req.body.auto_publish !== false,
    date:          req.body.date || null,
    includePast:   req.body.include_past === true,
    forceCategory: req.body.force_category || null,  // pin all results to this category
  };
  console.log(`[SYNC] Manual auto-predict: requested=${requestedLimit} capped_to=${effectiveLimit} remaining=${remaining}`);
  const result = await apiSvc.autoPredictFixtures(db, options);

  // Fire-and-forget Telegram notification for newly published predictions
  if (result.enriched > 0) {
    const publishedIds = (result.log || []).filter(r => r.published && r.id).map(r => r.id);
    if (publishedIds.length) {
      const dateLabel = options.date
        ? new Date(options.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      (async () => {
        try {
          const [preds] = await db.query(
            `SELECT p.id, p.slug, p.home_team, p.away_team, p.match_date,
                    p.tip, p.market, p.odds, p.confidence_score,
                    l.name AS league_name, l.country AS league_country
             FROM predictions p
             LEFT JOIN leagues l ON l.id = p.league_id
             WHERE p.id IN (${publishedIds.map(() => '?').join(',')})`,
            publishedIds
          );
          await telegram.sendPredictions(preds, { date: dateLabel, generated: result.enriched });
        } catch (e) {
          console.error('[TELEGRAM] auto-predict hook failed:', e.message);
        }
      })();
    }
  }

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
  const trueCount  = await apiSvc.syncCountFromDb();
  const remaining  = Math.max(0, apiSvc.getDailyLimit() - trueCount);
  if (remaining < 8) {
    return errorResponse(res, `API budget exhausted (${remaining} left). Research requires ~8 calls. Try again after UTC midnight.`, 429);
  }
  const data = await apiSvc.researchFixture(fixtureId);
  return successResponse(res, data);
}));

// ── POST /api/sync/today — Sync ALL fixtures for today + tomorrow (2 API calls)
router.post('/today', asyncHandler(async (req, res) => {
  const today    = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const results = [];

  try {
    // No league filter → one call returns every fixture across all leagues for that date
    const r1 = await apiSvc.syncFixtures(today, null);
    results.push({ date: today, ...r1 });

    await new Promise(r => setTimeout(r, 300));

    const r2 = await apiSvc.syncFixtures(tomorrow, null);
    results.push({ date: tomorrow, ...r2 });
  } catch (e) {
    results.push({ error: e.message });
  }

  const totalCreated = results.reduce((s, r) => s + (r.created || 0), 0);
  return successResponse(res, { results, total_created: totalCreated },
    `Daily sync complete: ${totalCreated} new fixtures across all leagues`);
}));

// ── POST /api/sync/backfill
// Body: { leagues: [39,140,...], seasons: [2022,2023,2024] }
// Syncs ALL fixtures (including finished ones with actual scores) for each league+season combo.
// One API request per league+season combination.
router.post('/backfill', asyncHandler(async (req, res) => {
  if (!process.env.API_FOOTBALL_KEY) {
    return errorResponse(res, 'API_FOOTBALL_KEY not configured in .env', 400);
  }
  const db      = require('../config/db');
  const leagues = Array.isArray(req.body.leagues) ? req.body.leagues.map(Number).filter(Boolean) : [];
  const seasons = Array.isArray(req.body.seasons) ? req.body.seasons.map(Number).filter(Boolean) : [];

  if (!leagues.length || !seasons.length) {
    return errorResponse(res, 'leagues (array) and seasons (array) are required', 400);
  }

  const total = leagues.length * seasons.length;

  // Respond immediately — backfill runs in background to avoid 504 timeout
  res.status(202).json({
    success: true,
    message: `Backfill started in background: ${leagues.length} leagues × ${seasons.length} seasons = ${total} API requests. Progress logged to server console.`,
    total_requests: total,
  });

  // Background job — no response to send, errors only logged
  ;(async () => {
    let totalCreated = 0, totalBackfilled = 0, totalUpdated = 0;
    console.log(`[BACKFILL] Starting: ${leagues.length} leagues × ${seasons.length} seasons = ${total} requests`);
    for (const leagueId of leagues) {
      for (const season of seasons) {
        try {
          await new Promise(r => setTimeout(r, 300));
          const r = await apiSvc.syncLeagueSeasonFixtures(leagueId, season, { backfill: true });
          totalCreated    += r.created    || 0;
          totalBackfilled += r.backfilled || 0;
          totalUpdated    += r.updated    || 0;
          console.log(`[BACKFILL] league=${leagueId} season=${season}: ${r.created} created (${r.backfilled || 0} historical), ${r.updated} updated`);
        } catch (e) {
          console.error(`[BACKFILL] Failed league=${leagueId} season=${season}:`, e.message);
        }
      }
    }
    console.log(`[BACKFILL] Done: ${totalCreated} inserted (${totalBackfilled} historical), ${totalUpdated} updated`);
  })().catch(e => console.error('[BACKFILL] Fatal:', e.message));
}));

// ── POST /api/sync/grade-all
// Grades all predictions that have stored scores (home_score/away_score) but result='pending'.
// Then logs outcomes and recalculates accuracy_stats for calibration.
router.post('/grade-all', asyncHandler(async (req, res) => {
  const db      = require('../config/db');
  const graded  = await apiSvc.gradeFromScores(db);
  const logged  = await accuracy.logUntracked(db);
  await accuracy.recalculateStats(db);
  return successResponse(res, { graded, logged },
    `Graded ${graded} predictions, logged ${logged} outcomes, accuracy stats recalculated`);
}));

// ── POST /api/sync/recalibrate
// Logs any untracked resolved predictions then recalculates accuracy_stats.
router.post('/recalibrate', asyncHandler(async (req, res) => {
  const db     = require('../config/db');
  const logged = await accuracy.logUntracked(db);
  await accuracy.recalculateStats(db);
  return successResponse(res, { logged }, `Logged ${logged} new outcomes, accuracy stats recalculated`);
}));

module.exports = router;
