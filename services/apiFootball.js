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

// ── H2H, form, standings, stats (used by algorithm in Phase 8)
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

function getRequestCount()   { return dailyRequestCount; }
function getRemainingCount() { checkAndResetDaily(); return 7400 - dailyRequestCount; }

module.exports = {
  syncLeagues, syncTeams, syncFixtures, syncResults,
  fetchH2H, fetchTeamForm, fetchStandings, fetchTeamStats,
  calculateFormString, evaluateTip, mapCountryToContinent,
  isPopularLeague, getRequestCount, getRemainingCount, CURRENT_SEASON,
};
