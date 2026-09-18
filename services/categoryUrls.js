'use strict';
const slugs = Object.freeze({
  banker: 'rooted-safe-tips',
  '1-5-goals': 'over-1-5-goals',
  '2-5-goals': 'over-2-5-goals',
  '3-5-goals': 'over-under-3-5-goals',
});
function publicSlug(category) { return slugs[category] || category; }
function categoryKey(slug) { return Object.keys(slugs).find(key => slugs[key] === slug) || slug; }
module.exports = { publicSlug, categoryKey };
