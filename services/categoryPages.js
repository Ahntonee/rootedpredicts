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
  const [rows] = await db.query("SELECT slug, content FROM static_pages WHERE slug LIKE 'category-%'");
  return Object.fromEntries(rows.filter(p => Object.hasOwn(categories, p.slug.slice(9))).map(p => [p.slug.slice(9), p.content]));
}
function categoryPage(slug) {
  if (!Object.hasOwn(categories, slug)) return null;
  return { slug: 'category-' + slug, kind: 'category', label: categories[slug], url: '/predictions/' + slug,
    page_title: categories[slug] + ' SEO Article', content: article(slug) };
}
module.exports = { categories, dbCategories, renderArticles, loadArticleOverrides, categoryPage };
