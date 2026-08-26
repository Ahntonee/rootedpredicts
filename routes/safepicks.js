'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler, successResponse, errorResponse } = require('../utils/helpers');

// ── GET /api/safe-picks  (public) — list published safe picks ─────────────────
router.get('/', asyncHandler(async (req, res) => {
  const { date, limit = 10 } = req.query;
  const useDate = date || new Date().toISOString().split('T')[0];
  const [rows] = await db.query(
    `SELECT id, title, description, valid_for, legs, combined_odds, min_confidence, stake_suggestion, published_at
     FROM safe_picks
     WHERE is_published = 1 AND valid_for = ?
     ORDER BY published_at DESC
     LIMIT ?`,
    [useDate, parseInt(limit)]
  );
  const picks = rows.map(r => ({
    ...r,
    legs: typeof r.legs === 'string' ? JSON.parse(r.legs) : r.legs,
  }));
  return successResponse(res, picks);
}));

// ── GET /api/safe-picks/all  (admin) — all picks incl. drafts ─────────────────
router.get('/all', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { date } = req.query;
  let sql = `SELECT sp.*, u.username AS created_by_name
             FROM safe_picks sp
             LEFT JOIN users u ON u.id = sp.created_by
             ORDER BY sp.valid_for DESC, sp.created_at DESC
             LIMIT 50`;
  const args = [];
  if (date) {
    sql = `SELECT sp.*, u.username AS created_by_name
           FROM safe_picks sp
           LEFT JOIN users u ON u.id = sp.created_by
           WHERE sp.valid_for = ?
           ORDER BY sp.created_at DESC`;
    args.push(date);
  }
  const [rows] = await db.query(sql, args);
  const picks = rows.map(r => ({
    ...r,
    legs: typeof r.legs === 'string' ? JSON.parse(r.legs) : r.legs,
  }));
  return successResponse(res, picks);
}));

// ── POST /api/safe-picks  (admin) — create ───────────────────────────────────
router.post('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { title, description, valid_for, legs, stake_suggestion, is_published } = req.body;
  if (!title || !valid_for || !Array.isArray(legs) || !legs.length) {
    return errorResponse(res, 'title, valid_for and at least one leg are required', 400);
  }

  const combinedOdds = legs.reduce((acc, l) => acc * parseFloat(l.odds || 1), 1);
  const minConf = legs.length ? Math.min(...legs.map(l => l.confidence_score || 0)) : null;
  const publish = is_published ? 1 : 0;
  const publishedAt = publish ? new Date() : null;

  const [result] = await db.query(
    `INSERT INTO safe_picks (title, description, valid_for, legs, combined_odds, min_confidence, stake_suggestion, is_published, published_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title, description || null, valid_for,
      JSON.stringify(legs),
      parseFloat(combinedOdds.toFixed(2)),
      minConf, stake_suggestion || null,
      publish, publishedAt,
      req.user.id,
    ]
  );
  return successResponse(res, { id: result.insertId }, 201);
}));

// ── PUT /api/safe-picks/:id  (admin) — update ────────────────────────────────
router.put('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { title, description, valid_for, legs, stake_suggestion, is_published } = req.body;
  const id = parseInt(req.params.id);
  const [[existing]] = await db.query('SELECT id, is_published FROM safe_picks WHERE id = ?', [id]);
  if (!existing) return errorResponse(res, 'Safe pick not found', 404);

  const updates = [], args = [];
  if (title       !== undefined) { updates.push('title=?');           args.push(title); }
  if (description !== undefined) { updates.push('description=?');     args.push(description || null); }
  if (valid_for   !== undefined) { updates.push('valid_for=?');       args.push(valid_for); }
  if (stake_suggestion !== undefined) { updates.push('stake_suggestion=?'); args.push(stake_suggestion || null); }
  if (Array.isArray(legs) && legs.length) {
    const co = legs.reduce((a, l) => a * parseFloat(l.odds || 1), 1);
    updates.push('legs=?', 'combined_odds=?', 'min_confidence=?');
    args.push(JSON.stringify(legs), parseFloat(co.toFixed(2)), Math.min(...legs.map(l => l.confidence_score || 0)));
  }
  if (is_published !== undefined) {
    updates.push('is_published=?');
    args.push(is_published ? 1 : 0);
    if (is_published && !existing.is_published) {
      updates.push('published_at=?');
      args.push(new Date());
    }
  }

  if (!updates.length) return errorResponse(res, 'Nothing to update', 400);
  updates.push('updated_at=NOW()');
  args.push(id);
  await db.query(`UPDATE safe_picks SET ${updates.join(',')} WHERE id=?`, args);
  return successResponse(res, { updated: true });
}));

// ── DELETE /api/safe-picks/:id  (admin) ──────────────────────────────────────
router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  await db.query('DELETE FROM safe_picks WHERE id = ?', [id]);
  return successResponse(res, { deleted: true });
}));

module.exports = router;
