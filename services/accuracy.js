// services/accuracy.js
// Rooted Predictions — Self-calibrating accuracy tracking system
//
// Tracks every resolved prediction (won/lost) in a log table, then
// recalculates win-rate statistics grouped by market, confidence band,
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
 * Returns count of newly logged entries.
 */
async function logUntracked(db) {
  const [resolved] = await db.query(
    `SELECT p.id, p.market, p.tip, p.confidence_score, p.league_id, p.result
     FROM predictions p
     LEFT JOIN prediction_accuracy_log pal ON pal.prediction_id = p.id
     WHERE p.result IN ('won', 'lost')
       AND pal.id IS NULL
       AND p.confidence_score IS NOT NULL`
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
 * Groups by (market, confidence_band) for cross-league view,
 * and by (market, confidence_band, league_id) for per-league view.
 */
async function recalculateStats(db) {
  try {
    // Overall stats (league_id = NULL row = all leagues combined)
    await db.query(`
      INSERT INTO accuracy_stats
        (market, confidence_band, league_id, total_predictions, correct_predictions, accuracy_pct)
      SELECT
        market,
        confidence_band,
        NULL AS league_id,
        COUNT(*)                                                              AS total_predictions,
        SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END)                      AS correct_predictions,
        ROUND(100.0 * SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) / COUNT(*), 2) AS accuracy_pct
      FROM prediction_accuracy_log
      WHERE result IN ('won', 'lost')
      GROUP BY market, confidence_band
      ON DUPLICATE KEY UPDATE
        total_predictions   = VALUES(total_predictions),
        correct_predictions = VALUES(correct_predictions),
        accuracy_pct        = VALUES(accuracy_pct),
        last_updated        = NOW()
    `);

    // Per-league stats
    await db.query(`
      INSERT INTO accuracy_stats
        (market, confidence_band, league_id, total_predictions, correct_predictions, accuracy_pct)
      SELECT
        market,
        confidence_band,
        league_id,
        COUNT(*)                                                              AS total_predictions,
        SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END)                      AS correct_predictions,
        ROUND(100.0 * SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) / COUNT(*), 2) AS accuracy_pct
      FROM prediction_accuracy_log
      WHERE result IN ('won', 'lost') AND league_id IS NOT NULL
      GROUP BY market, confidence_band, league_id
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
 * Get the current calibration table — accuracy by market + confidence band.
 * Only returns bands with ≥ 10 predictions (statistically meaningful).
 * Useful for admin dashboard and for adjusting confidence thresholds.
 */
async function getCalibration(db) {
  const [rows] = await db.query(
    `SELECT
       market,
       confidence_band,
       league_id,
       total_predictions,
       correct_predictions,
       accuracy_pct,
       last_updated
     FROM accuracy_stats
     WHERE total_predictions >= 10
     ORDER BY market, confidence_band DESC, league_id`
  );
  return rows;
}

/**
 * Summary: overall accuracy across all predictions, and per-market breakdown.
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
     ORDER BY accuracy_pct DESC`
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

  return {
    overall:       overall[0] || { total: 0, won: 0, accuracy_pct: 0 },
    by_market:     byMarket,
    by_confidence: byConfidence,
  };
}

module.exports = { recordOutcome, logUntracked, recalculateStats, getCalibration, getSummary };
