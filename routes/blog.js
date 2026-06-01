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
  let sql  = `SELECT bp.id, bp.title, bp.slug, bp.excerpt, bp.featured_image,
       bp.category, bp.published_at, u.name as author_name
     FROM blog_posts bp LEFT JOIN users u ON bp.author_id = u.id
     WHERE bp.is_published = 1`;
  const args = [];
  if (category) { sql += ' AND bp.category = ?'; args.push(category); }
  if (search)   { sql += ' AND (bp.title LIKE ? OR bp.excerpt LIKE ?)'; args.push(`%${search}%`, `%${search}%`); }
  const [[{ total }]] = await db.query(sql.replace('SELECT bp.id', 'SELECT COUNT(*) as total').split('ORDER')[0], args);
  sql += ' ORDER BY bp.published_at DESC LIMIT ? OFFSET ?';
  args.push(limit, offset);
  const [posts] = await db.query(sql, args);
  return successResponse(res, { posts, pagination: paginate(parseInt(total), page, limit) });
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
