// services/apiFootball.js
// AfroPredict — API-Football integration service
'use strict';

const axios = require('axios');
const db    = require('../config/db');

const BASE_URL       = process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io';
const API_KEY        = process.env.API_FOOTBALL_KEY;
const CURRENT_SEASON = parseInt(process.env.API_FOOTBALL_SEASON) || 2024;

const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { 'x-apisports-key': API_KEY, 'Content-Type': 'application/json' },
  timeout: 20000,
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

// ── Continent mapping
const CONTINENT_MAP = {
  England:'Europe',Scotland:'Europe',Wales:'Europe','Northern Ireland':'Europe',
  Spain:'Europe',Germany:'Europe',France:'Europe',Italy:'Europe',Portugal:'Europe',
  Netherlands:'Europe',Belgium:'Europe',Turkey:'Europe',Russia:'Europe',Greece:'Europe',
  Switzerland:'Europe',Austria:'Europe',Poland:'Europe',Ukraine:'Europe',Sweden:'Europe',
  Norway:'Europe',Denmark:'Europe','Czech Republic':'Europe',Croatia:'Europe',Serbia:'Europe',
  Romania:'Europe',Hungary:'Europe',Finland:'Europe',Ireland:'Europe',
  Nigeria:'Africa',Ghana:'Africa',Kenya:'Africa','South Africa':'Africa',Egypt:'Africa',
  Morocco:'Africa',Algeria:'Africa',Tunisia:'Africa',Senegal:'Africa',Cameroon:'Africa',
  'Ivory Coast':'Africa',Ethiopia:'Africa',Tanzania:'Africa',Uganda:'Africa',Zimbabwe:'Africa',
  Zambia:'Africa',Angola:'Africa',Mozambique:'Africa',Sudan:'Africa',
  India:'Asia',China:'Asia',Japan:'Asia','South Korea':'Asia',Indonesia:'Asia',
  Philippines:'Asia',Thailand:'Asia',Malaysia:'Asia','Saudi Arabia':'Asia',UAE:'Asia',
  Qatar:'Asia',Iran:'Asia',Iraq:'Asia',Israel:'Asia',Vietnam:'Asia',Pakistan:'Asia',
  Bangladesh:'Asia',Singapore:'Asia','Hong Kong':'Asia',Jordan:'Asia',Kuwait:'Asia',
  USA:'Americas',Brazil:'Americas',Mexico:'Americas',Argentina:'Americas',Colombia:'Americas',
  Chile:'Americas',Peru:'Americas',Uruguay:'Americas',Venezuela:'Americas',Ecuador:'Americas',
  Bolivia:'Americas',Paraguay:'Americas',Canada:'Americas','Costa Rica':'Americas',
  Honduras:'Americas',Guatemala:'Americas',Panama:'Americas',Jamaica:'Americas',
  Australia:'Oceania','New Zealand':'Oceania',World:'World',
};
function mapCountryToContinent(country) { return CONTINENT_MAP[country] || 'World'; }

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
  let created = 0, skipped = 0;
  const slugify = require('slugify');

  for (const item of fixtures) {
    const { fixture, league, teams } = item;
    if (!fixture || !league || !teams) { skipped++; continue; }

    // Find or create league
    const [lRows] = await db.query('SELECT id FROM leagues WHERE api_league_id=?', [league.id]);
    let dbLeagueId;
    if (lRows.length) {
      dbLeagueId = lRows[0].id;
    } else {
      const [ins] = await db.query(
        `INSERT IGNORE INTO leagues (api_league_id,name,country,continent,logo_url,season)
         VALUES (?,?,?,?,?,?)`,
        [league.id, league.name, league.country||'World',
         mapCountryToContinent(league.country||''), league.logo||null, CURRENT_SEASON]
      );
      dbLeagueId = ins.insertId || null;
      if (!dbLeagueId) continue;
    }

    // Check existing
    const [existing] = await db.query('SELECT id FROM predictions WHERE fixture_id=?', [fixture.id]);
    if (existing.length) { skipped++; continue; }

    // Build unique slug
    const matchDate = fixture.date ? fixture.date.split('T')[0] : date;
    const rawSlug   = `${league.name} ${teams.home.name} vs ${teams.away.name} ${matchDate}`;
    let   slug      = slugify(rawSlug, { lower: true, strict: true });
    const [slugCheck] = await db.query('SELECT id FROM predictions WHERE slug=?', [slug]);
    if (slugCheck.length) slug = `${slug}-${fixture.id}`;

    try {
      // Convert ISO date to MySQL DATETIME format (strip the Z/offset)
      const mysqlDate = fixture.date
        ? fixture.date.replace('T', ' ').replace(/\+\d{2}:\d{2}$/, '').replace('Z', '').slice(0, 19)
        : date + ' 00:00:00';

      await db.query(
        `INSERT INTO predictions
           (fixture_id,league_id,home_team,away_team,home_team_logo,away_team_logo,
            match_date,tip,market,visibility,result,slug,published_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
        [fixture.id, dbLeagueId, teams.home.name, teams.away.name,
         teams.home.logo||null, teams.away.logo||null, mysqlDate,
         'TBD', '1X2', 'free', 'pending', slug]
      );
      created++;
    } catch(e) { console.error(`Fixture insert failed ${fixture.id}:`, e.message); skipped++; }
  }

  console.log(`[API-Football] Fixtures for ${date}: ${created} created, ${skipped} skipped`);
  return { created, skipped, total: fixtures.length };
}

// ── Sync results (update pending predictions after matches finish)
async function syncResults(date) {
  const { data: fixtures } = await request('/fixtures', {
    date, season: CURRENT_SEASON, status: 'FT', timezone: 'UTC'
  });
  let updated = 0;
  for (const item of fixtures) {
    const { fixture, goals, teams } = item;
    if (!fixture || fixture.status.short !== 'FT') continue;
    const [preds] = await db.query(
      'SELECT id,tip,market FROM predictions WHERE fixture_id=? AND result=?',
      [fixture.id, 'pending']
    );
    for (const pred of preds) {
      const result = evaluateTip(pred.tip, pred.market, goals, teams);
      if (result) {
        await db.query('UPDATE predictions SET result=?,updated_at=NOW() WHERE id=?', [result, pred.id]);
        updated++;
      }
    }
  }
  console.log(`[API-Football] Results sync for ${date}: ${updated} updated`);
  return { updated };
}

// ── Evaluate tip outcome
function evaluateTip(tip, market, goals, teams) {
  const homeGoals = goals.home ?? 0;
  const awayGoals = goals.away ?? 0;
  const total     = homeGoals + awayGoals;
  const homeWon   = teams.home.winner === true;
  const awayWon   = teams.away.winner === true;
  const isDraw    = !homeWon && !awayWon;
  const t         = (tip || '').toLowerCase();

  if (t.includes('over 2.5'))  return total > 2.5  ? 'won' : 'lost';
  if (t.includes('over 1.5'))  return total > 1.5  ? 'won' : 'lost';
  if (t.includes('over 3.5'))  return total > 3.5  ? 'won' : 'lost';
  if (t.includes('under 2.5')) return total < 2.5  ? 'won' : 'lost';
  if (t.includes('under 1.5')) return total < 1.5  ? 'won' : 'lost';
  if (t.includes('btts - yes') || t === 'btts yes') return (homeGoals>0&&awayGoals>0) ? 'won':'lost';
  if (t.includes('btts - no')  || t === 'btts no')  return (homeGoals>0&&awayGoals>0) ? 'lost':'won';
  if (t.includes('home win'))  return homeWon ? 'won' : 'lost';
  if (t.includes('away win'))  return awayWon ? 'won' : 'lost';
  if (t.includes('draw'))      return isDraw  ? 'won' : 'lost';
  return null;
}

// ── H2H, form, standings, stats
async function fetchH2H(team1Id, team2Id, last = 10) {
  const { data } = await request('/fixtures/headtohead', { h2h:`${team1Id}-${team2Id}`, last });
  return data;
}
async function fetchTeamForm(teamId, last = 5) {
  const { data } = await request('/fixtures', { team: teamId, last, season: CURRENT_SEASON });
  return data;
}
async function fetchStandings(leagueId, season = CURRENT_SEASON) {
  const { data } = await request('/standings', { league: leagueId, season });
  return data;
}
async function fetchTeamStats(teamId, leagueId, season = CURRENT_SEASON) {
  const { data } = await request('/teams/statistics', { team: teamId, league: leagueId, season });
  return data;
}
function calculateFormString(fixtures, teamId) {
  return fixtures.slice(0, 5).map(f => {
    const isHome = f.teams.home.id === teamId;
    const winner = isHome ? f.teams.home.winner : f.teams.away.winner;
    return winner === true ? 'W' : winner === false ? 'L' : 'D';
  }).join('');
}

// ── Generate a tip suggestion from enriched data ──────────────────────────────
function generateTipSuggestion(homeForm, awayForm, h2hData, homeStats, awayStats) {
  const homeScore = scoreForm(homeForm);
  const awayScore = scoreForm(awayForm);
  const diff      = homeScore - awayScore;

  // H2H advantage
  let h2hAdvantage = 0;
  if (h2hData && h2hData.length) {
    const last10 = h2hData.slice(0, 10);
    const homeWins = last10.filter(f => f.teams.home.winner).length;
    const awayWins = last10.filter(f => f.teams.away.winner).length;
    h2hAdvantage = (homeWins - awayWins) / last10.length;
  }

  // Goals average
  let avgGoals = null;
  if (homeStats && awayStats) {
    const hg = parseFloat(homeStats.goals?.for?.average?.total) || null;
    const ag = parseFloat(awayStats.goals?.for?.average?.total) || null;
    if (hg !== null && ag !== null) avgGoals = hg + ag;
  }

  const combinedDiff = diff * 0.6 + h2hAdvantage * 0.4;

  // Over/Under suggestion based on goals average
  if (avgGoals !== null) {
    if (avgGoals > 3.0) return { tip: 'Over 2.5', market: 'Over/Under', reason: `Combined goals avg: ${avgGoals.toFixed(1)}` };
    if (avgGoals < 1.8) return { tip: 'Under 2.5', market: 'Over/Under', reason: `Combined goals avg: ${avgGoals.toFixed(1)}` };
  }

  // Win/Draw suggestion
  if (combinedDiff > 0.25)  return { tip: 'Home Win', market: '1X2', reason: `Home advantage: form ${(homeScore*100).toFixed(0)}% vs ${(awayScore*100).toFixed(0)}%` };
  if (combinedDiff < -0.25) return { tip: 'Away Win', market: '1X2', reason: `Away stronger: form ${(awayScore*100).toFixed(0)}% vs ${(homeScore*100).toFixed(0)}%` };
  return { tip: 'Draw', market: '1X2', reason: `Evenly matched: home ${(homeScore*100).toFixed(0)}% away ${(awayScore*100).toFixed(0)}%` };
}

function scoreForm(formStr) {
  if (!formStr) return 0.5;
  const chars = formStr.toUpperCase().replace(/[^WDL]/g, '').slice(0, 5).split('');
  if (!chars.length) return 0.5;
  const weights = [1.5, 1.2, 1.0, 0.8, 0.5];
  let s = 0, t = 0;
  chars.forEach((c, i) => { const w = weights[i]||0.5; s += w*(c==='W'?1:c==='D'?0.4:0); t += w; });
  return t > 0 ? s / t : 0.5;
}

// ── Research a single fixture — returns enriched data for admin display ────────
async function researchFixture(fixtureId) {
  // Get the prediction from DB to find team API IDs
  const fixtureInfo = await request('/fixtures', { id: fixtureId });
  if (!fixtureInfo.data.length) throw new Error('Fixture not found in API');

  const fix      = fixtureInfo.data[0];
  const homeId   = fix.teams.home.id;
  const awayId   = fix.teams.away.id;
  const leagueId = fix.league.id;

  const [homeFormRaw, awayFormRaw, h2hRaw, homeStatsRaw, awayStatsRaw, standingsRaw] = await Promise.all([
    fetchTeamForm(homeId, 5).catch(() => []),
    fetchTeamForm(awayId, 5).catch(() => []),
    fetchH2H(homeId, awayId, 10).catch(() => []),
    fetchTeamStats(homeId, leagueId).catch(() => null),
    fetchTeamStats(awayId, leagueId).catch(() => null),
    fetchStandings(leagueId).catch(() => []),
  ]);

  const homeForm = calculateFormString(homeFormRaw, homeId);
  const awayForm = calculateFormString(awayFormRaw, awayId);

  // H2H summary string
  const h2hHomeWins = h2hRaw.filter(f => f.teams.home.winner === true || (f.teams.home.id === homeId && f.teams.home.winner)).length;
  const h2hAwayWins = h2hRaw.filter(f => f.teams.away.winner === true || (f.teams.away.id === awayId && f.teams.away.winner)).length;
  const h2hDraws    = h2hRaw.length - h2hHomeWins - h2hAwayWins;
  const h2hSummary  = h2hRaw.length ? `H${h2hHomeWins}-A${h2hAwayWins}-D${h2hDraws}` : null;

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

  const suggestion = generateTipSuggestion(homeForm, awayForm, h2hRaw, homeStatsRaw, awayStatsRaw);

  return {
    fixture: {
      id:      fix.fixture.id,
      date:    fix.fixture.date,
      home:    { id: homeId, name: fix.teams.home.name, logo: fix.teams.home.logo },
      away:    { id: awayId, name: fix.teams.away.name, logo: fix.teams.away.logo },
      league:  { id: leagueId, name: fix.league.name, logo: fix.league.logo },
    },
    home_form:    homeForm,
    away_form:    awayForm,
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
      goals_for_avg:     homeStatsRaw.goals?.for?.average?.total,
      goals_against_avg: homeStatsRaw.goals?.against?.average?.total,
      wins:              homeStatsRaw.fixtures?.wins?.total,
      draws:             homeStatsRaw.fixtures?.draws?.total,
      losses:            homeStatsRaw.fixtures?.loses?.total,
    } : null,
    away_stats: awayStatsRaw ? {
      goals_for_avg:     awayStatsRaw.goals?.for?.average?.total,
      goals_against_avg: awayStatsRaw.goals?.against?.average?.total,
      wins:              awayStatsRaw.fixtures?.wins?.total,
      draws:             awayStatsRaw.fixtures?.draws?.total,
      losses:            awayStatsRaw.fixtures?.loses?.total,
    } : null,
    suggestion,
  };
}

// ── Auto-predict: enrich pending TBD predictions with form/H2H and generate tips
async function autoPredictFixtures(db, options = {}) {
  const limit     = options.limit || 20;
  const minConf   = options.minConfidence || 55;
  const autoPublish = options.autoPublish !== false;

  const [rows] = await db.query(
    `SELECT p.id, p.fixture_id, p.home_team, p.away_team, p.league_id,
            l.api_league_id
     FROM predictions p
     LEFT JOIN leagues l ON l.id = p.league_id
     WHERE p.tip = 'TBD' AND p.result = 'pending'
       AND p.match_date >= NOW()
     ORDER BY p.match_date ASC
     LIMIT ?`,
    [limit]
  );

  const confidence = require('./confidence');
  let enriched = 0, skipped = 0, errors = 0;
  const log = [];

  for (const row of rows) {
    if (!row.fixture_id) { skipped++; continue; }
    try {
      await new Promise(r => setTimeout(r, 500)); // rate limit spacing

      const data = await researchFixture(row.fixture_id);

      const suggestion  = data.suggestion;
      const h2hSummary  = data.h2h_summary;
      const homeForm    = data.home_form;
      const awayForm    = data.away_form;

      // Score with enriched data
      const { score: confScore } = confidence.score({
        tip:         suggestion.tip,
        market:      suggestion.market,
        odds:        null,
        home_form:   homeForm,
        away_form:   awayForm,
        h2h_summary: h2hSummary,
        league_id:   row.league_id,
      });

      const shouldPublish = autoPublish && confScore >= minConf;

      await db.query(
        `UPDATE predictions SET
           tip              = ?,
           market           = ?,
           home_form        = ?,
           away_form        = ?,
           h2h_summary      = ?,
           confidence_score = ?,
           analysis         = ?,
           published_at     = ?,
           updated_at       = NOW()
         WHERE id = ?`,
        [
          suggestion.tip,
          suggestion.market,
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

module.exports = {
  syncLeagues, syncTeams, syncFixtures, syncResults,
  fetchH2H, fetchTeamForm, fetchStandings, fetchTeamStats,
  calculateFormString, evaluateTip, mapCountryToContinent,
  isPopularLeague, getRequestCount, getRemainingCount, CURRENT_SEASON,
  researchFixture, autoPredictFixtures,
};
