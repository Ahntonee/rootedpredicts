// routes/comments.js
// Rooted Predictions — Comments on prediction pages
// GET  /api/comments/:predictionId   — Get comments for a prediction
// POST /api/comments/:predictionId   — Post a comment (authenticated users)
// DELETE /api/comments/:id           — Delete own comment

'use strict';

const express  = require('express');
const router   = express.Router();
const db       = require('../config/db');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { asyncHandler, successResponse, errorResponse,
        sanitiseText, parsePagination } = require('../utils/helpers');

// ── GET /api/comments/:predictionId
router.get('/:predictionId', optionalAuth, asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);

  const [rows] = await db.query(
    `SELECT c.id, c.content, c.created_at,
            u.name as author_name, u.role as author_role
     FROM comments c
     JOIN users u ON c.user_id = u.id
     WHERE c.prediction_id = ? AND c.is_approved = 1
     ORDER BY c.created_at DESC
     LIMIT ? OFFSET ?`,
    [req.params.predictionId, limit, offset]
  );

  const [[{ total }]] = await db.query(
    'SELECT COUNT(*) as total FROM comments WHERE prediction_id = ? AND is_approved = 1',
    [req.params.predictionId]
  );

  return successResponse(res, { comments: rows, total: parseInt(total) });
}));

// ── POST /api/comments/:predictionId
router.post('/:predictionId', authenticate, asyncHandler(async (req, res) => {
  const { content } = req.body;

  if (!content || sanitiseText(content).length < 2) {
    return errorResponse(res, 'Comment content is required', 400);
  }

  const clean = sanitiseText(content).slice(0, 1000);

  // Verify prediction exists
  const [pred] = await db.query(
    'SELECT id FROM predictions WHERE id = ?', [req.params.predictionId]
  );
  if (!pred.length) return errorResponse(res, 'Prediction not found', 404);

  const [ins] = await db.query(
    'INSERT INTO comments (user_id, prediction_id, content) VALUES (?, ?, ?)',
    [req.user.id, req.params.predictionId, clean]
  );

  return successResponse(res, {
    id:          ins.insertId,
    content:     clean,
    author_name: req.user.name,
    author_role: req.user.role,
    created_at:  new Date().toISOString(),
  }, 'Comment posted', 201);
}));

// ── DELETE /api/comments/:id
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const [result] = await db.query(
    'DELETE FROM comments WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id]
  );
  if (!result.affectedRows) return errorResponse(res, 'Comment not found', 404);
  return successResponse(res, null, 'Comment deleted');
}));

module.exports = router;
