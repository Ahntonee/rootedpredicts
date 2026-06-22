// services/apiFootball.js
// Rooted Predictions — API-Football integration service
'use strict';

const axios    = require('axios');
const slugify  = require('slugify');
const db       = require('../config/db');
const counter  = require('./apiCounter');
const { getContinentFromCountry, generatePredictionSlug } = require('../utils/helpers');

const BASE_URL       = process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io';
const API_KEY        = process.env.API_FOOTBALL_KEY;
const CURRENT_SEASON = parseInt(process.env.API_FOOTBALL_SEASON) || 2024;

const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { 'x-apisports-key': API_KEY, 'Content-Type': 'application/json' },
  timeout: 30000,
});

let dailyRequestCount = 0;
let lastResetDate     = new Date().toDateString();

function checkAndResetDaily() {
  const today = new Date().toDateString();
  if (today !== lastResetDate) { dailyRequestCount = 0; lastResetDate = today; }
}

async function request(endpoint, params = {}) {
  checkAndResetDaily();
  if (!API_KEY) throw new Error('[API-Football] API_FOOTBALL_KEY not set in .env');
  if (dailyRequestCount >= 7400) throw new Error('[API-Football] Daily limit reached');
  try {
    dailyRequestCount++;
    counter.increment().catch(() => {}); // DB write — fire-and-forget, in-memory is the guard
    console.log(`[API-Football] #${dailyRequestCount} GET ${endpoint}`, params);
    const response = await apiClient.get(endpoint, { params });
    if (response.data.errors && Object.keys(response.data.errors).length > 0) {
      throw new Error(`API error: ${JSON.stringify(response.data.errors)}`);
    }
    return { data: response.data.response || [], results: response.data.results || 0 };
  } catch (error) {
    console.error(`[API-Football] Failed: ${endpoint}`, error.message);
    throw error;
  }
}

// ── Popular league IDs
const POPULAR_LEAGUE_IDS = [39, 140, 135, 78, 61, 2, 3, 1, 6, 253, 71, 323];
function isPopularLeague(id) { return POPULAR_LEAGUE_IDS.includes(Number(id)); }

// ── Continent mapping — canonical map lives in utils/helpers.js
const mapCountryToContinent = getContinentFromCountry;

// ── Sync leagues
async function syncLeagues() {
  console.log('[API-Football] Starting league sync...');
  const { data: leagues } = await request('/leagues', { season: CURRENT_SEASON });
  let synced = 0, skipped = 0;
  for (const item of leagues) {
    const league = item.league, country = item.country;
    if (!league || !league.id || !league.name) { skipped++; continue; }
    try {
      await db.query(
        `INSERT INTO leagues (api_league_id,name,country,continent,flag_url,logo_url,is_popular,season)
         VALUES (?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE name=VALUES(name),country=VALUES(country),continent=VALUES(continent),
           flag_url=VALUES(flag_url),logo_url=VALUES(logo_url),season=VALUES(season),updated_at=NOW()`,
        [league.id, league.name, country.name||'World', mapCountryToContinent(country.name||''),
         country.flag||null, league.logo||null, isPopularLeague(league.id)?1:0, CURRENT_SEASON]
      );
      synced++;
    } catch(e) { console.error(`League upsert failed ${league.id}:`, e.message); skipped++; }
  }
  console.log(`[API-Football] League sync: ${synced} synced, ${skipped} skipped`);
  return { synced, skipped, total: leagues.length };
}

// ── Sync teams for a league
async function syncTeams(leagueId, season = CURRENT_SEASON) {
  const { data: teams } = await request('/teams', { league: leagueId, season });
  const [leagueRows] = await db.query('SELECT id FROM leagues WHERE api_league_id=?', [leagueId]);
  const dbLeagueId = leagueRows.length ? leagueRows[0].id : null;
  let synced = 0;
  for (const item of teams) {
    const team = item.team;
    if (!team || !team.id) continue;
    try {
      await db.query(
        `INSERT INTO teams (api_team_id,name,logo_url,league_id,country)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE name=VALUES(name),logo_url=VALUES(logo_url),updated_at=NOW()`,
        [team.id, team.name, team.logo||null, dbLeagueId, team.country||null]
      );
      synced++;
    } catch(e) { console.error(`Team upsert failed ${team.id}:`, e.message); }
  }
  console.log(`[API-Football] Synced ${synced} teams for league ${leagueId}`);
  return synced;
}

// ── Sync fixtures for a date
async function syncFixtures(date, leagueId = null) {
  const params = { date, season: CURRENT_SEASON, timezone: 'UTC' };
  if (leagueId) params.league = leagueId;
  const { data: fixtures } = await request('/fixtures', params);
  console.log(`[API-Football] Fetched ${fixtures.length} fixtures for ${date}`);
  if (!fixtures.length) return { created: 0, skipped: 0, total: 0 };

  // ── 1. Batch-fetch all league DB ids in a single query
  const apiLeagueIds = [...new Set(fixtures.map(f => f.league?.id).filter(Boolean))];
  const lPlaceholders = apiLeagueIds.map(() => '?').join(',');
  const [leagueRows] = apiLeagueIds.length
    ? await db.query(`SELECT id, api_league_id FROM leagues WHERE api_league_id IN (${lPlaceholders})`, apiLeagueIds)
    : [[]];
  const leagueMap = new Map(leagueRows.map(r => [r.api_league_id, r.id]));

  // ── 2. Create any leagues not yet in the DB (rare after first sync)
  for (const { league } of fixtures) {
    if (!league?.id || leagueMap.has(league.id)) continue;
    try {
      const [ins] = await db.query(
        `INSERT IGNORE INTO leagues (api_league_id,name,country,continent,logo_url,season)
         VALUES (?,?,?,?,?,?)`,
        [league.id, league.name, league.country || 'World',
         mapCountryToContinent(league.country || ''), league.logo || null, CURRENT_SEASON]
      );
      if (ins.insertId) leagueMap.set(league.id, ins.insertId);
    } catch(e) { console.error(`League insert failed ${league.id}:`, e.message); }
  }

  // ── 3. Batch-check which fixture_ids already have predictions
  const allFixtureIds = fixtures.map(f => f.fixture?.id).filter(Boolean);
  const fPlaceholders = allFixtureIds.map(() => '?').join(',');
  const [existingRows] = allFixtureIds.length
    ? await db.query(`SELECT fixture_id FROM predictions WHERE fixture_id IN (${fPlaceholders})`, allFixtureIds)
    : [[]];
  const existingSet = new Set(existingRows.map(r => r.fixture_id));

  // ── 4. Filter to candidates: new, known league, upcoming/live
  const FINISHED = new Set(['FT','AET','PEN','CANC','ABD','WO','AWD']);
  const cutoff   = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const toInsert = fixtures.filter(({ fixture, league, teams }) => {
    if (!fixture || !league || !teams)           return false;
    if (existingSet.has(fixture.id))             return false;
    if (!leagueMap.has(league.id))               return false;
    if (FINISHED.has(fixture.status?.short))     return false;
    if (fixture.date && new Date(fixture.date) < cutoff) return false;
    return true;
  });

  let skipped = fixtures.length - toInsert.length;

  if (!toInsert.length) {
    console.log(`[API-Football] Fixtures for ${date}: 0 created, ${skipped} skipped`);
    return { created: 0, skipped, total: fixtures.length };
  }

  // ── 5. Batch-check slug conflicts
  const candidateSlugs = toInsert.map(({ fixture, league, teams }) => {
    const matchDate = fixture.date ? fixture.date.split('T')[0] : date;
    return generatePredictionSlug(league.name, teams.home.name, teams.away.name, matchDate);
  });
  const sPlaceholders = candidateSlugs.map(() => '?').join(',');
  const [slugRows] = await db.query(
    `SELECT slug FROM predictions WHERE slug IN (${sPlaceholders})`, candidateSlugs
  );
  const usedSlugs = new Set(slugRows.map(r => r.slug));

  // ── 6. Insert new fixtures
  let created = 0;
  for (let i = 0; i < toInsert.length; i++) {
    const { fixture, league, teams } = toInsert[i];
    let slug = candidateSlugs[i];
    if (usedSlugs.has(slug)) slug = `${slug}-${fixture.id}`;
    const mysqlDate = fixture.date
      ? fixture.date.replace('T', ' ').replace(/[Z+][^\s]*$/, '').slice(0, 19)
      : `${date} 00:00:00`;
    try {
      await db.query(
        `INSERT INTO predictions
           (fixture_id,league_id,home_team,away_team,home_team_logo,away_team_logo,
            match_date,tip,market,visibility,result,slug,published_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
        [fixture.id, leagueMap.get(league.id), teams.home.name, teams.away.name,
         teams.home.logo || null, teams.away.logo || null, mysqlDate,
         'TBD', '1X2', 'free', 'pending', slug]
      );
      created++;
    } catch(e) { console.error(`Fixture insert failed ${fixture.id}:`, e.message); skipped++; }
  }

  console.log(`[API-Football] Fixtures for ${date}: ${created} created, ${skipped} skipped`);
  return { created, skipped, total: fixtures.length };
}

// ── Sync results (update pending predictions after matches finish)
// NOTE: no season filter — youth/women/friendly leagues are catalogued
// under different seasons, and filtering by season silently drops their
// finished results so those predictions never get graded. Grading is by
// fixture_id, so pulling every FT match for the date is correct.
async function syncResults(date) {
  const { data: fixtures } = await request('/fixtures', {
    date, status: 'FT', timezone: 'UTC'
  });
  let updated = 0;
  for (const item of fixtures) {
    const { fixture, goals, teams } = item;
    if (!fixture || fixture.status.short !== 'FT') continue;
    const homeTeam = teams?.home?.name || '';
    const awayTeam = teams?.away?.name || '';
    const hg = goals ? goals.home : null;
    const ag = goals ? goals.away : null;

    const [preds] = await db.query(
      `SELECT id, tip, market FROM predictions
       WHERE result = 'pending'
         AND (fixture_id = ?
              OR (fixture_id IS NULL
                  AND DATE(match_date) = ?
                  AND home_team LIKE ? AND away_team LIKE ?))`,
      [fixture.id, date, `%${homeTeam.slice(0, 10)}%`, `%${awayTeam.slice(0, 10)}%`]
    );
    for (const pred of preds) {
      const result = evaluateTip(pred.tip, pred.market, goals, teams);
      if (result) {
        await db.query(
          `UPDATE predictions SET result=?, home_score=?, away_score=?, status_short='FT', updated_at=NOW()
           WHERE id=?`,
          [result, hg, ag, pred.id]
        );
        updated++;
      }
    }
  }
  console.log(`[API-Football] Results sync for ${date}: ${updated} updated`);
  return { updated };
}

// Status buckets shared by the score syncs
const FINISHED_STATUSES = ['FT', 'AET', 'PEN'];
const LIVE_STATUSES     = ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE'];

// ── Sync scores + status for every fixture on a date (live, finished, upcoming)
// Updates home_score/away_score/status_short/elapsed on matching predictions,
// and grades won/lost the moment a match finishes.
// Matches by fixture_id first; falls back to home_team+away_team+date for
// manually-created predictions that have no fixture_id.
async function syncScores(date) {
  const { data: fixtures } = await request('/fixtures', { date, timezone: 'UTC' });
  let updated = 0, graded = 0;
  for (const item of fixtures) {
    const { fixture, goals, teams } = item;
    if (!fixture) continue;
    const status  = fixture.status.short;
    const elapsed = fixture.status.elapsed || null;
    const hg = goals ? goals.home : null;
    const ag = goals ? goals.away : null;
    const homeTeam = teams?.home?.name || '';
    const awayTeam = teams?.away?.name || '';

    // Primary match: by fixture_id
    // Fallback: home_team + away_team + match date (for manually-entered predictions)
    const [preds] = await db.query(
      `SELECT id, tip, market, result FROM predictions
       WHERE fixture_id = ?
          OR (fixture_id IS NULL
              AND DATE(match_date) = ?
              AND home_team LIKE ? AND away_team LIKE ?)`,
      [fixture.id, date, `%${homeTeam.slice(0, 10)}%`, `%${awayTeam.slice(0, 10)}%`]
    );
    for (const pred of preds) {
      let result = pred.result;
      if (FINISHED_STATUSES.includes(status) && pred.result === 'pending') {
        const r = evaluateTip(pred.tip, pred.market, goals, teams);
        if (r) { result = r; graded++; }
      }
      await db.query(
        `UPDATE predictions SET home_score=?, away_score=?, status_short=?, elapsed=?, result=?, updated_at=NOW()
         WHERE id=?`,
        [hg, ag, status, elapsed, result, pred.id]
      );
      updated++;
    }
  }
  console.log(`[API-Football] Score sync for ${date}: ${updated} updated, ${graded} graded`);
  return { updated, graded, total: fixtures.length };
}

// ── Sync only in-play matches globally (1 API call) — for frequent live updates
// Also grades predictions the moment a match transitions to FT/AET/PEN so we
// don't have to wait for the 20-min syncScores cron to pick them up.
async function syncLive() {
  const { data: fixtures } = await request('/fixtures', { live: 'all' });
  let updated = 0, graded = 0;
  for (const item of fixtures) {
    const { fixture, goals, teams } = item;
    if (!fixture) continue;
    const status  = fixture.status.short;
    const elapsed = fixture.status.elapsed || null;
    const hg = goals ? goals.home : null;
    const ag = goals ? goals.away : null;

    const [preds] = await db.query(
      'SELECT id, tip, market, result FROM predictions WHERE fixture_id = ?', [fixture.id]
    );
    for (const pred of preds) {
      let result = pred.result;
      if (FINISHED_STATUSES.includes(status) && pred.result === 'pending') {
        const r = evaluateTip(pred.tip, pred.market, goals, teams);
        if (r) { result = r; graded++; }
      }
      await db.query(
        `UPDATE predictions SET home_score=?, away_score=?, status_short=?, elapsed=?, result=?, updated_at=NOW()
         WHERE id=?`,
        [hg, ag, status, elapsed, result, pred.id]
      );
      updated++;
    }
  }
  if (updated > 0 || graded > 0)
    console.log(`[API-Football] Live sync: ${updated} updated, ${graded} graded (${fixtures.length} live globally)`);
  return { updated, graded, live: fixtures.length };
}

// ── Evaluate tip outcome — handles all standard tip formats ───────────────────
function evaluateTip(tip, market, goals, teams) {
  const homeGoals = goals?.home ?? 0;
  const awayGoals = goals?.away ?? 0;
  const total     = homeGoals + awayGoals;
  const homeWon   = teams?.home?.winner === true;
  const awayWon   = teams?.away?.winner === true;
  const isDraw    = !homeWon && !awayWon;
  const t         = (tip || '').trim().toLowerCase();

  // ── Over/Under: regex captures any line (1.5, 2.5, 3.5, 4.5, 0.5…)
  const overM  = t.match(/over\s+(\d+(?:\.\d+)?)/);
  const underM = t.match(/under\s+(\d+(?:\.\d+)?)/);
  if (overM)  return total > parseFloat(overM[1])  ? 'won' : 'lost';
  if (underM) return total < parseFloat(underM[1]) ? 'won' : 'lost';

  // ── BTTS
  const bothScore = homeGoals > 0 && awayGoals > 0;
  if (t.includes('both teams not to score')) return bothScore ? 'lost' : 'won';
  if (t.includes('both teams to score'))     return bothScore ? 'won'  : 'lost';
  if (t === 'btts' || t === 'btts yes' || t === 'btts - yes') return bothScore ? 'won'  : 'lost';
  if (t === 'btts no' || t === 'btts - no')                   return bothScore ? 'lost' : 'won';

  // ── 1X2 short notation (exact match only — must come before keyword checks)
  if (t === '1')  return homeWon ? 'won' : 'lost';
  if (t === 'x')  return isDraw  ? 'won' : 'lost';
  if (t === '2')  return awayWon ? 'won' : 'lost';

  // ── Double chance
  if (t === '1x' || t.includes('home or draw')) return (homeWon || isDraw) ? 'won' : 'lost';
  if (t === '2x' || t.includes('away or draw')) return (awayWon || isDraw) ? 'won' : 'lost';
  if (t === '12' || t.includes('home or away')) return !isDraw             ? 'won' : 'lost';

  // ── 1X2 long form
  if (t.includes('home win') || t.includes('home victory') || t === 'home') return homeWon ? 'won' : 'lost';
  if (t.includes('away win') || t.includes('away victory') || t === 'away') return awayWon ? 'won' : 'lost';
  if (t.includes('draw'))                                                    return isDraw  ? 'won' : 'lost';

  return null;
}

// ── H2H, form, standings, stats
async function fetchH2H(team1Id, team2Id, last = 10) {
  // Paid plan: use the `last` parameter directly — only finished H2H meetings,
  // across all competitions, far lighter than pulling a whole season.
  const { data } = await request('/fixtures/headtohead', {
    h2h:    `${team1Id}-${team2Id}`,
    last,
  });
  // API returns oldest→newest; reverse so index 0 is the most recent meeting.
  return data.slice().reverse().slice(0, last);
}
async function fetchTeamForm(teamId, last = 5) {
  // Paid plan: `last` returns the team's most recent FINISHED fixtures across
  // all competitions — accurate recent form without a full-season download.
  const { data } = await request('/fixtures', { team: teamId, last });
  // Sort descending by date so slice(0, last) gives the most recent first.
  data.sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));
  return data.slice(0, last);
}
async function fetchStandings(leagueId, season = CURRENT_SEASON) {
  const { data } = await request('/standings', { league: leagueId, season });
  return data;
}
async function fetchTeamStats(teamId, leagueId, season = CURRENT_SEASON) {
  const { data } = await request('/teams/statistics', { team: teamId, league: leagueId, season });
  return data;
}

// ── Real bookmaker odds for a fixture (API-Football /odds) ────────────────────
// Returns { '1X2':{home,draw,away}, 'BTTS':{yes,no}, 'Over/Under':{over,under} }
// or null when no bookmaker has published odds (common for minor/youth leagues).
async function fetchFixtureOdds(fixtureId) {
  const { data } = await request('/odds', { fixture: fixtureId });
  if (!data.length || !data[0].bookmakers || !data[0].bookmakers.length) return null;
  const books = data[0].bookmakers;
  // Prefer a well-known book for consistency, else the first available
  const bm = books.find(b => /bet365|bwin|william hill|1xbet|pinnacle/i.test(b.name)) || books[0];
  const bets = bm.bets || [];
  const getBet = name => bets.find(b => (b.name || '').toLowerCase() === name.toLowerCase());
  const pick = (bet, label) => {
    if (!bet) return null;
    const o = bet.values.find(v => (v.value || '').toLowerCase() === label.toLowerCase());
    return o ? parseFloat(o.odd) : null;
  };
  const out = {};
  const mw = getBet('Match Winner');
  if (mw) out['1X2'] = { home: pick(mw,'home'), draw: pick(mw,'draw'), away: pick(mw,'away') };
  const btts = getBet('Both Teams Score');
  if (btts) out['BTTS'] = { yes: pick(btts,'yes'), no: pick(btts,'no') };
  const ou = getBet('Goals Over/Under');
  if (ou) out['Over/Under'] = { over: pick(ou,'over 2.5'), under: pick(ou,'under 2.5') };
  return Object.keys(out).length ? out : null;
}

// Pick the single primary odd that matches a tip, from a market's odds object
function oddsForTip(tip, market, marketOdds) {
  if (!marketOdds) return null;
  const t = (tip || '').toLowerCase();
  if (market === '1X2' || market === 'Draw No Bet') {
    if (t.includes('home') || t === '1') return marketOdds.home;
    if (t.includes('away') || t === '2') return marketOdds.away;
    if (t.includes('draw') || t === 'x') return marketOdds.draw;
  }
  if (market === 'BTTS')       return t.includes('no') ? marketOdds.no : marketOdds.yes;
  if (market === 'Over/Under') return t.includes('under') ? marketOdds.under : marketOdds.over;
  return null;
}
function calculateFormString(fixtures, teamId) {
  return fixtures.slice(0, 5).map(f => {
    const isHome = f.teams.home.id === teamId;
    const winner = isHome ? f.teams.home.winner : f.teams.away.winner;
    return winner === true ? 'W' : winner === false ? 'L' : 'D';
  }).join('');
}

// ── Poisson distribution helpers ──────────────────────────────────────────────
function poissonPMF(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return Math.max(0, p);
}

/**
 * Compute goal-market probabilities using a joint Poisson model.
 * Home goals ~ Poisson(lambda_h), Away goals ~ Poisson(lambda_a), independent.
 * Returns: { home, draw, away, over05, over15, over25, over35, under25, under15, btts }
 */
function goalProbabilities(lambda_h, lambda_a, maxG = 10) {
  const ph = Array.from({ length: maxG + 1 }, (_, k) => poissonPMF(lambda_h, k));
  const pa = Array.from({ length: maxG + 1 }, (_, k) => poissonPMF(lambda_a, k));
  let pHome = 0, pDraw = 0, pAway = 0;
  const pTotal = new Array(maxG * 2 + 2).fill(0);
  for (let h = 0; h <= maxG; h++) {
    for (let a = 0; a <= maxG; a++) {
      const p = ph[h] * pa[a];
      pTotal[h + a] += p;
      if (h > a) pHome += p; else if (h === a) pDraw += p; else pAway += p;
    }
  }
  return {
    home:    pHome,
    draw:    pDraw,
    away:    pAway,
    over05:  1 - pTotal[0],
    over15:  1 - pTotal[0] - pTotal[1],
    over25:  1 - pTotal[0] - pTotal[1] - pTotal[2],
    over35:  1 - pTotal[0] - pTotal[1] - pTotal[2] - pTotal[3],
    under25: pTotal[0] + pTotal[1] + pTotal[2],
    under15: pTotal[0] + pTotal[1],
    btts:    (1 - ph[0]) * (1 - pa[0]),  // P(home≥1) × P(away≥1)
  };
}

// ── Form scorer: exponentially weighted W/D/L string ──────────────────────────
function scoreForm(formStr) {
  if (!formStr) return 0.5;
  const chars = formStr.toUpperCase().replace(/[^WDL]/g, '').slice(0, 5).split('');
  if (!chars.length) return 0.5;
  const weights = [1.5, 1.2, 1.0, 0.8, 0.5];
  let s = 0, t = 0;
  chars.forEach((c, i) => { const w = weights[i] || 0.5; s += w * (c === 'W' ? 1 : c === 'D' ? 0.4 : 0); t += w; });
  return t > 0 ? s / t : 0.5;
}

// ── Generate a tip suggestion using Poisson model + form + H2H ────────────────
/**
 * Returns the highest-confidence tip from multiple signals:
 *   1. Poisson model (uses home/away venue stats)
 *   2. Form-based 1X2 signal with recency-weighted H2H
 *
 * @param {string} homeForm      Overall home-team form string (e.g. "WWDLW")
 * @param {string} awayForm      Overall away-team form string
 * @param {Array}  h2hData       Raw H2H fixture array (newest first)
 * @param {object} homeStats     API /teams/statistics for home team
 * @param {object} awayStats     API /teams/statistics for away team
 * @param {string} homeFormVenue Home team's form specifically in HOME games
 * @param {string} awayFormVenue Away team's form specifically in AWAY games
 */
function generateTipSuggestion(homeForm, awayForm, h2hData, homeStats, awayStats,
                                homeFormVenue, awayFormVenue) {
  const candidates = [];

  // ── 1. Poisson model (requires team stats) ─────────────────────────────────
  if (homeStats && awayStats) {
    // Use venue-specific averages when available (home attack at home, away attack away)
    const homeAtkH = parseFloat(homeStats.goals?.for?.average?.home  || homeStats.goals?.for?.average?.total)  || 0;
    const homeDefH = parseFloat(homeStats.goals?.against?.average?.home || homeStats.goals?.against?.average?.total) || 0;
    const awayAtkA = parseFloat(awayStats.goals?.for?.average?.away  || awayStats.goals?.for?.average?.total)  || 0;
    const awayDefA = parseFloat(awayStats.goals?.against?.average?.away || awayStats.goals?.against?.average?.total) || 0;

    if (homeAtkH > 0 && awayAtkA > 0) {
      // λ_h = blend of home team's home scoring and away team's away conceding
      const lambda_h = Math.max((homeAtkH + awayDefA) / 2, 0.1);
      const lambda_a = Math.max((awayAtkA + homeDefH) / 2, 0.1);
      const probs    = goalProbabilities(lambda_h, lambda_a);
      const lambdaStr = `λ=${(lambda_h + lambda_a).toFixed(2)}`;

      if (probs.over35 >= 0.45)
        candidates.push({ tip: 'Over 3.5',  market: 'Over/Under', conf: probs.over35,
          reason: `Poisson: P(>3.5g)=${pct(probs.over35)}% (${lambdaStr})` });
      if (probs.over25 >= 0.55)
        candidates.push({ tip: 'Over 2.5',  market: 'Over/Under', conf: probs.over25,
          reason: `Poisson: P(>2.5g)=${pct(probs.over25)}% (${lambdaStr})` });
      if (probs.over15 >= 0.72)
        candidates.push({ tip: 'Over 1.5',  market: 'Over/Under', conf: probs.over15,
          reason: `Poisson: P(>1.5g)=${pct(probs.over15)}% (${lambdaStr})` });
      if (probs.under25 >= 0.58)
        candidates.push({ tip: 'Under 2.5', market: 'Over/Under', conf: probs.under25,
          reason: `Poisson: P(<2.5g)=${pct(probs.under25)}% (${lambdaStr})` });
      if (probs.btts >= 0.60)
        candidates.push({ tip: 'BTTS - Yes', market: 'BTTS', conf: probs.btts,
          reason: `Poisson: P(BTTS)=${pct(probs.btts)}% (${lambdaStr})` });

      // Poisson 1X2
      if (probs.home >= 0.48)
        candidates.push({ tip: 'Home Win',  market: '1X2', conf: probs.home,
          reason: `Poisson: P(Home)=${pct(probs.home)}% (${lambdaStr})` });
      else if (probs.away >= 0.42)
        candidates.push({ tip: 'Away Win',  market: '1X2', conf: probs.away,
          reason: `Poisson: P(Away)=${pct(probs.away)}% (${lambdaStr})` });
    }
  }

  // ── 2. Form + recency-weighted H2H signal ──────────────────────────────────
  // Prefer venue-specific form if available (home team at home / away team away)
  const hFS = scoreForm(homeFormVenue || homeForm);
  const aFS = scoreForm(awayFormVenue || awayForm);

  let h2hAdv = 0;
  if (h2hData && h2hData.length) {
    let hwW = 0, awW = 0, tot = 0;
    h2hData.slice(0, 10).forEach((f, i) => {
      const w = Math.pow(0.80, i);  // exponential decay — recent matches worth more
      if (f.teams.home.winner === true)      hwW += w;
      else if (f.teams.away.winner === true) awW += w;
      tot += w;
    });
    h2hAdv = tot > 0 ? (hwW - awW) / tot : 0;
  }

  const formDiff = hFS * 0.6 - aFS * 0.6 + h2hAdv * 0.4;
  const formConf = 0.42 + Math.min(Math.abs(formDiff) * 0.55, 0.28);

  if (formDiff > 0.12)
    candidates.push({ tip: 'Home Win', market: '1X2', conf: formConf,
      reason: `Form: home ${pct(hFS)}% vs away ${pct(aFS)}% + H2H` });
  else if (formDiff < -0.12)
    candidates.push({ tip: 'Away Win', market: '1X2', conf: formConf,
      reason: `Form: away ${pct(aFS)}% vs home ${pct(hFS)}% + H2H` });
  else
    candidates.push({ tip: 'Draw', market: '1X2', conf: 0.35,
      reason: `Evenly matched: home ${pct(hFS)}% away ${pct(aFS)}%` });

  // Return highest-confidence candidate
  candidates.sort((a, b) => b.conf - a.conf);
  const best = candidates[0] || { tip: 'Home Win', market: '1X2', conf: 0.45, reason: 'Fallback' };
  return { tip: best.tip, market: best.market, reason: best.reason };
}

function pct(v) { return Math.round((v || 0) * 100); }

// ── Research a single fixture — returns enriched data for admin display ────────
async function researchFixture(fixtureId) {
  // Get the prediction from DB to find team API IDs
  const fixtureInfo = await request('/fixtures', { id: fixtureId });
  if (!fixtureInfo.data.length) throw new Error('Fixture not found in API');

  const fix      = fixtureInfo.data[0];
  const homeId   = fix.teams.home.id;
  const awayId   = fix.teams.away.id;
  const leagueId = fix.league.id;

  // Fetch 15 recent fixtures per team sequentially to avoid hitting the
  // API-Football rate limit (300 req/min) when multiple fixtures are processed
  // at once or when PM2 cluster workers run simultaneously.
  const _delay = ms => new Promise(r => setTimeout(r, ms));
  const homeFormRaw  = await fetchTeamForm(homeId, 15).catch(() => []);
  await _delay(250);
  const awayFormRaw  = await fetchTeamForm(awayId, 15).catch(() => []);
  await _delay(250);
  const h2hRaw       = await fetchH2H(homeId, awayId, 10).catch(() => []);
  await _delay(250);
  const homeStatsRaw = await fetchTeamStats(homeId, leagueId).catch(() => null);
  await _delay(250);
  const awayStatsRaw = await fetchTeamStats(awayId, leagueId).catch(() => null);
  await _delay(250);
  const standingsRaw = await fetchStandings(leagueId).catch(() => []);
  await _delay(250);
  const oddsRaw      = await fetchFixtureOdds(fixtureId).catch(() => null);

  const homeForm = calculateFormString(homeFormRaw, homeId);
  const awayForm = calculateFormString(awayFormRaw, awayId);

  // Venue-specific form: home team AT HOME, away team AWAY
  const homeAtHomeFixtures = homeFormRaw.filter(f => f.teams.home.id === homeId);
  const awayAtAwayFixtures = awayFormRaw.filter(f => f.teams.away.id === awayId);
  const homeFormVenue = calculateFormString(homeAtHomeFixtures, homeId);
  const awayFormVenue = calculateFormString(awayAtAwayFixtures, awayId);

  // H2H summary — "recent|older" format for recency-weighted confidence scoring
  // Counts from each team's perspective as HOME/AWAY in those H2H fixtures
  function h2hCounts(fixtures) {
    let hw = 0, aw = 0, dw = 0;
    for (const f of fixtures) {
      const hWinner = f.teams.home.winner === true;
      const aWinner = f.teams.away.winner === true;
      if (hWinner) hw++;
      else if (aWinner) aw++;
      else dw++;
    }
    return { hw, aw, dw };
  }
  const recentH2H = h2hRaw.slice(0, 5);
  const olderH2H  = h2hRaw.slice(5, 10);
  let h2hSummary  = null;
  if (h2hRaw.length) {
    const r = h2hCounts(recentH2H);
    if (olderH2H.length) {
      const o = h2hCounts(olderH2H);
      h2hSummary = `H${r.hw}-A${r.aw}-D${r.dw}|H${o.hw}-A${o.aw}-D${o.dw}`;
    } else {
      h2hSummary = `H${r.hw}-A${r.aw}-D${r.dw}`;
    }
  }

  // Recent results detail
  const homeRecent = homeFormRaw.slice(0, 5).map(f => ({
    date:     f.fixture.date?.split('T')[0],
    home:     f.teams.home.name,
    away:     f.teams.away.name,
    score:    `${f.goals.home}-${f.goals.away}`,
    result:   f.teams.home.id === homeId ? (f.teams.home.winner ? 'W' : f.teams.away.winner ? 'L' : 'D') : (f.teams.away.winner ? 'W' : f.teams.home.winner ? 'L' : 'D'),
  }));
  const awayRecent = awayFormRaw.slice(0, 5).map(f => ({
    date:     f.fixture.date?.split('T')[0],
    home:     f.teams.home.name,
    away:     f.teams.away.name,
    score:    `${f.goals.home}-${f.goals.away}`,
    result:   f.teams.home.id === awayId ? (f.teams.home.winner ? 'W' : f.teams.away.winner ? 'L' : 'D') : (f.teams.away.winner ? 'W' : f.teams.home.winner ? 'L' : 'D'),
  }));

  // Standings position
  let homeStanding = null, awayStanding = null;
  if (standingsRaw.length && standingsRaw[0]?.league?.standings) {
    const table = standingsRaw[0].league.standings.flat();
    homeStanding = table.find(t => t.team.id === homeId);
    awayStanding = table.find(t => t.team.id === awayId);
  }

  const suggestion = generateTipSuggestion(
    homeForm, awayForm, h2hRaw, homeStatsRaw, awayStatsRaw,
    homeFormVenue, awayFormVenue
  );

  // Compute Poisson probabilities for display in admin UI
  let poissonProbs = null;
  if (homeStatsRaw && awayStatsRaw) {
    const homeAtkH = parseFloat(homeStatsRaw.goals?.for?.average?.home  || homeStatsRaw.goals?.for?.average?.total)  || 0;
    const homeDefH = parseFloat(homeStatsRaw.goals?.against?.average?.home || homeStatsRaw.goals?.against?.average?.total) || 0;
    const awayAtkA = parseFloat(awayStatsRaw.goals?.for?.average?.away  || awayStatsRaw.goals?.for?.average?.total)  || 0;
    const awayDefA = parseFloat(awayStatsRaw.goals?.against?.average?.away || awayStatsRaw.goals?.against?.average?.total) || 0;
    if (homeAtkH > 0 && awayAtkA > 0) {
      const lambda_h = Math.max((homeAtkH + awayDefA) / 2, 0.1);
      const lambda_a = Math.max((awayAtkA + homeDefH) / 2, 0.1);
      const p = goalProbabilities(lambda_h, lambda_a);
      poissonProbs = {
        lambda_home: +lambda_h.toFixed(2), lambda_away: +lambda_a.toFixed(2),
        over15: pct(p.over15), over25: pct(p.over25), over35: pct(p.over35),
        under25: pct(p.under25), btts: pct(p.btts),
        home_win: pct(p.home), draw: pct(p.draw), away_win: pct(p.away),
      };
    }
  }

  return {
    fixture: {
      id:      fix.fixture.id,
      date:    fix.fixture.date,
      home:    { id: homeId, name: fix.teams.home.name, logo: fix.teams.home.logo },
      away:    { id: awayId, name: fix.teams.away.name, logo: fix.teams.away.logo },
      league:  { id: leagueId, name: fix.league.name, logo: fix.league.logo },
    },
    home_form:       homeForm,
    away_form:       awayForm,
    home_form_venue: homeFormVenue || null,
    away_form_venue: awayFormVenue || null,
    home_recent:  homeRecent,
    away_recent:  awayRecent,
    h2h_summary:  h2hSummary,
    h2h_recent:   h2hRaw.slice(0, 5).map(f => ({
      date:  f.fixture.date?.split('T')[0],
      home:  f.teams.home.name,
      away:  f.teams.away.name,
      score: `${f.goals.home}-${f.goals.away}`,
    })),
    home_standing: homeStanding ? { rank: homeStanding.rank, points: homeStanding.points, played: homeStanding.all.played, gd: homeStanding.goalsDiff } : null,
    away_standing: awayStanding ? { rank: awayStanding.rank, points: awayStanding.points, played: awayStanding.all.played, gd: awayStanding.goalsDiff } : null,
    home_stats: homeStatsRaw ? {
      goals_for_avg:       homeStatsRaw.goals?.for?.average?.total,
      goals_for_avg_home:  homeStatsRaw.goals?.for?.average?.home,
      goals_against_avg:   homeStatsRaw.goals?.against?.average?.total,
      goals_against_home:  homeStatsRaw.goals?.against?.average?.home,
      wins:                homeStatsRaw.fixtures?.wins?.total,
      draws:               homeStatsRaw.fixtures?.draws?.total,
      losses:              homeStatsRaw.fixtures?.loses?.total,
    } : null,
    away_stats: awayStatsRaw ? {
      goals_for_avg:       awayStatsRaw.goals?.for?.average?.total,
      goals_for_avg_away:  awayStatsRaw.goals?.for?.average?.away,
      goals_against_avg:   awayStatsRaw.goals?.against?.average?.total,
      goals_against_away:  awayStatsRaw.goals?.against?.average?.away,
      wins:                awayStatsRaw.fixtures?.wins?.total,
      draws:               awayStatsRaw.fixtures?.draws?.total,
      losses:              awayStatsRaw.fixtures?.loses?.total,
    } : null,
    poisson:    poissonProbs,
    odds:       oddsRaw,
    suggestion,
  };
}

// ── Auto-predict: enrich pending TBD predictions with form/H2H and generate tips
async function autoPredictFixtures(db, options = {}) {
  const limit       = options.limit || 20;
  const minConf     = options.minConfidence || 65;
  const autoPublish = options.autoPublish !== false;
  const forceCategory = options.forceCategory || null;

  // Scope:
  //   options.date        → only fixtures on this date (past OR future) — for backtests/track records
  //   options.includePast → drop the future-only guard entirely
  //   default             → upcoming fixtures only (production behaviour)
  const args = [];
  let dateClause;
  if (options.date) {
    dateClause = 'AND DATE(p.match_date) = ?';
    args.push(options.date);
  } else if (options.includePast) {
    dateClause = '';
  } else {
    // Default: only today and tomorrow — avoids publishing weeks-ahead fixtures
    dateClause = 'AND DATE(p.match_date) BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 1 DAY)';
  }
  args.push(limit);

  const [rows] = await db.query(
    `SELECT p.id, p.fixture_id, p.home_team, p.away_team, p.league_id,
            l.api_league_id
     FROM predictions p
     LEFT JOIN leagues l ON l.id = p.league_id
     WHERE p.tip = 'TBD' AND p.result = 'pending'
       ${dateClause}
     ORDER BY p.match_date ASC
     LIMIT ?`,
    args
  );

  const confidence = require('./confidence');
  let enriched = 0, skipped = 0, errors = 0;
  const log = [];

  for (const row of rows) {
    if (!row.fixture_id) { skipped++; continue; }
    try {
      await new Promise(r => setTimeout(r, 500)); // rate limit spacing

      const data = await researchFixture(row.fixture_id);

      const suggestion       = data.suggestion;
      const h2hSummary       = data.h2h_summary;
      const homeForm         = data.home_form;
      const awayForm         = data.away_form;
      const homeFormVenue    = data.home_form_venue;
      const awayFormVenue    = data.away_form_venue;

      // Selectivity: only proceed if we have real data to score with
      const hasData = homeForm || awayForm || h2hSummary;
      if (!hasData) { skipped++; continue; }

      // Score with enriched data including venue-specific form
      const { score: confScore } = confidence.score({
        tip:              suggestion.tip,
        market:           suggestion.market,
        odds:             null,
        home_form:        homeForm,
        away_form:        awayForm,
        home_form_venue:  homeFormVenue,
        away_form_venue:  awayFormVenue,
        h2h_summary:      h2hSummary,
        league_id:        row.league_id,
      });

      // Only publish if confidence ≥ minConf (selectivity filter)
      const shouldPublish = autoPublish && confScore >= minConf;

      // Real bookmaker odds for the tip's market (null when unavailable)
      const marketOdds = data.odds ? data.odds[suggestion.market] : null;
      const oddsJson   = marketOdds ? JSON.stringify(marketOdds) : null;
      const primaryOdd = oddsForTip(suggestion.tip, suggestion.market, marketOdds);

      // Derive category from tip — or use admin-specified forceCategory
      const TIP_TO_CATEGORY = {
        'Over 3.5':   '3.5 Goals',
        'Under 3.5':  '3.5 Goals',
        'Over 2.5':   '2.5 Goals',
        'Under 2.5':  '2.5 Goals',
        'Over 1.5':   '1.5 Goals',
        'Under 1.5':  '1.5 Goals',
        'BTTS - Yes': 'BTTS',
        'BTTS - No':  'BTTS',
        'Home Win':   'Home Win',
        'Away Win':   'Away Win',
        'Draw':       'Free Pick',
      };
      const derivedCategory = forceCategory || TIP_TO_CATEGORY[suggestion.tip] || 'Free Pick';

      await db.query(
        `UPDATE predictions SET
           tip              = ?,
           market           = ?,
           category         = ?,
           odds             = COALESCE(?, odds),
           odds_data        = COALESCE(?, odds_data),
           home_form        = ?,
           away_form        = ?,
           h2h_summary      = ?,
           confidence_score = ?,
           analysis         = ?,
           published_at     = COALESCE(?, published_at),
           updated_at       = NOW()
         WHERE id = ?`,
        [
          suggestion.tip,
          suggestion.market,
          derivedCategory,
          primaryOdd,
          oddsJson,
          homeForm || null,
          awayForm || null,
          h2hSummary || null,
          confScore,
          suggestion.reason || null,
          shouldPublish ? new Date() : null,
          row.id,
        ]
      );

      log.push({ id: row.id, match: `${row.home_team} vs ${row.away_team}`, tip: suggestion.tip, confidence: confScore, published: shouldPublish });
      enriched++;
    } catch(e) {
      console.error(`[AUTO-PREDICT] Failed fixture ${row.fixture_id}:`, e.message);
      errors++;
      log.push({ id: row.id, match: `${row.home_team} vs ${row.away_team}`, error: e.message });
    }
  }

  console.log(`[AUTO-PREDICT] Done: ${enriched} enriched, ${skipped} skipped, ${errors} errors`);
  return { enriched, skipped, errors, total: rows.length, log };
}

function getRequestCount()   { return dailyRequestCount; }
function getRemainingCount() { checkAndResetDaily(); return 7400 - dailyRequestCount; }

// ── Fetch finished fixtures for a league (for rate/metric calculations)
async function fetchLeagueFixtures(leagueId, season = CURRENT_SEASON, opts = {}) {
  const params = { league: leagueId, season, ...opts };
  return request('/fixtures', params);
}

// ── Fetch fixtures by date (optionally filtered by league)
// When a league is specified API-Football requires season; we derive it
// from the year portion of the date (correct for single-year tournaments
// like the World Cup, and for club seasons in their primary half-year).
async function fetchFixturesByDate(date, leagueId = null, season = null) {
  const params = { date, timezone: 'UTC' };
  if (leagueId) {
    params.league = leagueId;
    params.season = season || parseInt(date.split('-')[0]);
  }
  return request('/fixtures', params);
}

// ── Bulk-sync ALL fixtures for a league + season into the predictions table
// Useful for pre-loading tournaments (e.g. World Cup 2026) so admins can
// browse and create predictions without repeated live API calls.
async function syncLeagueSeasonFixtures(leagueId, season) {
  console.log(`[API-Football] Syncing all fixtures: league=${leagueId} season=${season}`);
  const { data: fixtures } = await request('/fixtures', { league: leagueId, season, timezone: 'UTC' });
  console.log(`[API-Football] Fetched ${fixtures.length} fixtures`);
  if (!fixtures.length) return { created: 0, updated: 0, skipped: 0, total: 0 };

  // ── 1. Ensure the league row exists
  const [lRows] = await db.query('SELECT id FROM leagues WHERE api_league_id=?', [leagueId]);
  let dbLeagueId = lRows[0]?.id || null;
  if (!dbLeagueId) {
    const sample = fixtures.find(f => f.league?.id)?.league;
    if (sample) {
      const [ins] = await db.query(
        `INSERT IGNORE INTO leagues (api_league_id,name,country,continent,logo_url,season)
         VALUES (?,?,?,?,?,?)`,
        [leagueId, sample.name, sample.country || 'World',
         mapCountryToContinent(sample.country || ''), sample.logo || null, season]
      );
      dbLeagueId = ins.insertId || null;
    }
    if (!dbLeagueId) {
      console.error(`[API-Football] Cannot resolve dbLeagueId for league ${leagueId} — aborting`);
      return { created: 0, updated: 0, skipped: fixtures.length, total: fixtures.length };
    }
  }

  // ── 2. Batch-check which fixture_ids already have predictions
  const allFixtureIds = fixtures.map(f => f.fixture?.id).filter(Boolean);
  const fPlaceholders = allFixtureIds.map(() => '?').join(',');
  const [existingRows] = allFixtureIds.length
    ? await db.query(`SELECT fixture_id FROM predictions WHERE fixture_id IN (${fPlaceholders})`, allFixtureIds)
    : [[]];
  const existingMap = new Map(existingRows.map(r => [r.fixture_id, true]));

  let created = 0, updated = 0, skipped = 0;
  const FINISHED = new Set(['FT','AET','PEN','CANC','ABD','WO','AWD']);
  const cutoff   = new Date(Date.now() - 2 * 60 * 60 * 1000);

  // ── 3. Collect new (not-yet-stored) fixtures for slug batch-check
  const toUpdate = [], toInsert = [];
  for (const item of fixtures) {
    const { fixture, league, teams, goals } = item;
    if (!fixture || !league || !teams) { skipped++; continue; }
    if (existingMap.has(fixture.id)) {
      toUpdate.push({ fixture, goals });
    } else {
      if (FINISHED.has(fixture.status?.short) || (fixture.date && new Date(fixture.date) < cutoff)) {
        skipped++;
      } else {
        toInsert.push(item);
      }
    }
  }

  // ── 4. Batch-update finished scores for already-stored fixtures
  for (const { fixture, goals } of toUpdate) {
    const status = fixture.status?.short;
    if (['FT','AET','PEN'].includes(status) && goals) {
      await db.query(
        `UPDATE predictions SET home_score=?,away_score=?,status_short=? WHERE fixture_id=?`,
        [goals.home ?? null, goals.away ?? null, status, fixture.id]
      );
      updated++;
    } else {
      skipped++;
    }
  }

  if (!toInsert.length) {
    console.log(`[API-Football] Sync done: ${created} created, ${updated} updated, ${skipped} skipped`);
    return { created, updated, skipped, total: fixtures.length };
  }

  // ── 5. Batch-check slug conflicts for new inserts
  const candidateSlugs = toInsert.map(({ fixture, league, teams }) => {
    const matchDate = fixture.date?.split('T')[0] || '';
    return generatePredictionSlug(league.name, teams.home.name, teams.away.name, matchDate);
  });
  const sPlaceholders = candidateSlugs.map(() => '?').join(',');
  const [slugRows] = await db.query(
    `SELECT slug FROM predictions WHERE slug IN (${sPlaceholders})`, candidateSlugs
  );
  const usedSlugs = new Set(slugRows.map(r => r.slug));

  // ── 6. Insert new stubs
  for (let i = 0; i < toInsert.length; i++) {
    const { fixture, teams } = toInsert[i];
    let slug = candidateSlugs[i];
    if (usedSlugs.has(slug)) slug = `${slug}-${fixture.id}`;
    const mysqlDate = fixture.date
      ? fixture.date.replace('T', ' ').replace(/[Z+][^\s]*$/, '').slice(0, 19)
      : (fixture.date?.split('T')[0] || '') + ' 00:00:00';
    try {
      await db.query(
        `INSERT INTO predictions
           (fixture_id,league_id,home_team,away_team,home_team_logo,away_team_logo,
            match_date,tip,market,visibility,result,slug,published_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
        [fixture.id, dbLeagueId, teams.home.name, teams.away.name,
         teams.home.logo || null, teams.away.logo || null, mysqlDate,
         'TBD', '1X2', 'free', 'pending', slug]
      );
      created++;
    } catch(e) { console.error(`Fixture insert failed ${fixture.id}:`, e.message); skipped++; }
  }

  console.log(`[API-Football] Sync done: ${created} created, ${updated} updated, ${skipped} skipped`);
  return { created, updated, skipped, total: fixtures.length };
}

module.exports = {
  syncLeagues, syncTeams, syncFixtures, syncLeagueSeasonFixtures, syncResults, syncScores, syncLive,
  FINISHED_STATUSES, LIVE_STATUSES,
  fetchH2H, fetchTeamForm, fetchStandings, fetchTeamStats,
  fetchLeagueFixtures, fetchFixturesByDate,
  calculateFormString, evaluateTip, mapCountryToContinent,
  isPopularLeague, getRequestCount, getRemainingCount, CURRENT_SEASON,
  researchFixture, autoPredictFixtures,
  fetchFixtureOdds, oddsForTip,
  goalProbabilities, poissonPMF, generateTipSuggestion, scoreForm,
};
