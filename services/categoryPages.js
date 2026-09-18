// Shared category articles: edit public/content/categories/<category>.html.
'use strict';
const fs = require('fs');
const path = require('path');
const categories = {
  "free": "Free Pick",
  "1-5-goals": "Over 1.5",
  "2-5-goals": "Over/Under 2.5",
  "3-5-goals": "Over/Under 3.5",
  "acca": "Acca Tips",
  "away-win": "Away Win",
  "btts": "BTTS",
  "double-chance": "Double Chance",
  "home-win": "Home Win",
  "banker": "Rooted Safe Tips"
};
const dbCategories = { ...categories, '1-5-goals': '1.5 Goals', '2-5-goals': '2.5 Goals', '3-5-goals': '3.5 Goals', banker: 'Banker of the Day' };
function article(slug) {
  return fs.readFileSync(path.join(__dirname, '../public/content/categories', slug + '.html'), 'utf8');
}
function renderArticles(html, category, overrides = {}) {
  const content = slug => Object.hasOwn(overrides, slug) ? (overrides[slug] || '') : article(slug);
  html = html.replace(/<!-- category-article:([a-z0-9-]+) -->/g, (_, slug) => categories[slug] && (!category || slug === category) ? content(slug) : '');
  html = html.replace(/(<div class="seo-block" id="seo-[^"]+"[^>]*>)\s*(<\/div>)/g, '$1$2');
  return html.replace('<!-- home-category-articles -->', '<section class="seo-content-block"><h2>Prediction category guides</h2>' +
    Object.entries(categories).filter(([slug]) => content(slug).trim()).map(([slug, label]) => `<details><summary style="cursor:pointer;padding:12px 0;font-weight:700;">${label}</summary><a href="/predictions/${slug}">View ${label} predictions</a>${content(slug)}</details>`).join('') + '</section>');
}
async function loadArticleOverrides(db) {
  return Object.fromEntries(Object.entries(await loadCategoryOverrides(db)).map(([slug, p]) => [slug, p.content]));
}
async function loadCategoryOverrides(db) {
  const [rows] = await db.query("SELECT slug, page_title, meta_description, hero_title, hero_subtitle, content FROM static_pages WHERE slug LIKE 'category-%'");
  return Object.fromEntries(rows.filter(p => Object.hasOwn(categories, p.slug.slice(9))).map(p => [p.slug.slice(9), mergeCategoryPage(p.slug.slice(9), p)]));
}
function categoryPage(slug) {
  if (!Object.hasOwn(categories, slug)) return null;
  const meta = require('./categoryMetadata.json')[slug];
  return { slug: 'category-' + slug, kind: 'category', label: categories[slug], url: '/predictions/' + slug,
    page_title: meta.title, meta_description: meta.desc, hero_title: meta.h1, hero_subtitle: meta.sub, content: article(slug) };
}
function mergeCategoryPage(slug, saved = {}) {
  const defaults = categoryPage(slug);
  const page = { ...defaults, ...saved };
  // Older article-only records contain a placeholder title and null metadata.
  if (page.page_title === categories[slug] + ' SEO Article') page.page_title = defaults.page_title;
  for (const field of ['page_title', 'meta_description', 'hero_title', 'hero_subtitle']) {
    if (page[field] == null) page[field] = defaults[field];
  }
  return page;
}
module.exports = { categories, dbCategories, renderArticles, loadArticleOverrides, loadCategoryOverrides, categoryPage, mergeCategoryPage };
