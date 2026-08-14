// controllers/marketing.js
// Rooted Predictions — SEO Pages, Backlinks, Ads, Announcements
'use strict';

const db = require('../config/db');
const slugify = require('slugify');
const { successResponse, errorResponse } = require('../utils/helpers');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSlug(title) {
  return slugify(title, { lower: true, strict: true, trim: true });
}

async function expireStaleBacklinks() {
  await db.query(
    `UPDATE backlinks SET status = 'expired'
     WHERE status = 'active' AND expires_at <= NOW()`
  );
}

// ── SEO PAGES ────────────────────────────────────────────────────────────────

async function listSeoPages(req, res) {
  const [rows] = await db.query(
    `SELECT id, title, slug, status, meta_description, created_at, updated_at
     FROM seo_pages ORDER BY created_at DESC`
  );
  return successResponse(res, rows);
}

async function getSeoPage(req, res) {
  const id = parseInt(req.params.id);
  const [[row]] = await db.query('SELECT * FROM seo_pages WHERE id = ?', [id]);
  if (!row) return errorResponse(res, 'SEO page not found', 404);
  return successResponse(res, row);
}

async function createSeoPage(req, res) {
  const { title, meta_description, meta_keywords, content, status, source_blog_id } = req.body;
  if (!title || !title.trim()) return errorResponse(res, 'Title is required', 400);

  let slug = makeSlug(title);
  // ensure uniqueness
  const [[existing]] = await db.query('SELECT id FROM seo_pages WHERE slug = ?', [slug]);
  if (existing) slug = `${slug}-${Date.now()}`;

  const [result] = await db.query(
    `INSERT INTO seo_pages (title, slug, meta_description, meta_keywords, content, status, source_blog_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [title.trim(), slug, meta_description || null, meta_keywords || null,
     content || null, status || 'draft', source_blog_id || null]
  );
  const [[created]] = await db.query('SELECT * FROM seo_pages WHERE id = ?', [result.insertId]);
  return successResponse(res, created, 'SEO page created', 201);
}

async function updateSeoPage(req, res) {
  const id = parseInt(req.params.id);
  const { title, meta_description, meta_keywords, content, status } = req.body;
  if (!title || !title.trim()) return errorResponse(res, 'Title is required', 400);

  const [[existing]] = await db.query('SELECT id FROM seo_pages WHERE id = ?', [id]);
  if (!existing) return errorResponse(res, 'SEO page not found', 404);

  await db.query(
    `UPDATE seo_pages SET title=?, meta_description=?, meta_keywords=?, content=?, status=? WHERE id=?`,
    [title.trim(), meta_description || null, meta_keywords || null, content || null, status || 'draft', id]
  );
  const [[updated]] = await db.query('SELECT * FROM seo_pages WHERE id = ?', [id]);
  return successResponse(res, updated, 'SEO page updated');
}

async function deleteSeoPage(req, res) {
  const id = parseInt(req.params.id);
  const [result] = await db.query('DELETE FROM seo_pages WHERE id = ?', [id]);
  if (!result.affectedRows) return errorResponse(res, 'SEO page not found', 404);
  return successResponse(res, null, 'SEO page deleted');
}

async function getBlogPostsForImport(req, res) {
  const [rows] = await db.query(
    `SELECT id, title, slug, content, meta_description FROM blog_posts
     WHERE is_published = 1 ORDER BY published_at DESC LIMIT 100`
  );
  return successResponse(res, rows);
}

// ── BACKLINKS ─────────────────────────────────────────────────────────────────

async function listBacklinks(req, res) {
  await expireStaleBacklinks();
  const [rows] = await db.query(
    `SELECT * FROM backlinks ORDER BY status ASC, expires_at ASC`
  );
  return successResponse(res, rows);
}

async function getActiveBacklinks(req, res) {
  await expireStaleBacklinks();
  const [rows] = await db.query(
    `SELECT id, name, url FROM backlinks WHERE status = 'active' ORDER BY created_at ASC`
  );
  return successResponse(res, rows);
}

async function createBacklink(req, res) {
  const { name, url, expires_at } = req.body;
  if (!name || !url || !expires_at) return errorResponse(res, 'name, url, and expires_at are required', 400);
  const expiry = new Date(expires_at);
  if (isNaN(expiry.getTime())) return errorResponse(res, 'Invalid expires_at date', 400);

  const status = expiry > new Date() ? 'active' : 'expired';
  const [result] = await db.query(
    `INSERT INTO backlinks (name, url, expires_at, status) VALUES (?, ?, ?, ?)`,
    [name.trim(), url.trim(), expiry, status]
  );
  const [[created]] = await db.query('SELECT * FROM backlinks WHERE id = ?', [result.insertId]);
  return successResponse(res, created, 'Backlink created', 201);
}

async function updateBacklink(req, res) {
  const id = parseInt(req.params.id);
  const { name, url, expires_at } = req.body;
  if (!name || !url || !expires_at) return errorResponse(res, 'name, url, and expires_at are required', 400);
  const expiry = new Date(expires_at);
  if (isNaN(expiry.getTime())) return errorResponse(res, 'Invalid expires_at date', 400);

  const status = expiry > new Date() ? 'active' : 'expired';
  const [result] = await db.query(
    `UPDATE backlinks SET name=?, url=?, expires_at=?, status=? WHERE id=?`,
    [name.trim(), url.trim(), expiry, status, id]
  );
  if (!result.affectedRows) return errorResponse(res, 'Backlink not found', 404);
  const [[updated]] = await db.query('SELECT * FROM backlinks WHERE id = ?', [id]);
  return successResponse(res, updated, 'Backlink updated');
}

async function renewBacklink(req, res) {
  const id = parseInt(req.params.id);
  const { expires_at } = req.body;
  if (!expires_at) return errorResponse(res, 'expires_at is required', 400);
  const expiry = new Date(expires_at);
  if (isNaN(expiry.getTime())) return errorResponse(res, 'Invalid expires_at date', 400);

  const status = expiry > new Date() ? 'active' : 'expired';
  const [result] = await db.query(
    `UPDATE backlinks SET expires_at=?, status=? WHERE id=?`,
    [expiry, status, id]
  );
  if (!result.affectedRows) return errorResponse(res, 'Backlink not found', 404);
  const [[updated]] = await db.query('SELECT * FROM backlinks WHERE id = ?', [id]);
  return successResponse(res, updated, 'Backlink renewed');
}

async function deleteBacklink(req, res) {
  const id = parseInt(req.params.id);
  const [result] = await db.query('DELETE FROM backlinks WHERE id = ?', [id]);
  if (!result.affectedRows) return errorResponse(res, 'Backlink not found', 404);
  return successResponse(res, null, 'Backlink deleted');
}

// ── ADS ───────────────────────────────────────────────────────────────────────

async function listAds(req, res) {
  const [rows] = await db.query(
    `SELECT id, name, type, link_url, placement, status, impressions, clicks, created_at, updated_at
     FROM ads ORDER BY created_at DESC`
  );
  return successResponse(res, rows);
}

async function getAd(req, res) {
  const id = parseInt(req.params.id);
  const [[row]] = await db.query('SELECT * FROM ads WHERE id = ?', [id]);
  if (!row) return errorResponse(res, 'Ad not found', 404);
  return successResponse(res, row);
}

async function getAdsByPlacement(req, res) {
  const placement = req.params.placement;
  const [rows] = await db.query(
    `SELECT id, name, type, content, image_data, link_url, placement
     FROM ads WHERE status = 'active'`
  );
  // Filter in JS so we can parse the JSON placement array
  const matched = rows.filter(ad => {
    try {
      const placements = Array.isArray(ad.placement) ? ad.placement : JSON.parse(ad.placement || '[]');
      return placements.includes(placement) || placements.includes('all');
    } catch (_) { return false; }
  });
  return successResponse(res, matched);
}

async function createAd(req, res) {
  const { name, type, content, image_data, link_url, placement, status } = req.body;
  if (!name || !type) return errorResponse(res, 'name and type are required', 400);
  if (!['banner', 'code', 'text'].includes(type)) return errorResponse(res, 'Invalid ad type', 400);

  const placementJson = JSON.stringify(
    Array.isArray(placement) ? placement : (placement ? [placement] : ['all'])
  );

  const [result] = await db.query(
    `INSERT INTO ads (name, type, content, image_data, link_url, placement, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name.trim(), type, content || null, image_data || null,
     link_url || null, placementJson, status || 'active']
  );
  const [[created]] = await db.query(
    `SELECT id, name, type, link_url, placement, status, impressions, clicks, created_at FROM ads WHERE id = ?`,
    [result.insertId]
  );
  return successResponse(res, created, 'Ad created', 201);
}

async function updateAd(req, res) {
  const id = parseInt(req.params.id);
  const { name, type, content, image_data, link_url, placement, status } = req.body;
  if (!name || !type) return errorResponse(res, 'name and type are required', 400);

  const placementJson = JSON.stringify(
    Array.isArray(placement) ? placement : (placement ? [placement] : ['all'])
  );

  const [result] = await db.query(
    `UPDATE ads SET name=?, type=?, content=?, image_data=?, link_url=?, placement=?, status=? WHERE id=?`,
    [name.trim(), type, content || null, image_data || null,
     link_url || null, placementJson, status || 'active', id]
  );
  if (!result.affectedRows) return errorResponse(res, 'Ad not found', 404);
  const [[updated]] = await db.query(
    `SELECT id, name, type, link_url, placement, status, impressions, clicks, created_at FROM ads WHERE id = ?`,
    [id]
  );
  return successResponse(res, updated, 'Ad updated');
}

async function toggleAd(req, res) {
  const id = parseInt(req.params.id);
  const [[ad]] = await db.query('SELECT id, status FROM ads WHERE id = ?', [id]);
  if (!ad) return errorResponse(res, 'Ad not found', 404);
  const next = ad.status === 'active' ? 'inactive' : 'active';
  await db.query('UPDATE ads SET status=? WHERE id=?', [next, id]);
  return successResponse(res, { status: next }, `Ad ${next}`);
}

async function deleteAd(req, res) {
  const id = parseInt(req.params.id);
  const [result] = await db.query('DELETE FROM ads WHERE id = ?', [id]);
  if (!result.affectedRows) return errorResponse(res, 'Ad not found', 404);
  return successResponse(res, null, 'Ad deleted');
}

async function trackImpression(req, res) {
  const id = parseInt(req.params.id);
  await db.query('UPDATE ads SET impressions = impressions + 1 WHERE id = ?', [id]);
  return successResponse(res, null);
}

async function trackClick(req, res) {
  const id = parseInt(req.params.id);
  const [[ad]] = await db.query('SELECT link_url FROM ads WHERE id = ?', [id]);
  await db.query('UPDATE ads SET clicks = clicks + 1 WHERE id = ?', [id]);
  if (ad && ad.link_url) {
    return res.redirect(302, ad.link_url);
  }
  return res.status(204).send();
}

// ── ANNOUNCEMENTS ─────────────────────────────────────────────────────────────

async function listAnnouncements(req, res) {
  const [rows] = await db.query(
    `SELECT * FROM announcements ORDER BY created_at DESC`
  );
  return successResponse(res, rows);
}

async function getActiveAnnouncements(req, res) {
  const [rows] = await db.query(
    `SELECT id, title, message, type, published_at, expires_at
     FROM announcements
     WHERE status = 'published'
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY published_at DESC`
  );
  return successResponse(res, rows);
}

async function createAnnouncement(req, res) {
  const { title, message, type, status, expires_at } = req.body;
  if (!title || !message) return errorResponse(res, 'title and message are required', 400);

  const annType = ['info', 'success', 'warning', 'alert'].includes(type) ? type : 'info';
  const annStatus = status === 'published' ? 'published' : 'draft';
  const publishedAt = annStatus === 'published' ? new Date() : null;
  const expiresAt = expires_at ? new Date(expires_at) : null;

  const [result] = await db.query(
    `INSERT INTO announcements (title, message, type, status, published_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [title.trim(), message.trim(), annType, annStatus, publishedAt, expiresAt]
  );
  const [[created]] = await db.query('SELECT * FROM announcements WHERE id = ?', [result.insertId]);
  return successResponse(res, created, 'Announcement created', 201);
}

async function updateAnnouncement(req, res) {
  const id = parseInt(req.params.id);
  const { title, message, type, status, expires_at } = req.body;
  if (!title || !message) return errorResponse(res, 'title and message are required', 400);

  const [[existing]] = await db.query('SELECT id, status FROM announcements WHERE id = ?', [id]);
  if (!existing) return errorResponse(res, 'Announcement not found', 404);

  const annType = ['info', 'success', 'warning', 'alert'].includes(type) ? type : 'info';
  const annStatus = status === 'published' ? 'published' : 'draft';
  const publishedAt = annStatus === 'published' && existing.status !== 'published'
    ? new Date() : (annStatus === 'published' ? undefined : null);
  const expiresAt = expires_at ? new Date(expires_at) : null;

  if (publishedAt !== undefined) {
    await db.query(
      `UPDATE announcements SET title=?, message=?, type=?, status=?, published_at=?, expires_at=? WHERE id=?`,
      [title.trim(), message.trim(), annType, annStatus, publishedAt, expiresAt, id]
    );
  } else {
    await db.query(
      `UPDATE announcements SET title=?, message=?, type=?, status=?, expires_at=? WHERE id=?`,
      [title.trim(), message.trim(), annType, annStatus, expiresAt, id]
    );
  }

  const [[updated]] = await db.query('SELECT * FROM announcements WHERE id = ?', [id]);
  return successResponse(res, updated, 'Announcement updated');
}

async function publishAnnouncement(req, res) {
  const id = parseInt(req.params.id);
  const [result] = await db.query(
    `UPDATE announcements SET status='published', published_at=NOW() WHERE id=?`, [id]
  );
  if (!result.affectedRows) return errorResponse(res, 'Announcement not found', 404);
  return successResponse(res, null, 'Announcement published');
}

async function deleteAnnouncement(req, res) {
  const id = parseInt(req.params.id);
  const [result] = await db.query('DELETE FROM announcements WHERE id = ?', [id]);
  if (!result.affectedRows) return errorResponse(res, 'Announcement not found', 404);
  return successResponse(res, null, 'Announcement deleted');
}

module.exports = {
  // SEO pages
  listSeoPages, getSeoPage, createSeoPage, updateSeoPage, deleteSeoPage, getBlogPostsForImport,
  // Backlinks
  listBacklinks, getActiveBacklinks, createBacklink, updateBacklink, renewBacklink, deleteBacklink,
  // Ads
  listAds, getAd, getAdsByPlacement, createAd, updateAd, toggleAd, deleteAd, trackImpression, trackClick,
  // Announcements
  listAnnouncements, getActiveAnnouncements, createAnnouncement, updateAnnouncement, publishAnnouncement, deleteAnnouncement,
};
