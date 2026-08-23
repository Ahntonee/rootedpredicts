// routes/blog.js
// Rooted Predictions — Public blog routes
// GET /api/blog              — List published posts
// GET /api/blog/:slug        — Single post by slug
// GET /api/blog/categories   — Unique category list
'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { asyncHandler, successResponse, errorResponse, parsePagination, paginate } = require('../utils/helpers');

// GET /api/blog/categories
router.get('/categories', asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    `SELECT DISTINCT category, COUNT(*) as post_count
     FROM blog_posts WHERE is_published = 1 AND category IS NOT NULL
     GROUP BY category ORDER BY post_count DESC`
  );
  return successResponse(res, rows);
}));

// GET /api/blog
router.get('/', asyncHandler(async (req, res) => {
  const { category, search } = req.query;
  const { page, limit, offset } = parsePagination(req.query);
  let where = 'WHERE bp.is_published = 1';
  const args = [];
  if (category) { where += ' AND bp.category = ?'; args.push(category); }
  if (search)   { where += ' AND (bp.title LIKE ? OR bp.excerpt LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) as total FROM blog_posts bp ${where}`, args
  );
  const [posts] = await db.query(
    `SELECT bp.id, bp.title, bp.slug, bp.excerpt,
            CASE WHEN bp.featured_image IS NOT NULL THEN 1 ELSE 0 END as has_image,
            bp.category, bp.published_at, u.name as author_name
     FROM blog_posts bp LEFT JOIN users u ON bp.author_id = u.id
     ${where} ORDER BY bp.published_at DESC LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );
  return successResponse(res, { posts, pagination: paginate(parseInt(total), page, limit) });
}));

// GET /api/blog/:id/image — serve featured image (avoids sending base64 in listings)
router.get('/:id/image', asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    'SELECT featured_image FROM blog_posts WHERE id = ? AND is_published = 1', [req.params.id]
  );
  if (!rows.length || !rows[0].featured_image) return errorResponse(res, 'Not found', 404);
  const data = rows[0].featured_image;
  const match = data.match(/^data:([^;]+);base64,(.+)$/s);
  if (match) {
    const buf = Buffer.from(match[2], 'base64');
    res.set('Content-Type', match[1]);
    res.set('Cache-Control', 'public, max-age=2592000');
    return res.send(buf);
  }
  res.redirect(data);
}));

// GET /api/blog/:slug
router.get('/:slug', asyncHandler(async (req, res) => {
  const [rows] = await db.query(
    `SELECT bp.*, u.name as author_name FROM blog_posts bp
     LEFT JOIN users u ON bp.author_id = u.id
     WHERE bp.slug = ? AND bp.is_published = 1`, [req.params.slug]
  );
  if (!rows.length) return errorResponse(res, 'Post not found', 404);
  return successResponse(res, rows[0]);
}));

module.exports = router;
