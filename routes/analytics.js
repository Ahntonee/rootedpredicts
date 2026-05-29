// routes/analytics.js
// AfroPredict — Prediction Intelligence Engine (admin-only)
// Aggregates API-Football data into actionable stats for informed prediction creation.
'use strict';

const express  = require('express');
const router   = express.Router();
const db       = require('../config/db');
const api      = require('../services/apiFootball');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler, successResponse, errorResponse } = require('../utils/helpers');

// All analytics routes require admin role
router.use(authenticate, requireAdmin);

// ── GET /api/admin/analytics/popular-leagues
// Returns our seeded popular leagues with API IDs for the league selector
router.get('/popular-leagues', asyncHandler(async (req, res) => {
  const [leagues] = await db.query(
    `SELECT id, api_league_id, name, country, logo_url, continent
     FROM leagues
     WHERE is_popular = 1 AND is_active = 1
     ORDER BY continent, name ASC`
  );
  return successResponse(res, leagues);
}));

// ── GET /api/admin/analytics/league-metrics?league_api_id=39&season=2024
// Calculates over/BTTS/win-rate metrics from last 50 finished fixtures
router.get('/league-metrics', asyncHandler(async (req, res) => {
  const { league_api_id, season } = req.query;
  if (!league_api_id) return errorResponse(res, 'league_api_id is required', 400);

  const useSeason = parseInt(season || api.CURRENT_SEASON);

  // Free plan doesn't support 'last' — use from/to date range instead.
  // For a finished season use the last 4 months of it; for current use a 4-month lookback.
  const today      = new Date();
  const seasonEnd  = new Date(`${useSeason + 1}-07-31`);
  let fromDate, toDate;
  if (today > seasonEnd) {
    // Season already finished — use Mar→Jul of the following calendar year
    fromDate = `${useSeason + 1}-03-01`;
    toDate   = `${useSeason + 1}-07-31`;
  } else {
    // Season ongoing — last 4 months up to today
    const from = new Date(today);
    from.setMonth(today.getMonth() - 4);
    fromDate = from.toISOString().split('T')[0];
    toDate   = today.toISOString().split('T')[0];
  }

  const { data: fixtures } = await api.fetchLeagueFixtures(league_api_id, useSeason, {
    status: 'FT',
    from:   fromDate,
    to:     toDate,
  });

  if (!fixtures || !fixtures.length) {
    return successResponse(res, { fixtures_analysed: 0, metrics: null });
  }

  let totalGoals = 0, over15 = 0, over25 = 0, over35 = 0, btts = 0;
  let homeWins   = 0, awayWins = 0, draws = 0;
  const teamMap  = {};

  for (const f of fixtures) {
    const hg    = f.goals.home ?? 0;
    const ag    = f.goals.away ?? 0;
    const total = hg + ag;
    totalGoals += total;
    if (total > 1.5) over15++;
    if (total > 2.5) over25++;
    if (total > 3.5) over35++;
    if (hg > 0 && ag > 0) btts++;
    if (f.teams.home.winner === true)       homeWins++;
    else if (f.teams.away.winner === true)  awayWins++;
    else                                    draws++;

    // Per-team accumulation
    const hn = f.teams.home.name;
    const an = f.teams.away.name;
    if (!teamMap[hn]) teamMap[hn] = { name: hn, logo: f.teams.home.logo, id: f.teams.home.id, scored: 0, conceded: 0, played: 0, wins: 0 };
    if (!teamMap[an]) teamMap[an] = { name: an, logo: f.teams.away.logo, id: f.teams.away.id, scored: 0, conceded: 0, played: 0, wins: 0 };
    teamMap[hn].scored   += hg;
    teamMap[hn].conceded += ag;
    teamMap[hn].played   += 1;
    if (f.teams.home.winner === true) teamMap[hn].wins++;
    teamMap[an].scored   += ag;
    teamMap[an].conceded += hg;
    teamMap[an].played   += 1;
    if (f.teams.away.winner === true) teamMap[an].wins++;
  }

  const n   = fixtures.length;
  const pct = v => Math.round((v / n) * 100);

  const teams = Object.values(teamMap).map(t => ({
    ...t,
    avg_scored:   +(t.scored   / t.played).toFixed(2),
    avg_conceded: +(t.conceded / t.played).toFixed(2),
    win_rate:     Math.round((t.wins / t.played) * 100),
  }));

  const byScored    = [...teams].sort((a, b) => b.avg_scored   - a.avg_scored).slice(0, 8);
  const byConceded  = [...teams].sort((a, b) => b.avg_conceded - a.avg_conceded).slice(0, 8);
  const byWinRate   = [...teams].sort((a, b) => b.win_rate     - a.win_rate).slice(0, 8);

  return successResponse(res, {
    fixtures_analysed:  n,
    avg_goals_per_game: +(totalGoals / n).toFixed(2),
    over_1_5_rate:      pct(over15),
    over_2_5_rate:      pct(over25),
    over_3_5_rate:      pct(over35),
    btts_rate:          pct(btts),
    home_win_rate:      pct(homeWins),
    draw_rate:          pct(draws),
    away_win_rate:      pct(awayWins),
    top_attackers:      byScored,
    leakiest_defences:  byConceded,
    top_win_rates:      byWinRate,
  });
}));

// ── GET /api/admin/analytics/standings?league_api_id=39&season=2024
// Returns the full league table from API-Football standings
router.get('/standings', asyncHandler(async (req, res) => {
  const { league_api_id, season } = req.query;
  if (!league_api_id) return errorResponse(res, 'league_api_id is required', 400);

  const useSeason = season || api.CURRENT_SEASON;
  const { data }  = await api.fetchStandings(league_api_id, useSeason);

  if (!data || !data.length || !data[0]?.league?.standings) {
    return successResponse(res, { league: null, standings: [] });
  }

  const info  = data[0].league;
  const table = info.standings.flat().map(t => ({
    rank:        t.rank,
    team:        { id: t.team.id, name: t.team.name, logo: t.team.logo },
    played:      t.all.played,
    won:         t.all.win,
    drawn:       t.all.draw,
    lost:        t.all.lose,
    gf:          t.all.goals.for,
    ga:          t.all.goals.against,
    gd:          t.goalsDiff,
    points:      t.points,
    form:        (t.form || '').split('').slice(-5),
    description: t.description || '',
  }));

  return successResponse(res, {
    league:    { id: info.id, name: info.name, logo: info.logo, season: info.season },
    standings: table,
  });
}));

// ── GET /api/admin/analytics/team-stats?team_api_id=33&league_api_id=39
// Deep stats for one team: goals, wins, clean sheets, over rates, form
router.get('/team-stats', asyncHandler(async (req, res) => {
  const { team_api_id, league_api_id, season } = req.query;
  if (!team_api_id || !league_api_id) {
    return errorResponse(res, 'team_api_id and league_api_id are required', 400);
  }

  const useSeason    = season || api.CURRENT_SEASON;
  const [stats, recentFixtures] = await Promise.all([
    api.fetchTeamStats(team_api_id, league_api_id, useSeason).catch(() => null),
    api.fetchTeamForm(team_api_id, 10).catch(() => []),
  ]);

  if (!stats) return errorResponse(res, 'No statistics found for this team/league', 404);

  // Calculate over/BTTS rates from last 10 fixtures
  let over15 = 0, over25 = 0, over35 = 0, bttsCnt = 0;
  const ft   = recentFixtures.length;
  for (const f of recentFixtures) {
    const total = (f.goals.home ?? 0) + (f.goals.away ?? 0);
    if (total > 1.5) over15++;
    if (total > 2.5) over25++;
    if (total > 3.5) over35++;
    if ((f.goals.home ?? 0) > 0 && (f.goals.away ?? 0) > 0) bttsCnt++;
  }

  const form        = api.calculateFormString(recentFixtures, parseInt(team_api_id));
  const recentResults = recentFixtures.slice(0, 5).map(f => {
    const isHome = f.teams.home.id === parseInt(team_api_id);
    const winner = isHome ? f.teams.home.winner : f.teams.away.winner;
    return {
      date:     f.fixture.date?.split('T')[0],
      home:     f.teams.home.name,
      away:     f.teams.away.name,
      score:    `${f.goals.home ?? 0}–${f.goals.away ?? 0}`,
      result:   winner === true ? 'W' : winner === false ? 'L' : 'D',
    };
  });

  return successResponse(res, {
    team:    { id: stats.team?.id, name: stats.team?.name, logo: stats.team?.logo },
    league:  { id: stats.league?.id, name: stats.league?.name, season: stats.league?.season },
    played:  stats.fixtures?.played?.total,
    wins:    stats.fixtures?.wins?.total,
    draws:   stats.fixtures?.draws?.total,
    losses:  stats.fixtures?.loses?.total,
    goals_scored:    stats.goals?.for?.total?.total,
    goals_scored_avg: stats.goals?.for?.average?.total,
    goals_conceded:   stats.goals?.against?.total?.total,
    goals_conceded_avg: stats.goals?.against?.average?.total,
    clean_sheets:    stats.clean_sheet?.total,
    failed_to_score: stats.failed_to_score?.total,
    form,
    recent_results:  recentResults,
    over_rates: ft > 0 ? {
      sample:  ft,
      over_15: Math.round((over15  / ft) * 100),
      over_25: Math.round((over25  / ft) * 100),
      over_35: Math.round((over35  / ft) * 100),
      btts:    Math.round((bttsCnt / ft) * 100),
    } : null,
    biggest_win:  stats.biggest?.wins?.total  || null,
    biggest_loss: stats.biggest?.loses?.total || null,
  });
}));

// ── GET /api/admin/analytics/upcoming?date=2026-05-27&league_api_id=39
// Returns upcoming fixtures for a given date (and optional league filter)
router.get('/upcoming', asyncHandler(async (req, res) => {
  const { date, league_api_id } = req.query;
  const useDate = date || new Date().toISOString().split('T')[0];

  const { data: fixtures } = await api.fetchFixturesByDate(useDate, league_api_id || null);

  const list = (fixtures || []).map(f => ({
    id:     f.fixture.id,
    date:   f.fixture.date,
    status: f.fixture.status.short,
    home:   { id: f.teams.home.id, name: f.teams.home.name, logo: f.teams.home.logo },
    away:   { id: f.teams.away.id, name: f.teams.away.name, logo: f.teams.away.logo },
    league: { id: f.league.id, name: f.league.name, logo: f.league.logo, country: f.league.country },
    score:  f.goals,
  }));

  return successResponse(res, { date: useDate, total: list.length, fixtures: list });
}));

// ── GET /api/admin/analytics/fixture-intel?fixture_id=12345
// Full match research: H2H, form, standings, stats, AI tip suggestion
router.get('/fixture-intel', asyncHandler(async (req, res) => {
  const { fixture_id } = req.query;
  if (!fixture_id) return errorResponse(res, 'fixture_id is required', 400);

  const data = await api.researchFixture(parseInt(fixture_id));
  return successResponse(res, data);
}));

module.exports = router;
