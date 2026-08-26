'use strict';

const express  = require('express');
const router   = express.Router();
const db       = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler, successResponse, errorResponse } = require('../utils/helpers');

// ── POST /api/analytics/view  (public — no auth needed) ──────────────────────
router.post('/view', asyncHandler(async (req, res) => {
  const { entity_type, entity_id, entity_slug } = req.body;
  if (!entity_type || !entity_id) return res.status(200).json({ ok: true }); // silent ignore
  if (!['prediction', 'blog'].includes(entity_type)) return res.status(200).json({ ok: true });

  await db.query(
    `INSERT INTO page_views (entity_type, entity_id, entity_slug) VALUES (?, ?, ?)`,
    [entity_type, parseInt(entity_id), entity_slug || null]
  ).catch(() => {}); // table may not exist yet — fail silently

  return res.status(200).json({ ok: true });
}));

// ── GET /api/analytics/stats  (admin only) ───────────────────────────────────
router.get('/stats', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  const d = Math.min(Math.max(parseInt(days) || 30, 1), 365);

  const [[totals]] = await db.query(
    `SELECT
       COUNT(*)                                         AS total_views,
       COUNT(DISTINCT DATE(viewed_at))                  AS active_days,
       COUNT(CASE WHEN entity_type='prediction' THEN 1 END) AS prediction_views,
       COUNT(CASE WHEN entity_type='blog' THEN 1 END)       AS blog_views,
       COUNT(CASE WHEN viewed_at >= NOW() - INTERVAL 1 DAY THEN 1 END) AS today_views,
       COUNT(CASE WHEN viewed_at >= NOW() - INTERVAL 7 DAY THEN 1 END) AS week_views
     FROM page_views
     WHERE viewed_at >= NOW() - INTERVAL ? DAY`, [d]
  );

  const [daily] = await db.query(
    `SELECT DATE(viewed_at) AS date, COUNT(*) AS views, entity_type
     FROM page_views
     WHERE viewed_at >= NOW() - INTERVAL ? DAY
     GROUP BY DATE(viewed_at), entity_type
     ORDER BY date ASC`, [d]
  );

  const [topPredictions] = await db.query(
    `SELECT pv.entity_id, pv.entity_slug,
            p.home_team, p.away_team, p.match_date, p.tip, p.confidence_score,
            COUNT(*) AS views
     FROM page_views pv
     LEFT JOIN predictions p ON p.id = pv.entity_id
     WHERE pv.entity_type = 'prediction'
       AND pv.viewed_at >= NOW() - INTERVAL ? DAY
     GROUP BY pv.entity_id, pv.entity_slug
     ORDER BY views DESC
     LIMIT 10`, [d]
  );

  const [topBlogs] = await db.query(
    `SELECT pv.entity_id, pv.entity_slug,
            bp.title, bp.category, bp.published_at,
            COUNT(*) AS views
     FROM page_views pv
     LEFT JOIN blog_posts bp ON bp.id = pv.entity_id
     WHERE pv.entity_type = 'blog'
       AND pv.viewed_at >= NOW() - INTERVAL ? DAY
     GROUP BY pv.entity_id, pv.entity_slug
     ORDER BY views DESC
     LIMIT 10`, [d]
  );

  // Revenue estimate: ~$2.50 CPM display ads, ~$0.05 per engaged click
  const totalViews   = Number(totals.total_views) || 0;
  const estRevenueLo = +((totalViews / 1000) * 2.0).toFixed(2);
  const estRevenueHi = +((totalViews / 1000) * 5.0).toFixed(2);

  return successResponse(res, {
    period_days:       d,
    totals: {
      total_views:        Number(totals.total_views),
      prediction_views:   Number(totals.prediction_views),
      blog_views:         Number(totals.blog_views),
      today_views:        Number(totals.today_views),
      week_views:         Number(totals.week_views),
      active_days:        Number(totals.active_days),
    },
    revenue_estimate:  { lo: estRevenueLo, hi: estRevenueHi, note: 'Estimate based on $2–$5 CPM display ad rates' },
    daily,
    top_predictions:   topPredictions,
    top_blogs:         topBlogs,
  });
}));

module.exports = router;
