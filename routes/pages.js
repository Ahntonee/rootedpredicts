// routes/pages.js — Static page content API
'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { authenticate, requireAdmin, requireAdminRole } = require('../middleware/auth');
const { categories, categoryPage } = require('../services/categoryPages');
const fs = require('fs');
const path = require('path');
const hasText = content => typeof content === 'string' && content.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|\s/g, '').length > 0;
function preparePage(page) {
  const p = { ...page };
  if (p.extra && typeof p.extra === 'string') { try { p.extra = JSON.parse(p.extra); } catch { p.extra = null; } }
  if (p.slug === 'about' && !hasText(p.content)) {
    p.content = fs.readFileSync(path.join(__dirname, '../public/content/pages/about.html'), 'utf8');
  }
  return p;
}

// ─────────────────────────────────────────────
// ADMIN: GET /api/pages/admin/list — list all pages
// NOTE: specific routes must be declared before the /:slug wildcard
// ─────────────────────────────────────────────
router.get('/admin/list', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT slug, page_title, meta_description, hero_title, hero_subtitle, last_updated, content, extra, updated_at FROM static_pages ORDER BY id'
    );
    const pages = rows.filter(p => !p.slug.startsWith('category-')).map(preparePage);
    for (const slug of Object.keys(categories)) {
      const defaults = categoryPage(slug);
      const saved = rows.find(p => p.slug === defaults.slug);
      pages.push({ ...defaults, ...saved, kind: 'category', url: defaults.url, label: defaults.label });
    }
    res.json({ success: true, pages });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// ADMIN: PUT /api/pages/admin/:slug — update a page
// ─────────────────────────────────────────────
router.put('/admin/:slug', authenticate, requireAdmin, requireAdminRole('superadmin', 'editor'), async (req, res) => {
  const { slug } = req.params;
  const { page_title, meta_description, hero_title, hero_subtitle, last_updated, content, extra } = req.body;
  try {
    if (slug.startsWith('category-')) {
      const page = categoryPage(slug.slice(9));
      if (!page) return res.status(404).json({ success: false, message: 'Category not found.' });
      if (typeof content !== 'string') return res.status(400).json({ success: false, message: 'Article content is required.' });
      await db.query(`INSERT INTO static_pages (slug, page_title, content) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE content=VALUES(content)`, [slug, page.page_title, content]);
      return res.json({ success: true, message: 'Article saved successfully.' });
    }
    if (slug === 'about' && Object.hasOwn(req.body, 'content') && !hasText(content)) {
      return res.status(400).json({ success: false, message: 'About page content cannot be empty.' });
    }
    // Partial updates must not erase fields that were not submitted.
    const fields = ['page_title', 'meta_description', 'hero_title', 'hero_subtitle', 'last_updated', 'content', 'extra']
      .filter(field => Object.hasOwn(req.body, field));
    if (!fields.length) return res.status(400).json({ success: false, message: 'No changes supplied.' });
    const extraStr = extra ? JSON.stringify(extra) : null;
    const [result] = await db.query(
      `UPDATE static_pages SET ${fields.map(field => field + '=?').join(', ')} WHERE slug=?`,
      [...fields.map(field => field === 'extra' ? extraStr : (req.body[field] === '' && field === 'last_updated' ? null : req.body[field])), slug]
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
    const page = preparePage(rows[0]);
    res.json({ success: true, page });
  } catch (err) {
    console.error('[PAGES]', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
