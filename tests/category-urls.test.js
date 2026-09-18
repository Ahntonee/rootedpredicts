'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { publicSlug, categoryKey } = require('../services/categoryUrls');
const { categories } = require('../services/categoryPages');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const start = server.indexOf("app.get('/predictions/:category'");
const end = server.indexOf('\n});', start) + 4;
let handler;
vm.runInNewContext(server.slice(start, end), {
  app: { get: (route, fn) => { handler = fn; } }, publicSlug, categoryKey, categories,
  prerenderPage: req => req.params.category,
});
for (const [old, slug] of Object.entries({ banker: 'rooted-safe-tips', '1-5-goals': 'over-1-5-goals', '2-5-goals': 'over-2-5-goals', '3-5-goals': 'over-under-3-5-goals' })) {
  test(old + ' redirects permanently and new URL renders the same category', () => {
    let target;
    handler({ params: { category: old }, originalUrl: '/predictions/' + old + '?date=2026-09-18' }, {
      redirect: (status, url) => { assert.equal(status, 301); target = url; }
    });
    assert.equal(target, '/predictions/' + slug + '?date=2026-09-18');
    assert.equal(handler({ params: { category: slug } }, {}), old);
  });
}
test('Unchanged category URLs keep their existing content', () => {
  for (const key of ['free', 'btts', 'acca', 'away-win', 'home-win', 'double-chance']) {
    assert.equal(handler({ params: { category: key } }, {}), key);
  }
});
