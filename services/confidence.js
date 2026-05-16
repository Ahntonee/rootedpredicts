// services/confidence.js
// AfroPredict — Confidence scoring algorithm
// Produces a 0-100 score for any prediction based on available signals.
// Works entirely from data already stored in the DB — no live API calls needed.
// All weights are tuned so the five factor groups sum to 100 points max.
'use strict';

// ── Weight table (total: 100 pts) ─────────────────────────────────────────────
const W = {
  form:        30,   // recent 5-match win rate of both teams
  h2h:         20,   // head-to-head historical advantage
  odds:        20,   // market-implied probability
  market:      15,   // how predictable the market type is
  league:      15,   // league tier reliability signal
};

// Market predictability coefficients (historical accuracy by market type)
const MARKET_COEFF = {
  '1X2':          1.00,
  'Over/Under':   0.95,
  'BTTS':         0.90,
  'Draw No Bet':  0.88,
  'Correct Score':0.55,
  'Accumulator':  0.40,
};

// League tier reliability (top leagues have more data = more reliable signals)
const LEAGUE_TIER = {
  39:  1.00,  // Premier League
  140: 1.00,  // La Liga
  135: 1.00,  // Serie A
  78:  1.00,  // Bundesliga
  61:  1.00,  // Ligue 1
  2:   0.95,  // UEFA Champions League
  3:   0.90,  // UEFA Europa League
  253: 0.85,  // MLS
  71:  0.85,  // Brasileirao
  6:   0.80,  // World Cup
  default: 0.70,
};

// ── Form parser ───────────────────────────────────────────────────────────────
// form string: last 5 results as W/D/L characters, newest first
// e.g. "WWDLW" = W,W,D,L,W
function parseFormScore(formStr) {
  if (!formStr || typeof formStr !== 'string') return 0.5; // neutral if unknown
  const chars = formStr.toUpperCase().replace(/[^WDL]/g, '').slice(0, 5).split('');
  if (!chars.length) return 0.5;
  // Weighted: most recent match counts more
  const weights = [1.5, 1.2, 1.0, 0.8, 0.5];
  let score = 0, total = 0;
  chars.forEach((c, i) => {
    const w = weights[i] || 0.5;
    score += w * (c === 'W' ? 1 : c === 'D' ? 0.4 : 0);
    total += w;
  });
  return total > 0 ? score / total : 0.5;
}

// ── H2H parser ────────────────────────────────────────────────────────────────
// h2h_summary: free-text or structured "H5-A2-D3" format produced by sync
// Supports: "H5-A2-D3" (home wins 5, away wins 2, draws 3)
//           or plain text — falls back to neutral
function parseH2HScore(h2hStr, tip) {
  if (!h2hStr || typeof h2hStr !== 'string') return 0.5;

  // Structured format
  const match = h2hStr.match(/H(\d+)-A(\d+)-D(\d+)/i);
  if (match) {
    const hw = parseInt(match[1]);
    const aw = parseInt(match[2]);
    const dw = parseInt(match[3]);
    const total = hw + aw + dw;
    if (total === 0) return 0.5;

    const tipU = (tip || '').toUpperCase();
    if (tipU.includes('HOME') || tipU.includes('1'))  return hw / total;
    if (tipU.includes('AWAY') || tipU.includes('2'))  return aw / total;
    if (tipU.includes('DRAW') || tipU === 'X')        return dw / total;
    if (tipU.includes('OVER'))  return (hw + aw) / total; // goals likely if decisive matches
    if (tipU.includes('UNDER')) return dw / total;        // draws tend to be low-scoring
    return Math.max(hw, aw, dw) / total;                  // favour the dominant outcome
  }

  // Plain text fallback — scan for keywords
  const lower = h2hStr.toLowerCase();
  if (lower.includes('dominant') || lower.includes('strong advantage')) return 0.75;
  if (lower.includes('slight advantage'))                               return 0.62;
  if (lower.includes('even') || lower.includes('balanced'))            return 0.50;
  return 0.50;
}

// ── Odds to implied probability ───────────────────────────────────────────────
function oddsToImpliedProb(odds) {
  const o = parseFloat(odds);
  if (!o || o <= 1.0) return null;
  // Remove overround: decimal odds → raw probability
  return 1 / o;
}

// ── Main scoring function ─────────────────────────────────────────────────────
/**
 * score(prediction)
 * Accepts a prediction object (as stored in DB) and returns { score, breakdown }.
 * score: integer 0-100
 * breakdown: per-factor contributions for transparency
 */
function score(prediction) {
  const {
    tip, market, odds,
    home_form, away_form, h2h_summary,
    league_id,
  } = prediction;

  const breakdown = {};

  // ── 1. Form (30 pts) ───────────────────────────────────────────────────────
  const homeFormScore = parseFormScore(home_form);
  const awayFormScore = parseFormScore(away_form);

  const tipU = (tip || '').toUpperCase();
  let formSignal;
  if (tipU.includes('HOME') || tipU.includes('1')) {
    // Home win tip: weight home form more
    formSignal = homeFormScore * 0.65 + (1 - awayFormScore) * 0.35;
  } else if (tipU.includes('AWAY') || tipU.includes('2')) {
    formSignal = awayFormScore * 0.65 + (1 - homeFormScore) * 0.35;
  } else if (tipU.includes('DRAW') || tipU === 'X') {
    // Draw more likely when both teams are middling
    const avgForm = (homeFormScore + awayFormScore) / 2;
    formSignal = 1 - Math.abs(homeFormScore - awayFormScore); // close form = draw likely
    formSignal = (formSignal + (1 - Math.abs(avgForm - 0.5))) / 2;
  } else if (tipU.includes('OVER')) {
    // Over goals: both teams scoring = high combined form
    formSignal = (homeFormScore + awayFormScore) / 2;
  } else if (tipU.includes('UNDER')) {
    formSignal = 1 - (homeFormScore + awayFormScore) / 2;
  } else if (tipU.includes('BTTS') || tipU.includes('BOTH')) {
    // BTTS: neither team should be dominant defensively
    formSignal = Math.min(homeFormScore, awayFormScore);
  } else {
    formSignal = (homeFormScore + (1 - awayFormScore)) / 2;
  }
  breakdown.form = Math.round(clamp(formSignal) * W.form);

  // ── 2. H2H (20 pts) ───────────────────────────────────────────────────────
  const h2hSignal = parseH2HScore(h2h_summary, tip);
  breakdown.h2h = Math.round(clamp(h2hSignal) * W.h2h);

  // ── 3. Odds / market probability (20 pts) ─────────────────────────────────
  const impliedProb = oddsToImpliedProb(odds);
  let oddsSignal;
  if (impliedProb !== null) {
    // Sweet spot: odds between 1.4–2.2 (45%–71% probability) = confident but not chalk
    // Very short odds (<1.4) = chalk, less interesting. Very long (>3.5) = risky.
    if (impliedProb >= 0.70) {
      oddsSignal = 0.75; // near certainty per market, but high chalk risk
    } else if (impliedProb >= 0.50) {
      oddsSignal = 0.90; // sweet spot
    } else if (impliedProb >= 0.35) {
      oddsSignal = 0.70; // slightly contrarian, still viable
    } else {
      oddsSignal = 0.35; // long shot — low confidence contribution
    }
  } else {
    oddsSignal = 0.55; // no odds data — neutral
  }
  breakdown.odds = Math.round(clamp(oddsSignal) * W.odds);

  // ── 4. Market type (15 pts) ────────────────────────────────────────────────
  const mktKey    = Object.keys(MARKET_COEFF).find(k => (market||'').includes(k)) || '1X2';
  const mktSignal = MARKET_COEFF[mktKey] || 0.70;
  breakdown.market = Math.round(clamp(mktSignal) * W.market);

  // ── 5. League reliability (15 pts) ────────────────────────────────────────
  const leagueSignal = LEAGUE_TIER[parseInt(league_id)] || LEAGUE_TIER.default;
  breakdown.league = Math.round(clamp(leagueSignal) * W.league);

  // ── Total ──────────────────────────────────────────────────────────────────
  const raw = breakdown.form + breakdown.h2h + breakdown.odds + breakdown.market + breakdown.league;

  // Apply a slight regression to the mean: very extreme scores are pulled inward
  // This prevents 95+ scores from appearing for manually-entered predictions
  const regressed = Math.round(raw * 0.90 + 50 * 0.10);
  const final = clamp01(regressed);

  return { score: final, breakdown };
}

function clamp(v)   { return Math.max(0, Math.min(1, v)); }
function clamp01(v) { return Math.max(1, Math.min(99, Math.round(v))); }

// ── Batch: score all unscored predictions in DB ───────────────────────────────
async function scoreAllPending(db) {
  const [rows] = await db.query(
    `SELECT id, tip, market, odds, home_form, away_form, h2h_summary, league_id, confidence_score
     FROM predictions WHERE result = 'pending'`
  );

  let updated = 0;
  for (const row of rows) {
    // Skip if already manually set to a non-null value AND we have no form data
    // (respect manual overrides when algorithm has nothing to work with)
    const hasFormData = row.home_form || row.away_form || row.h2h_summary || row.odds;
    if (row.confidence_score && !hasFormData) continue;

    const { score: s } = score(row);
    await db.query(
      `UPDATE predictions SET confidence_score = ?, updated_at = NOW() WHERE id = ?`,
      [s, row.id]
    );
    updated++;
  }
  return updated;
}

// ── Score a single prediction by id ──────────────────────────────────────────
async function scorePrediction(db, predictionId) {
  const [rows] = await db.query(
    `SELECT id, tip, market, odds, home_form, away_form, h2h_summary, league_id
     FROM predictions WHERE id = ?`,
    [predictionId]
  );
  if (!rows.length) throw new Error('Prediction not found');
  const { score: s, breakdown } = score(rows[0]);
  await db.query(
    `UPDATE predictions SET confidence_score = ?, updated_at = NOW() WHERE id = ?`,
    [s, predictionId]
  );
  return { score: s, breakdown };
}

module.exports = { score, scorePrediction, scoreAllPending };
