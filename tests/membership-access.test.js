const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { attachMembership, maskPrediction } = require('../services/membership');

function loadRoutes(file, query) {
  const handlers = {};
  const router = { use() {} };
  for (const method of ['get', 'post', 'put', 'delete']) router[method] = (url, ...fns) => { handlers[method + url] = fns.at(-1); };
  const filename = path.resolve(__dirname, '..', file);
  const localRequire = createRequire(filename);
  const mocks = {
    express: { Router: () => router },
    '../config/db': { query },
    '../middleware/auth': {},
    '../services/recentForm': { fillRecentForm: async p => p },
    '../utils/helpers': { ...localRequire('../utils/helpers'), asyncHandler: fn => fn },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: { exports: {} }, require: id => mocks[id] || localRequire(id), console });
  return handlers;
}
async function call(handler, user, query = {}) {
  let body;
  const headers = {};
  await handler({ user, query, params: { slug: 'match' } }, { set(k,v) { headers[k] = v; }, status() { return this; }, json(v) { body = v; } });
  return { body, headers };
}

test('Active subscription determines membership even if the stored role is stale', async () => {
  for (const plan of ['standard', 'deluxe']) {
    const db = { query: async sql => sql.startsWith('SELECT plan') ? [[{ plan }]] : [{}] };
    const user = await attachMembership(db, { id: 4, role: 'user' });
    assert.equal(user.membership_tier, plan);
    assert.equal(user.role, 'vip');
  }
  const user = await attachMembership({ query: async sql => sql.startsWith('SELECT plan') ? [[]] : [{}] }, { id: 4, role: 'vip' });
  assert.equal(user.membership_tier, 'free');
  assert.equal(user.role, 'user');
});

const users = [null, { id: 4, role: 'user', membership_tier: 'free' }, { id: 4, role: 'vip', membership_tier: 'standard' }, { id: 4, role: 'vip', membership_tier: 'deluxe' }, { id: 4, role: 'admin' }];
for (const user of users) {
  for (const tier of ['free', 'standard', 'deluxe']) {
    test(`${user?.membership_tier || user?.role || 'guest'} access to ${tier}: listing, detail and bookmarks`, async () => {
      const p = { id: 8, access_tier: tier, visibility: tier === 'free' ? 'free' : 'vip', tip: 'Over 2.5', odds: 2, analysis: 'Private analysis', alt_tips: ['BTTS'], odds_data: { secret: 1 }, h2h_summary: 'Private', confidence_score: 95 };
      const allowed = tier === 'free' || user?.role === 'admin' || user?.membership_tier === 'deluxe' || (tier === 'standard' && user?.membership_tier === 'standard');
      const predictions = loadRoutes('routes/predictions.js', async sql => sql.includes('COUNT(*) as total') ? [[{ total: 1 }]] : sql.includes('comment_count') ? [[{ comment_count: 0 }]] : [[{ ...p }]]);
      const listing = await call(predictions['get/'], user);
      const detail = await call(predictions['get/:slug'], user);
      const bookmarks = loadRoutes('routes/users.js', async sql => sql.includes('COUNT(*)') ? [[{ total: 1 }]] : [[{ ...p }]]);
      const saved = await call(bookmarks['get/bookmarks'], user || { id: 4, role: 'user' });
      for (const actual of [listing.body.data.predictions[0], detail.body.data, saved.body.data.bookmarks[0]]) {
        assert.equal(actual.locked, !allowed);
        assert.equal(actual.tip, allowed ? p.tip : null);
        if (!allowed) for (const field of ['odds', 'analysis', 'alt_tips', 'odds_data', 'h2h_summary', 'confidence_score']) assert.equal(actual[field], null);
      }
      assert.match(detail.headers['Cache-Control'], /no-store/);
    });
  }
}

test('Profile returns the resolved plan and role used by the dashboard', async () => {
  const routes = loadRoutes('routes/users.js', async sql => sql.includes('FROM users') ? [[{ id: 4, role: 'user' }]] : [[{ plan: 'standard', status: 'active' }]]);
  const { body } = await call(routes['get/profile'], { id: 4, role: 'vip', membership_tier: 'standard' });
  assert.equal(body.data.membership_tier, 'standard');
  assert.equal(body.data.role, 'vip');
  assert.equal(body.data.subscription.plan, 'standard');
});

test('Legacy VIP tips are locked while explicitly free safe tips remain public', () => {
  assert.equal(maskPrediction({ visibility: 'vip' }, null).locked, true);
  assert.equal(maskPrediction({ visibility: 'vip', access_tier: 'free', category: 'Banker of the Day' }, null).locked, false);
  assert.equal(maskPrediction({ visibility: 'vip', access_tier: 'deluxe', category: 'Banker of the Day' }, null).locked, true);
});

test('Admin category edits preserve access; explicit tier changes control VIP visibility', async () => {
  const filename = path.resolve(__dirname, '../controllers/admin.js');
  const localRequire = createRequire(filename);
  const queries = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, console, require: id => id === '../config/db' ? { query: async (sql, args) => { queries.push({ sql, args }); return [{}]; } } : localRequire(id) });
  for (const tier of [undefined, 'standard', 'deluxe', 'free']) {
    queries.length = 0;
    let result;
    await module.exports.updatePrediction({ params: { id: 8 }, body: { category: 'BTTS', visibility: 'free', ...(tier ? { access_tier: tier } : {}) }, user: { id: 1 }, headers: {} }, { json(v) { result = v; }, status() { return this; } });
    assert.equal(result.success, true);
    const update = queries.find(q => q.sql.startsWith('UPDATE predictions'));
    if (!tier) { assert.doesNotMatch(update.sql, /access_tier=|visibility=/); }
    else {
      assert.match(update.sql, /access_tier=\?/);
      assert.equal(update.args[0], tier);
      assert.equal(update.args[2], tier === 'free' ? 'free' : 'vip');
    }
  }
});

test('Manual Standard and Deluxe grants persist the selected plan and replace old access', async () => {
  const filename = path.resolve(__dirname, '../controllers/subscriptions.js');
  const localRequire = createRequire(filename);
  const queries = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, console, process: { env: {} }, __dirname: path.dirname(filename), require: id => id === '../config/db' ? { query: async (sql, args) => { queries.push({ sql, args }); return sql.startsWith('SELECT id, role') ? [[{ id: 4, role: 'user' }]] : [{}]; } } : localRequire(id) });
  for (const plan of ['standard', 'deluxe']) {
    queries.length = 0;
    let result;
    await module.exports.adminGrantVip({ body: { user_id: 4, plan, duration: 'biweekly' } }, { json(v) { result = v; }, status() { return this; } });
    assert.equal(result.success, true);
    const insert = queries.find(q => q.sql.includes('INSERT INTO subscriptions'));
    assert.equal(insert.args[3], plan);
    assert.equal(insert.args[8] - insert.args[7], 14 * 86400000);
    assert.ok(queries.some(q => q.sql.includes("SET role='vip'")));
    assert.ok(queries.some(q => q.sql.includes("status IN ('active','trialing','cancelled')")));
  }
});
