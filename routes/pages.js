// routes/pages.js — Static page content API
'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ─────────────────────────────────────────────
// ADMIN: GET /api/pages/admin/list — list all pages
// NOTE: specific routes must be declared before the /:slug wildcard
// ─────────────────────────────────────────────
router.get('/admin/list', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT slug, page_title, meta_description, hero_title, hero_subtitle, last_updated, content, extra, updated_at FROM static_pages ORDER BY id'
    );
    res.json({ success: true, pages: rows.map(p => {
      if (p.extra && typeof p.extra === 'string') { try { p.extra = JSON.parse(p.extra); } catch {} }
      return p;
    })});
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN: PUT /api/pages/admin/:slug — update a page
// ─────────────────────────────────────────────
router.put('/admin/:slug', authenticate, requireAdmin, async (req, res) => {
  const { slug } = req.params;
  const { page_title, meta_description, hero_title, hero_subtitle, last_updated, content, extra } = req.body;
  try {
    const extraStr = extra ? JSON.stringify(extra) : null;
    const [result] = await db.query(
      `UPDATE static_pages SET
         page_title=?, meta_description=?, hero_title=?, hero_subtitle=?,
         last_updated=?, content=?, extra=?
       WHERE slug=?`,
      [page_title, meta_description, hero_title, hero_subtitle || null,
       last_updated || null, content || null, extraStr, slug]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Page not found.' });
    res.json({ success: true, message: 'Page saved successfully.' });
  } catch (err) {
    console.error('[PAGES PUT]', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// PUBLIC: GET /api/pages/:slug — fetch a page (wildcard, must be last)
// ─────────────────────────────────────────────
router.get('/:slug', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT slug, page_title, meta_description, hero_title, hero_subtitle, last_updated, content, extra FROM static_pages WHERE slug = ?',
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Page not found.' });
    const page = rows[0];
    if (page.extra && typeof page.extra === 'string') { try { page.extra = JSON.parse(page.extra); } catch {} }
    res.json({ success: true, page });
  } catch (err) {
    console.error('[PAGES]', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
