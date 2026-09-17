'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('recent form uses exact teams and past finished matches without provider calls', async () => {
  const module = { exports:{} };
  vm.runInNewContext(read('services/recentForm.js'), { module, require: () => ({query:async (sql, args) => {
    assert.ok(sql.includes('match_date < ?'));
    assert.ok(sql.includes('SELECT DISTINCT'));
    assert.ok(sql.includes("status_short IN ('FT','AET','PEN')"));
    assert.equal(args[0], 'Home');
    return [[
      {home_team:'Home',away_team:'Away',home_score:2,away_score:0},
      {home_team:'Other',away_team:'Home',home_score:1,away_score:1},
      {home_team:'Other',away_team:'Home',home_score:3,away_score:0},
    ]];
  }}) });
  assert.equal(await module.exports.recentForm('Home', '2026-09-17', ''), 'WDL');
  assert.equal(await module.exports.recentForm('Home', '2026-09-17', 'WWDWL'), 'WWDWL');
});

test('discussion shows a comment form for signed-in users, guest links only for guests', async () => {
  const html = read('public/prediction-detail.html');
  const start = html.indexOf('  async function commentsSection(');
  const end = html.indexOf('\n  let p;', start);
  for (const user of [null, {id:1,role:'user'}, {id:2,role:'vip'}]) {
    const render = vm.runInNewContext(html.slice(start, end) + '\ncommentsSection', {
      window:{sessionUserPromise:Promise.resolve(user)},
      fetch:async () => ({json:async () => ({success:true,data:{comments:[]}})}),
      encodeURIComponent,
    });
    const result = await render(1, 'fixture');
    assert.equal(result.includes('prediction-comment-form'), Boolean(user));
    assert.equal(result.includes('Create Free Account'), !user);
  }
});

test('quota reconciliation preserves in-flight reservations and the provider limit', async () => {
  let count = 2503;
  let saved;
  const module = {exports:{}};
  vm.runInNewContext(read('services/apiCounter.js'), {module, require: () => ({query:async (sql,args) => {
    if (sql.startsWith('CREATE') || sql.startsWith('INSERT IGNORE')) return [];
    if (sql.includes('ORDER BY')) return [[{request_count:2500}]];
    if (sql.startsWith('UPDATE api_daily_usage')) { count = args[0] + Math.max(0, count - args[1]); return []; }
    if (sql.startsWith('INSERT INTO api_quota_snapshot')) { saved = {requests_used:args[0],request_limit:args[1]}; return []; }
    if (sql.includes('FROM api_quota_snapshot')) return [[saved]];
    return [[{request_count:count}]];
  }})});
  assert.equal(await module.exports.reconcile(2277,7500,2500), 2280);
  assert.equal((await module.exports.getSnapshot()).request_limit,7500);
  await assert.rejects(module.exports.reconcile(-1,7500,0));
});

test('leaderboard is protected before static serving and absent from public navigation', () => {
  const server = read('server.js');
  const route = server.indexOf("app.get('/leaderboard.html', require('./middleware/auth').authenticate, require('./middleware/auth').requireAdmin");
  assert.ok(route > 0 && route < server.indexOf('app.use(express.static('));
  assert.ok(read('routes/predictions.js').includes("router.get('/leaderboard', authenticate, requireAdmin"));
  assert.ok(read('public/js/admin.js').includes('/leaderboard.html'));
  for (const file of ['public/js/app.js','public/js/app.min.js','public/prediction-detail.html']) {
    assert.ok(!read(file).includes('href="/leaderboard.html"'));
  }
});
