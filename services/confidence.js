// services/confidence.js
// Rooted Predictions — Confidence scoring algorithm
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
// h2h_summary supports two formats:
//   "H5-A2-D3"          — simple counts (legacy)
//   "RH3-RA1-RD1|OH2-OA1-OD2" — Recent (last 5) | Older, pipe-separated (preferred)
//
// Recent matches are weighted 2× vs older to capture current form dynamics.
function parseH2HScore(h2hStr, tip) {
  if (!h2hStr || typeof h2hStr !== 'string') return 0.5;

  const tipU = (tip || '').toUpperCase();

  // Try the new recent|older format first
  const pipeIdx = h2hStr.indexOf('|');
  if (pipeIdx !== -1) {
    const recentPart = h2hStr.slice(0, pipeIdx);
    const olderPart  = h2hStr.slice(pipeIdx + 1);
    const rMatch     = recentPart.match(/H(\d+)-A(\d+)-D(\d+)/i);
    const oMatch     = olderPart.match(/H(\d+)-A(\d+)-D(\d+)/i);
    if (rMatch && oMatch) {
      // Weighted: recent counts 2×, older counts 1×
      const rh = parseInt(rMatch[1]) * 2, ra = parseInt(rMatch[2]) * 2, rd = parseInt(rMatch[3]) * 2;
      const oh = parseInt(oMatch[1]),     oa = parseInt(oMatch[2]),     od = parseInt(oMatch[3]);
      const hw = rh + oh, aw = ra + oa, dw = rd + od;
      const total = hw + aw + dw;
      if (total === 0) return 0.5;
      return _h2hSignal(hw, aw, dw, total, tipU);
    }
  }

  // Legacy "H5-A2-D3" format
  const match = h2hStr.match(/H(\d+)-A(\d+)-D(\d+)/i);
  if (match) {
    const hw = parseInt(match[1]), aw = parseInt(match[2]), dw = parseInt(match[3]);
    const total = hw + aw + dw;
    if (total === 0) return 0.5;
    return _h2hSignal(hw, aw, dw, total, tipU);
  }

  // Plain text fallback
  const lower = h2hStr.toLowerCase();
  if (lower.includes('dominant') || lower.includes('strong advantage')) return 0.75;
  if (lower.includes('slight advantage'))                               return 0.62;
  if (lower.includes('even') || lower.includes('balanced'))            return 0.50;
  return 0.50;
}

function _h2hSignal(hw, aw, dw, total, tipU) {
  if (tipU.includes('HOME') || tipU === '1')  return hw / total;
  if (tipU.includes('AWAY') || tipU === '2')  return aw / total;
  if (tipU.includes('DRAW') || tipU === 'X')  return dw / total;
  if (tipU.includes('OVER'))  return (hw + aw) / total; // decisive games → more goals
  if (tipU.includes('UNDER')) return dw / total;        // draws → fewer goals
  if (tipU.includes('BTTS'))  return (hw + aw) / total; // decisive → both teams active
  return Math.max(hw, aw, dw) / total;                  // dominant outcome advantage
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
 *
 * Optional venue-specific form fields:
 *   home_form_venue — home team's form in HOME games only
 *   away_form_venue — away team's form in AWAY games only
 */
function score(prediction) {
  const {
    tip, market, odds,
    home_form, away_form,
    home_form_venue, away_form_venue,  // venue-specific forms (richer signal)
    h2h_summary,
    league_id,
    // Goals-based signals (optional — when absent, algorithm falls back to win-rate form)
    home_goals_avg,           // home team's avg goals scored per game (venue-specific preferred)
    home_goals_conceded_avg,  // home team's avg goals conceded per game (venue-specific preferred)
    away_goals_avg,           // away team's avg goals scored per game (venue-specific preferred)
    away_goals_conceded_avg,  // away team's avg goals conceded per game (venue-specific preferred)
  } = prediction;

  const breakdown = {};

  // ── 1. Form (30 pts) ───────────────────────────────────────────────────────
  // For 1X2 tips use venue-specific form when available (more accurate signal).
  // For Over/Under/BTTS use overall form (venue doesn't matter for goals markets).
  const tipU = (tip || '').toUpperCase();
  const isHomeWinTip = tipU.includes('HOME') || tipU === '1';
  const isAwayWinTip = tipU.includes('AWAY') || tipU === '2';
  const is1X2        = isHomeWinTip || isAwayWinTip || tipU.includes('DRAW') || tipU === 'X';

  // Pick the right form source
  const hFormSrc = (is1X2 && home_form_venue) ? home_form_venue : home_form;
  const aFormSrc = (is1X2 && away_form_venue) ? away_form_venue : away_form;

  const homeFormScore = parseFormScore(hFormSrc);
  const awayFormScore = parseFormScore(aFormSrc);

  // Also compute overall form for a blended signal when venue-specific is available
  const homeFormOverall = parseFormScore(home_form);
  const awayFormOverall = parseFormScore(away_form);
  // Blend: 65% venue-specific + 35% overall when both available, else use what we have
  const hFS = (is1X2 && home_form_venue) ? homeFormScore * 0.65 + homeFormOverall * 0.35 : homeFormScore;
  const aFS = (is1X2 && away_form_venue) ? awayFormScore * 0.65 + awayFormOverall * 0.35 : awayFormScore;

  let formSignal;
  if (isHomeWinTip) {
    formSignal = hFS * 0.65 + (1 - aFS) * 0.35;
  } else if (isAwayWinTip) {
    formSignal = aFS * 0.65 + (1 - hFS) * 0.35;
  } else if (tipU.includes('DRAW') || tipU === 'X') {
    const avgForm = (hFS + aFS) / 2;
    formSignal = 1 - Math.abs(hFS - aFS);
    formSignal = (formSignal + (1 - Math.abs(avgForm - 0.5))) / 2;
  } else if (tipU.includes('OVER')) {
    const baseSignal = (homeFormOverall + awayFormOverall) / 2;
    if (home_goals_avg != null && away_goals_avg != null) {
      // Expected total goals for the fixture; extract threshold from tip (e.g. "Over 2.5" → 2.5)
      const expectedTotal = home_goals_avg + away_goals_avg;
      const threshMatch = tipU.match(/(\d+\.?\d*)/);
      const threshold = threshMatch ? parseFloat(threshMatch[1]) : 2.5;
      // Soft-step signal: 0.5 at the threshold, rising toward 1.0 as expected exceeds it
      const goalsSignal = clamp(0.5 + (expectedTotal - threshold) / Math.max(threshold, 1.5) * 0.45);
      formSignal = baseSignal * 0.35 + goalsSignal * 0.65;
    } else {
      formSignal = baseSignal;
    }
  } else if (tipU.includes('UNDER')) {
    const baseSignal = 1 - (homeFormOverall + awayFormOverall) / 2;
    if (home_goals_avg != null && away_goals_avg != null) {
      const expectedTotal = home_goals_avg + away_goals_avg;
      const threshMatch = tipU.match(/(\d+\.?\d*)/);
      const threshold = threshMatch ? parseFloat(threshMatch[1]) : 2.5;
      const goalsSignal = clamp(0.5 - (expectedTotal - threshold) / Math.max(threshold, 1.5) * 0.45);
      formSignal = baseSignal * 0.35 + goalsSignal * 0.65;
    } else {
      formSignal = baseSignal;
    }
  } else if (tipU.includes('BTTS') || tipU.includes('BOTH')) {
    const baseSignal = Math.min(homeFormOverall, awayFormOverall);
    if (home_goals_avg != null && away_goals_avg != null &&
        home_goals_conceded_avg != null && away_goals_conceded_avg != null) {
      // Expected goals each team will score: blend own attack avg with opponent's defensive avg
      const expHome = (home_goals_avg + away_goals_conceded_avg) / 2;
      const expAway = (away_goals_avg + home_goals_conceded_avg) / 2;
      // P(team scores ≥ 1) via Poisson: 1 - P(0 goals) = 1 - e^(-lambda)
      const pHomeScores = 1 - Math.exp(-Math.max(expHome, 0.05));
      const pAwayScores = 1 - Math.exp(-Math.max(expAway, 0.05));
      const bttsProbGoals = pHomeScores * pAwayScores;
      const isBttsYes = !tipU.includes(' NO');
      const goalsSignal = isBttsYes ? bttsProbGoals : (1 - bttsProbGoals);
      formSignal = baseSignal * 0.35 + goalsSignal * 0.65;
    } else {
      formSignal = baseSignal;
    }
  } else {
    formSignal = (hFS + (1 - aFS)) / 2;
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

// ── Calibration: blend base score toward empirical win-rate ──────────────────
//
// calibrationRows comes from accuracy.getCalibration(db) — the accuracy_stats
// table that records real win-rates grouped by (market, tip, confidence_band, league_id).
//
// Lookup hierarchy (most → least specific):
//   1. market + tip + league + band
//   2. market + tip + band          (cross-league)
//   3. market + band                (all tips combined)
//   4. band only                    (market-agnostic fallback)
//
// Trust formula: grows from 0→1 as sample count goes 10→150.
// Max blend weight is 40% — the model always contributes ≥ 60% of the score,
// preventing runaway drift on small or unrepresentative samples.
//
// Returns baseScore unchanged when no calibration data exists (new site, sparse
// history, or unseen market/tip combination) — fully backward-compatible.
function calibrate(baseScore, prediction, calibrationRows) {
  if (!calibrationRows || !calibrationRows.length) return baseScore;

  const confBand = Math.floor(baseScore / 5) * 5;
  const mkt = prediction.market || '1X2';
  const tip = prediction.tip    || '';
  const lid = prediction.league_id ? parseInt(prediction.league_id) : null;

  const pool = calibrationRows.filter(
    r => r.confidence_band === confBand && r.total_predictions >= 10
  );
  if (!pool.length) return baseScore;

  const match =
    // Most specific: market + tip + this league
    pool.find(r => r.market === mkt && r.tip === tip && parseInt(r.league_id) === lid && lid !== null) ||
    // Market + tip, any league
    pool.find(r => r.market === mkt && r.tip === tip && !r.league_id) ||
    // Market only (tips merged)
    pool.find(r => r.market === mkt && (!r.tip || r.tip === '') && !r.league_id) ||
    // Band-only fallback
    pool.find(r => !r.market && !r.league_id);

  if (!match) return baseScore;

  // trust: 0 at 10 samples → 1.0 at 150+ samples; maxBlend caps at 40%
  const trust   = Math.min(1, (match.total_predictions - 10) / 140);
  const blendW  = trust * 0.40;
  const adjusted = baseScore * (1 - blendW) + match.accuracy_pct * blendW;
  return clamp01(adjusted);
}

// ── Batch: score all pending predictions in DB ────────────────────────────────
async function scoreAllPending(db) {
  const { getCalibration } = require('./accuracy');

  const [rows] = await db.query(
    `SELECT id, tip, market, odds, home_form, away_form, h2h_summary, league_id, confidence_score
     FROM predictions WHERE result = 'pending'`
  );

  // Load calibration table once for the whole batch (avoids per-row DB queries)
  const calibrationRows = await getCalibration(db);

  let updated = 0;
  for (const row of rows) {
    // Respect manual overrides when algorithm has nothing to work with
    const hasFormData = row.home_form || row.away_form || row.h2h_summary || row.odds;
    if (row.confidence_score && !hasFormData) continue;

    const { score: baseScore } = score(row);
    const finalScore = calibrate(baseScore, row, calibrationRows);

    await db.query(
      `UPDATE predictions SET confidence_score = ?, updated_at = NOW() WHERE id = ?`,
      [finalScore, row.id]
    );
    updated++;
  }
  return updated;
}

// ── Score a single prediction by id ──────────────────────────────────────────
async function scorePrediction(db, predictionId) {
  const { getCalibration } = require('./accuracy');

  const [rows] = await db.query(
    `SELECT id, tip, market, odds, home_form, away_form, h2h_summary, league_id
     FROM predictions WHERE id = ?`,
    [predictionId]
  );
  if (!rows.length) throw new Error('Prediction not found');

  const { score: baseScore, breakdown } = score(rows[0]);
  const calibrationRows = await getCalibration(db);
  const finalScore = calibrate(baseScore, rows[0], calibrationRows);

  await db.query(
    `UPDATE predictions SET confidence_score = ?, updated_at = NOW() WHERE id = ?`,
    [finalScore, predictionId]
  );

  // Return both so admin UI can show "model said X, calibrated to Y"
  return { score: finalScore, baseScore, breakdown };
}

module.exports = { score, calibrate, scorePrediction, scoreAllPending };
