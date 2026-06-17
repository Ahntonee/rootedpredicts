// services/accuracy.js
// Rooted Predictions — Self-calibrating accuracy tracking system
//
// Tracks every resolved prediction (won/lost) in a log table, then
// recalculates win-rate statistics grouped by market, tip, confidence band,
// and league so the engine can be audited and calibrated over time.
'use strict';

/**
 * Record a single resolved prediction outcome into prediction_accuracy_log.
 * Safe to call multiple times — uses ON DUPLICATE KEY UPDATE.
 *
 * @param {object} db         mysql2/promise pool
 * @param {object} prediction { id, market, tip, confidence_score, league_id, result }
 */
async function recordOutcome(db, prediction) {
  if (!prediction || !['won', 'lost'].includes(prediction.result)) return;

  // Confidence band: round down to nearest 5 (e.g. 67 → 65, 72 → 70)
  // Predictions without a confidence score default to band 50
  const confBand = Math.floor((prediction.confidence_score || 50) / 5) * 5;

  try {
    await db.query(
      `INSERT INTO prediction_accuracy_log
         (prediction_id, market, tip, confidence_band, league_id, result)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE result = VALUES(result), updated_at = NOW()`,
      [
        prediction.id,
        (prediction.market || '1X2').substring(0, 50),
        (prediction.tip    || '').substring(0, 100),
        confBand,
        prediction.league_id || null,
        prediction.result,
      ]
    );
  } catch (e) {
    console.error('[ACCURACY] recordOutcome failed:', e.message);
  }
}

/**
 * Bulk-log all predictions that are resolved but not yet in the log.
 * Includes predictions without a confidence_score (they use band 50).
 * Returns count of newly logged entries.
 */
async function logUntracked(db) {
  const [resolved] = await db.query(
    `SELECT p.id, p.market, p.tip, p.confidence_score, p.league_id, p.result
     FROM predictions p
     LEFT JOIN prediction_accuracy_log pal ON pal.prediction_id = p.id
     WHERE p.result IN ('won', 'lost')
       AND pal.id IS NULL`
  );

  let logged = 0;
  for (const pred of resolved) {
    await recordOutcome(db, pred);
    logged++;
  }
  return logged;
}

/**
 * Recalculate accuracy_stats from the full log.
 * Groups by (market, tip, confidence_band) for cross-league view,
 * and by (market, tip, confidence_band, league_id) for per-league view.
 */
async function recalculateStats(db) {
  try {
    // Overall stats grouped by market + tip (league_id = NULL = all leagues combined)
    await db.query(`
      INSERT INTO accuracy_stats
        (market, tip, confidence_band, league_id, total_predictions, correct_predictions, accuracy_pct)
      SELECT
        market,
        COALESCE(tip, '')                                                      AS tip,
        confidence_band,
        NULL                                                                   AS league_id,
        COUNT(*)                                                               AS total_predictions,
        SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END)                       AS correct_predictions,
        ROUND(100.0 * SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) / COUNT(*), 2) AS accuracy_pct
      FROM prediction_accuracy_log
      WHERE result IN ('won', 'lost')
      GROUP BY market, COALESCE(tip, ''), confidence_band
      ON DUPLICATE KEY UPDATE
        total_predictions   = VALUES(total_predictions),
        correct_predictions = VALUES(correct_predictions),
        accuracy_pct        = VALUES(accuracy_pct),
        last_updated        = NOW()
    `);

    // Per-league stats grouped by market + tip + league
    await db.query(`
      INSERT INTO accuracy_stats
        (market, tip, confidence_band, league_id, total_predictions, correct_predictions, accuracy_pct)
      SELECT
        market,
        COALESCE(tip, '')                                                      AS tip,
        confidence_band,
        league_id,
        COUNT(*)                                                               AS total_predictions,
        SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END)                       AS correct_predictions,
        ROUND(100.0 * SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) / COUNT(*), 2) AS accuracy_pct
      FROM prediction_accuracy_log
      WHERE result IN ('won', 'lost') AND league_id IS NOT NULL
      GROUP BY market, COALESCE(tip, ''), confidence_band, league_id
      ON DUPLICATE KEY UPDATE
        total_predictions   = VALUES(total_predictions),
        correct_predictions = VALUES(correct_predictions),
        accuracy_pct        = VALUES(accuracy_pct),
        last_updated        = NOW()
    `);

    console.log('[ACCURACY] Stats recalculated successfully');
  } catch (e) {
    console.error('[ACCURACY] recalculateStats failed:', e.message);
  }
}

/**
 * Get the current calibration table — accuracy by market + tip + confidence band.
 * Only returns bands with ≥ 10 predictions (statistically meaningful).
 */
async function getCalibration(db) {
  const [rows] = await db.query(
    `SELECT
       market,
       tip,
       confidence_band,
       league_id,
       total_predictions,
       correct_predictions,
       accuracy_pct,
       last_updated
     FROM accuracy_stats
     WHERE total_predictions >= 10
     ORDER BY market, tip, confidence_band DESC, league_id`
  );
  return rows;
}

/**
 * Summary: overall accuracy, per-market, per-confidence, per-tip, and per-league×tip breakdown.
 * All queries run directly against prediction_accuracy_log for real-time accuracy.
 */
async function getSummary(db) {
  const [overall] = await db.query(
    `SELECT
       COUNT(*)                                                  AS total,
       SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END)          AS won,
       ROUND(100.0 * SUM(CASE WHEN result='won' THEN 1 ELSE 0 END) / COUNT(*), 2) AS accuracy_pct
     FROM prediction_accuracy_log
     WHERE result IN ('won', 'lost')`
  );

  const [byMarket] = await db.query(
    `SELECT
       market,
       COUNT(*)                                                  AS total,
       SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END)          AS won,
       ROUND(100.0 * SUM(CASE WHEN result='won' THEN 1 ELSE 0 END) / COUNT(*), 2) AS accuracy_pct
     FROM prediction_accuracy_log
     WHERE result IN ('won', 'lost')
     GROUP BY market
     ORDER BY total DESC`
  );

  const [byConfidence] = await db.query(
    `SELECT
       confidence_band,
       COUNT(*)                                                  AS total,
       SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END)          AS won,
       ROUND(100.0 * SUM(CASE WHEN result='won' THEN 1 ELSE 0 END) / COUNT(*), 2) AS accuracy_pct
     FROM prediction_accuracy_log
     WHERE result IN ('won', 'lost')
     GROUP BY confidence_band
     ORDER BY confidence_band DESC`
  );

  // Per sub-market (tip) breakdown — shows "Over 2.5", "BTTS Yes", "Home Win", etc.
  const [byTip] = await db.query(
    `SELECT
       market,
       tip,
       COUNT(*)                                                  AS total,
       SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END)          AS won,
       ROUND(100.0 * SUM(CASE WHEN result='won' THEN 1 ELSE 0 END) / COUNT(*), 2) AS accuracy_pct
     FROM prediction_accuracy_log
     WHERE result IN ('won', 'lost') AND tip IS NOT NULL AND tip != ''
     GROUP BY market, tip
     ORDER BY market, total DESC, accuracy_pct DESC`
  );

  // Per-league × tip breakdown — shows which leagues favour which sub-markets
  const [byLeagueTip] = await db.query(
    `SELECT
       pal.market,
       pal.tip,
       l.name  AS league_name,
       l.country,
       COUNT(*)                                                                AS total,
       SUM(CASE WHEN pal.result = 'won' THEN 1 ELSE 0 END)                    AS won,
       ROUND(100.0 * SUM(CASE WHEN pal.result='won' THEN 1 ELSE 0 END) / COUNT(*), 2) AS accuracy_pct
     FROM prediction_accuracy_log pal
     JOIN leagues l ON l.id = pal.league_id
     WHERE pal.result IN ('won', 'lost')
     GROUP BY pal.market, pal.tip, pal.league_id, l.name, l.country
     HAVING total >= 3
     ORDER BY pal.market, pal.tip, total DESC, accuracy_pct DESC`
  );

  return {
    overall:        overall[0] || { total: 0, won: 0, accuracy_pct: 0 },
    by_market:      byMarket,
    by_confidence:  byConfidence,
    by_tip:         byTip,
    by_league_tip:  byLeagueTip,
  };
}

module.exports = { recordOutcome, logUntracked, recalculateStats, getCalibration, getSummary };
