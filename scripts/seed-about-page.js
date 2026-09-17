'use strict';
/**
 * Updates the About page content in the static_pages table.
 * Run on the server: node scripts/seed-about-page.js
 */
const db = require('../config/db');

const content = require('fs').readFileSync(require('path').join(__dirname, '../public/content/pages/about.html'), 'utf8');

const slug        = 'about';
const page_title  = 'About Rooted Predictions — Trusted Football Prediction Platform';
const meta_desc   = 'Learn about Rooted Predictions — a global football prediction platform offering free and VIP tips across 1,200+ leagues, powered by data analysis and AI-assisted research.';
const hero_title  = 'Built for Punters. Powered by Data.';
const hero_sub    = 'Rooted Predictions delivers free and VIP football tips across 1,200+ leagues worldwide, backed by structured research, not guesswork.';
const last_updated = '2026-06-17';

(async () => {
  try {
    const [result] = await db.query(
      `UPDATE static_pages
         SET page_title=?, meta_description=?, hero_title=?, hero_subtitle=?, last_updated=?, content=?, extra=NULL
       WHERE slug=?`,
      [page_title, meta_desc, hero_title, hero_sub, last_updated, content.trim(), slug]
    );
    if (result.affectedRows === 0) {
      await db.query(
        `INSERT INTO static_pages (slug, page_title, meta_description, hero_title, hero_subtitle, last_updated, content)
         VALUES (?,?,?,?,?,?,?)`,
        [slug, page_title, meta_desc, hero_title, hero_sub, last_updated, content.trim()]
      );
      console.log('About page INSERTED successfully.');
    } else {
      console.log('About page UPDATED successfully.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit();
  }
})();
