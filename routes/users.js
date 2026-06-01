// routes/users.js
// Rooted Predictions — User profile and dashboard routes
// GET  /api/users/profile          — Get own profile
// PUT  /api/users/profile          — Update own profile
// GET  /api/users/bookmarks        — Get own bookmarks
// POST /api/users/bookmarks        — Add bookmark
// DELETE /api/users/bookmarks/:id  — Remove bookmark
// GET  /api/users/bet-history      — Get bet history
// POST /api/users/bet-history      — Add bet entry
// PUT  /api/users/bet-history/:id  — Update bet entry
// DELETE /api/users/bet-history/:id — Delete bet entry
// GET  /api/users/stats            — Personal stats summary

'use strict';

const express  = require('express');
const router   = express.Router();
const db       = require('../config/db');
const { authenticate }  = require('../middleware/auth');
const { validateBetHistory } = require('../middleware/validate');
const {
  asyncHandler, successResponse, errorResponse,
  parsePagination, paginate, sanitiseText, calculateProfitLoss,
} = require('../utils/helpers');

// All user routes require authentication
router.use(authenticate);

// ── GET /api/users/profile
router.get('/profile', asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    `SELECT id, name, email, role, country, timezone, telegram_invited, created_at
     FROM users WHERE id = ?`, [req.user.id]
  );
  if (!rows.length) return errorResponse(res, 'User not found', 404);

  let subscription = null;
  if (rows[0].role === 'vip' || rows[0].role === 'admin') {
    const [subs] = await db.query(
      `SELECT plan, status, expires_at, trial_ends_at, amount, currency
       FROM subscriptions WHERE user_id = ? AND status IN ('active','trialing')
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    subscription = subs[0] || null;
  }

  return successResponse(res, { ...rows[0], subscription });
}));

// ── PUT /api/users/profile
router.put('/profile', asyncHandler(async (req, res) => {
  const { name, country, timezone } = req.body;
  const updates = [];
  const args    = [];

  if (name) {
    updates.push('name = ?');
    args.push(sanitiseText(name).slice(0, 100));
  }
  if (country !== undefined) {
    updates.push('country = ?');
    args.push(country ? sanitiseText(country).slice(0, 100) : null);
  }
  if (timezone) {
    updates.push('timezone = ?');
    args.push(sanitiseText(timezone).slice(0, 64));
  }

  if (!updates.length) return errorResponse(res, 'No fields to update', 400);

  updates.push('updated_at = NOW()');
  args.push(req.user.id);

  await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, args);

  const [rows] = await db.query(
    'SELECT id, name, email, role, country, timezone FROM users WHERE id = ?',
    [req.user.id]
  );
  return successResponse(res, rows[0], 'Profile updated successfully');
}));

// ── GET /api/users/stats
router.get('/stats', asyncHandler(async (req, res) => {
  const [[bookmarkCount]] = await db.query(
    'SELECT COUNT(*) as total FROM bookmarks WHERE user_id = ?', [req.user.id]
  );
  const [[betStats]] = await db.query(
    `SELECT
       COUNT(*) as total_bets,
       SUM(result='won') as won,
       SUM(result='lost') as lost,
       SUM(result='pending') as pending,
       SUM(CASE WHEN result='won' THEN profit_loss ELSE 0 END) as total_profit,
       SUM(CASE WHEN result='lost' THEN ABS(profit_loss) ELSE 0 END) as total_loss,
       SUM(profit_loss) as net_pl
     FROM bet_history WHERE user_id = ?`,
    [req.user.id]
  );

  const winRate = betStats.won && (betStats.won + betStats.lost) > 0
    ? Math.round((betStats.won / (betStats.won + betStats.lost)) * 100)
    : 0;

  return successResponse(res, {
    bookmarks:    bookmarkCount.total,
    bets:         betStats.total_bets || 0,
    won:          betStats.won        || 0,
    lost:         betStats.lost       || 0,
    pending:      betStats.pending    || 0,
    win_rate:     winRate,
    net_pl:       parseFloat(betStats.net_pl || 0).toFixed(2),
    total_profit: parseFloat(betStats.total_profit || 0).toFixed(2),
    total_loss:   parseFloat(betStats.total_loss   || 0).toFixed(2),
  });
}));

// ════════════════════════════════════════════════════════════════
// BOOKMARKS
// ════════════════════════════════════════════════════════════════

// ── GET /api/users/bookmarks
router.get('/bookmarks', asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);

  const [[{ total }]] = await db.query(
    'SELECT COUNT(*) as total FROM bookmarks WHERE user_id = ?', [req.user.id]
  );

  const [rows] = await db.query(
    `SELECT b.id, b.created_at,
       p.id as prediction_id, p.home_team, p.away_team, p.home_team_logo, p.away_team_logo,
       p.match_date, p.tip, p.market, p.odds, p.confidence_score, p.visibility,
       p.result, p.slug,
       l.name as league_name, l.logo_url as league_logo, l.country as league_country
     FROM bookmarks b
     JOIN predictions p ON b.prediction_id = p.id
     LEFT JOIN leagues l ON p.league_id = l.id
     WHERE b.user_id = ?
     ORDER BY b.created_at DESC
     LIMIT ? OFFSET ?`,
    [req.user.id, limit, offset]
  );

  return successResponse(res, {
    bookmarks:  rows,
    pagination: paginate(parseInt(total), page, limit),
  });
}));

// ── POST /api/users/bookmarks
router.post('/bookmarks', asyncHandler(async (req, res) => {
  const { prediction_id } = req.body;
  if (!prediction_id) return errorResponse(res, 'prediction_id is required', 400);

  // Verify prediction exists
  const [pred] = await db.query('SELECT id FROM predictions WHERE id = ?', [prediction_id]);
  if (!pred.length) return errorResponse(res, 'Prediction not found', 404);

  try {
    await db.query(
      'INSERT INTO bookmarks (user_id, prediction_id) VALUES (?, ?)',
      [req.user.id, prediction_id]
    );
    return successResponse(res, { prediction_id }, 'Prediction bookmarked', 201);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return errorResponse(res, 'Already bookmarked', 409);
    }
    throw e;
  }
}));

// ── DELETE /api/users/bookmarks/:id
router.delete('/bookmarks/:id', asyncHandler(async (req, res) => {
  const [result] = await db.query(
    'DELETE FROM bookmarks WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id]
  );
  if (!result.affectedRows) return errorResponse(res, 'Bookmark not found', 404);
  return successResponse(res, null, 'Bookmark removed');
}));

// ── DELETE /api/users/bookmarks/prediction/:predictionId
router.delete('/bookmarks/prediction/:predictionId', asyncHandler(async (req, res) => {
  await db.query(
    'DELETE FROM bookmarks WHERE prediction_id = ? AND user_id = ?',
    [req.params.predictionId, req.user.id]
  );
  return successResponse(res, null, 'Bookmark removed');
}));

// ════════════════════════════════════════════════════════════════
// BET HISTORY
// ════════════════════════════════════════════════════════════════

// ── GET /api/users/bet-history
router.get('/bet-history', asyncHandler(async (req, res) => {
  const { result } = req.query;
  const { page, limit, offset } = parsePagination(req.query);

  let sql  = 'SELECT COUNT(*) as total FROM bet_history WHERE user_id = ?';
  const ca = [req.user.id];
  if (result && result !== 'all') { sql += ' AND result = ?'; ca.push(result); }

  const [[{ total }]] = await db.query(sql, ca);

  let qsql = `
    SELECT bh.*, p.home_team, p.away_team, p.slug,
           l.name as league_name
    FROM bet_history bh
    LEFT JOIN predictions p ON bh.prediction_id = p.id
    LEFT JOIN leagues l ON p.league_id = l.id
    WHERE bh.user_id = ?`;
  const qa = [req.user.id];
  if (result && result !== 'all') { qsql += ' AND bh.result = ?'; qa.push(result); }
  qsql += ' ORDER BY bh.created_at DESC LIMIT ? OFFSET ?';
  qa.push(limit, offset);

  const [rows] = await db.query(qsql, qa);

  return successResponse(res, {
    bets:       rows,
    pagination: paginate(parseInt(total), page, limit),
  });
}));

// ── POST /api/users/bet-history
router.post('/bet-history', validateBetHistory, asyncHandler(async (req, res) => {
  const { prediction_id, stake, odds, result, notes, currency } = req.body;

  const profit_loss = result && result !== 'pending'
    ? calculateProfitLoss(parseFloat(stake), parseFloat(odds), result)
    : null;

  const [ins] = await db.query(
    `INSERT INTO bet_history (user_id, prediction_id, stake, odds, result, profit_loss, currency, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.id,
      prediction_id || null,
      parseFloat(stake),
      parseFloat(odds),
      result || 'pending',
      profit_loss,
      currency || 'USD',
      notes ? sanitiseText(notes).slice(0, 500) : null,
    ]
  );

  return successResponse(res, { id: ins.insertId }, 'Bet logged successfully', 201);
}));

// ── PUT /api/users/bet-history/:id
router.put('/bet-history/:id', asyncHandler(async (req, res) => {
  const { stake, odds, result, notes, currency } = req.body;

  const [existing] = await db.query(
    'SELECT id FROM bet_history WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id]
  );
  if (!existing.length) return errorResponse(res, 'Bet not found', 404);

  const profit_loss = result && result !== 'pending' && stake && odds
    ? calculateProfitLoss(parseFloat(stake), parseFloat(odds), result)
    : null;

  await db.query(
    `UPDATE bet_history SET
       stake = COALESCE(?, stake),
       odds  = COALESCE(?, odds),
       result = COALESCE(?, result),
       profit_loss = ?,
       notes = COALESCE(?, notes),
       currency = COALESCE(?, currency),
       updated_at = NOW()
     WHERE id = ? AND user_id = ?`,
    [
      stake ? parseFloat(stake) : null,
      odds  ? parseFloat(odds)  : null,
      result || null,
      profit_loss,
      notes ? sanitiseText(notes).slice(0, 500) : null,
      currency || null,
      req.params.id,
      req.user.id,
    ]
  );

  return successResponse(res, null, 'Bet updated successfully');
}));

// ── DELETE /api/users/bet-history/:id
router.delete('/bet-history/:id', asyncHandler(async (req, res) => {
  const [result] = await db.query(
    'DELETE FROM bet_history WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id]
  );
  if (!result.affectedRows) return errorResponse(res, 'Bet not found', 404);
  return successResponse(res, null, 'Bet deleted');
}));

// ── GET /api/users/comments — User's comment history
router.get('/comments', asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const [rows] = await db.query(
    `SELECT c.id, c.content, c.created_at,
            p.home_team, p.away_team, p.slug
     FROM comments c
     JOIN predictions p ON c.prediction_id = p.id
     WHERE c.user_id = ?
     ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [req.user.id, limit, offset]
  );
  return successResponse(res, rows);
}));

module.exports = router;
