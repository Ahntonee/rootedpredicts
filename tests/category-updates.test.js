'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: id => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id),
    module, exports: module.exports, console, process, Date, Map, setTimeout,
  }, { filename });
  return module.exports;
}

test('budget survives midnight and restart; concurrent calls cannot overspend', async () => {
  let saved;
  const db = { query: async (sql, args) => {
    if (sql.startsWith('CREATE')) return [];
    if (sql.includes('ORDER BY')) return [[{ request_count: 2498 }]];
    if (sql.startsWith('INSERT')) { saved ??= args[1]; return []; }
    if (sql.startsWith('SELECT')) return [[{ request_count: saved }]];
    if (sql.includes('GREATEST')) { saved = Math.max(saved, args[0]); return []; }
    const allowed = saved < args[1];
    if (allowed) saved++;
    return [{ affectedRows: Number(allowed) }];
  } };
  const counter = load('services/apiCounter.js', { '../config/db': db });
  assert.equal(await counter.getCount(), 2498);
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => counter.increment(2500)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
  assert.equal(await load('services/apiCounter.js', { '../config/db': db }).getCount(), 2500);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'services/apiCounter.js'), 'utf8'), /new Date|todayKey|checkReset/);
});

test('scheduler registers no provider API jobs', () => {
  const jobs = [];
  const scheduler = load('services/scheduler.js', {
    'node-cron': { schedule: (_, fn) => jobs.push(fn.name) },
    '../config/db': {}, './apiFootball': {}, './confidence': {}, './accuracy': {},
  });
  scheduler.startScheduler();
  assert.equal(jobs.length, 4);
  assert.ok(jobs.every(name => !['runDailySync', 'runResultsSync', 'runLiveSync', 'runTodayScores'].includes(name)));
});

test('guest Safe Tips and detail data are public; other VIP tips stay locked', async () => {
  const handlers = {};
  let category = 'Banker of the Day';
  const prediction = () => ({ id: 7, slug: 'test-match', category, visibility: 'vip', tip: 'Over 1.5', odds: 1.3, analysis: 'Saved analysis', home_team: 'Home', away_team: 'Away' });
  const db = { query: async sql => {
    if (sql.includes('comment_count')) return [[{ comment_count: 0 }]];
    if (sql.includes('COUNT(*) as total')) return [[{ total: 1 }]];
    if (sql.includes('home_score IS NOT NULL')) return [[]];
    return [[prediction()]];
  } };
  load('routes/predictions.js', {
    express: { Router: () => ({ get: (url, ...fns) => { handlers[url] = fns.at(-1); } }) },
    '../config/db': db,
    '../middleware/auth': { optionalAuth: () => {} },
    '../services/apiFootball': new Proxy({}, { get: () => { throw new Error('Public API call forbidden'); } }),
  });
  async function invoke(url, query = {}) {
    let body;
    const res = { set() { return this; }, status() { return this; }, json(value) { body = value; } };
    await handlers[url]({ query, params: { slug: '7' } }, res, error => { throw error; });
    return body.data;
  }
  assert.equal((await invoke('/', { category: 'banker' })).predictions[0].locked, false);
  assert.equal((await invoke('/:slug')).analysis, 'Saved analysis');
  assert.equal((await invoke('/:slug/extras')).standings, null);
  category = 'BTTS';
  assert.equal((await invoke('/')).predictions[0].tip, null);
  assert.equal((await invoke('/:slug')).locked, true);
});

test('all ten category pages have shared articles, navigation and server metadata', async () => {
  const shared = require('../services/categoryPages');
  const metadata = require('../services/categoryMetadata.json');
  const template = fs.readFileSync(path.join(root, 'public/predictions.html'), 'utf8');
  const home = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const start = source.indexOf('function renderCategoryMeta(');
  const end = source.indexOf("app.get(['/', '/index.html']", start);
  const render = vm.runInNewContext(source.slice(start, end) + '\nrenderCategoryMeta', {
    categoryMetadata: metadata, process: { env: {} }, escHtml: s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
  });
  for (const slug of Object.keys(shared.categories)) {
    const article = fs.readFileSync(path.join(root, 'public/content/categories', slug + '.html'), 'utf8');
    assert.ok(shared.renderArticles(home).includes(article));
    const html = render(shared.renderArticles(template, slug), slug);
    assert.ok(html.includes(article));
    assert.ok(html.includes('href="https://www.rootedpredict.com/predictions/' + slug + '"'));
    assert.ok(html.includes('<title id="page-title">' + metadata[slug].title + '</title>'));
    assert.ok(home.includes('href="/predictions/' + slug + '"'));
    assert.ok(template.includes('href="/predictions/' + slug + '"'));
  }
  assert.ok(source.includes("...Object.keys(categories).map(category => ({ url: '/predictions/' + category"));
});

test('modified browser scripts parse and match cards link to saved details', () => {
  for (const file of ['public/index.html', 'public/predictions.html', 'public/prediction-detail.html', 'public/admin/sync.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (!/application\/ld\+json/.test(match[1])) new vm.Script(match[2], { filename: file });
    }
    if (file === 'public/index.html' || file === 'public/predictions.html') {
      assert.ok(html.includes('class="match-card" href="/prediction/${encodeURIComponent(p.slug || p.id)}"'));
      assert.doesNotMatch(html, /<button class="cat-tab/);
    }
  }
});

test('homepage caps picks at 15; prediction listing follows every database page', async () => {
  const home = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.ok(home.includes("limit: '15'"));
  assert.ok(home.includes('buildPicksHTML(preds.slice(0, 15))'));
  assert.ok(home.includes('href="/predictions/free" class="btn btn-outline btn-sm">View All Predictions'));
  assert.ok(server.includes("${file === 'index.html' ? 'LIMIT 15' : ''}"));
  const html = fs.readFileSync(path.join(root, 'public/predictions.html'), 'utf8');
  const start = html.indexOf('  async function fetchAllPredictions(');
  const end = html.indexOf('  function loadPicks()', start);
  const calls = [];
  const fetchAll = vm.runInNewContext(html.slice(start, end) + '\nfetchAllPredictions', {
    URL, window: { location: { origin: 'https://example.test' } },
    fetch: async url => {
      calls.push(url.toString());
      const page = Number(url.searchParams.get('page'));
      return { ok: true, json: async () => ({ success: true, data: {
        predictions: [{ id: page }], pagination: { hasNext: page < 3 },
      } }) };
    },
  });
  const result = await fetchAll('/api/predictions?date=2026-09-17&category=2-5-goals');
  assert.equal(result.data.predictions.length, 3);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(url => url.includes('category=2-5-goals') && url.includes('limit=100')));
  const { categories, dbCategories } = require('../services/categoryPages');
  assert.equal(categories['2-5-goals'], 'Over/Under 2.5');
  assert.equal(dbCategories['2-5-goals'], '2.5 Goals');
});
