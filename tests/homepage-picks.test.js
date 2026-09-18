'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectHomepagePick } = require('../services/homepagePicks');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

test('Public homepage is capped at ten while category results keep independent pagination', async () => {
  const filename = path.join(__dirname, '../routes/predictions.js');
  const localRequire = createRequire(filename);
  const handlers = {}, queries = [];
  const router = { get: (url, ...fns) => { handlers[url] = fns.at(-1); } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: { exports: {} }, console,
    require: id => id === 'express' ? { Router: () => router }
      : id === '../middleware/auth' ? {}
      : id === '../config/db' ? { query: async (sql, args) => { queries.push({ sql, args }); return sql.includes('COUNT(*)') ? [[{ total: 30 }]] : [[]]; } }
      : localRequire(id)
  });
  let response;
  const res = { set() {}, status() { return this; }, json(value) { response = value; } };
  await handlers['/']({ query: { homepage: '1', limit: '100', date: '2026-09-18' } }, res, error => { throw error; });
  // asyncHandler returns the handler promise.
  const home = queries.find(q => q.sql.includes('LIMIT ?'));
  assert.ok(home);
  assert.deepEqual(Array.from(home.args.slice(-2)), [10, 0]);
  assert.match(home.sql, /homepage_picks/);
  queries.length = 0;
  await handlers['/']({ query: { category: 'btts', limit: '100', date: '2026-09-18' } }, res, error => { throw error; });
  const category = queries.find(q => q.sql.includes('LIMIT ?'));
  assert.deepEqual(Array.from(category.args.slice(-2)), [100, 0]);
  assert.ok(category.args.includes('BTTS'));
  assert.ok(!category.sql.includes('homepage_picks'));
  for (const [page, requestedLimit, expectedLimit, expectedOffset, hasNext] of [[1,100,20,0,false],[1,15,15,0,true],[2,15,5,15,false],[3,15,0,30,false]]) {
    queries.length = 0;
    await handlers['/']({ query: { category: 'free', page: String(page), limit: String(requestedLimit), date: '2026-09-18' } }, res, error => { throw error; });
    const free = queries.find(q => q.sql.includes('LIMIT ?'));
    assert.deepEqual(Array.from(free.args.slice(-2)), [expectedLimit, expectedOffset]);
    assert.match(free.sql, /ORDER BY EXISTS .*homepage_picks/s);
    assert.match(free.sql, /p.access_tier='free'/);
    assert.ok(!free.sql.includes("= 'Free Pick'"));
    assert.equal(response.data.pagination.total, 20);
    assert.equal(response.data.pagination.hasNext, hasNext);
  }
});

function database(count = 0, overrides = {}) {
  const slots = new Map(Array.from({ length: count }, (_, i) => [i + 1, i + 1]));
  const calls = [];
  let snapshot;
  const connection = {
    beginTransaction: async () => { snapshot = new Map(slots); },
    commit: async () => calls.push('commit'),
    rollback: async () => { slots.clear(); for (const entry of snapshot) slots.set(...entry); calls.push('rollback'); },
    release: () => calls.push('release'),
    query: async (sql, args) => {
      calls.push(sql);
      if (sql.startsWith('SELECT')) return [[{ id: 99, published_at: '2026-09-18', result: 'pending', access_tier: 'free', visibility: 'free', pick_date: '2026-09-18', ...overrides }]];
      if (sql.startsWith('DELETE FROM')) for (const [slot, id] of slots) if (id === args[0]) slots.delete(slot);
      if (sql.startsWith('INSERT')) {
        if (slots.has(args[1])) throw Object.assign(new Error('Duplicate slot'), { code: 'ER_DUP_ENTRY' });
        slots.set(args[1], args[2]);
      }
      return [{}];
    },
  };
  return { slots, calls, query: connection.query, getConnection: async () => connection };
}
test('Admin can select the tenth pick but the eleventh is rejected without unpublishing it', async () => {
  const db = database(9);
  await selectHomepagePick(db, 99, true);
  assert.equal(db.slots.size, 10);
  await assert.rejects(selectHomepagePick(db, 100, true), /already has 10/);
  assert.equal(db.slots.size, 10);
  assert.ok(!db.calls.some(sql => sql.startsWith('UPDATE predictions')));
});
test('Removing a homepage pick frees a slot and leaves its category and publication intact', async () => {
  const db = database(10);
  await selectHomepagePick(db, 1, false);
  await selectHomepagePick(db, 99, true);
  assert.equal(db.slots.size, 10);
  assert.ok([...db.slots.values()].includes(99));
  assert.ok(!db.calls.some(sql => sql.startsWith('UPDATE predictions')));
});
test('Unpublished, void and paid predictions cannot be selected', async () => {
  for (const overrides of [{ published_at: null }, { result: 'void' }, { access_tier: 'standard' }, { access_tier: 'deluxe' }]) {
    const db = database(0, overrides);
    await assert.rejects(selectHomepagePick(db, 99, true), /Only published free/);
    assert.equal(db.slots.size, 0);
    assert.ok(db.calls.includes('rollback'));
  }
});
