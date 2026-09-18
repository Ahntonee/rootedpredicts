'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '..');
const shared = require('../services/categoryPages');

function pagesApi(initial = []) {
  const rows = new Map(initial.map(p => [p.slug, { ...p }]));
  const handlers = {};
  const updates = [];
  const db = { query: async (sql, args) => {
    if (sql.startsWith('SELECT')) {
      if (sql.includes('WHERE slug = ?')) return [[rows.get(args[0])].filter(Boolean)];
      if (sql.includes('LIKE')) return [[...rows.values()].filter(p => p.slug.startsWith('category-'))];
      return [[...rows.values()]];
    }
    if (sql.startsWith('INSERT')) {
      const existing = rows.get(args[0]);
      const row = { ...existing, slug: args[0], content: args[2] };
      for (const [field, index] of Object.entries({ page_title: 1, meta_description: 3, hero_title: 4, hero_subtitle: 5 })) {
        if (!existing || sql.includes(field + '=VALUES(')) row[field] = args[index];
      }
      rows.set(args[0], row);
      return [{ affectedRows: 1 }];
    }
    updates.push({ sql, args });
    const row = rows.get(args.at(-1));
    if (row) [...sql.matchAll(/(\w+)=\?/g)].filter(m => m[1] !== 'slug').forEach((m, i) => row[m[1]] = args[i]);
    return [{ affectedRows: rows.has(args.at(-1)) ? 1 : 0 }];
  } };
  const filename = path.join(root, 'routes/pages.js');
  const localRequire = createRequire(filename);
  const auth = { authenticate() {}, requireAdmin() {}, requireAdminRole: (...roles) => {
    assert.deepEqual(roles, ['superadmin', 'editor']); return function editPermission() {};
  } };
  const router = Object.fromEntries(['get','put'].map(method => [method, (url, ...fns) => {
    handlers[method + url] = fns;
  }]));
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: id => id === 'express' ? { Router: () => router } : id === '../config/db' ? db : id === '../middleware/auth' ? auth : localRequire(id),
    module: { exports: {} }, __dirname: path.dirname(filename), console,
  });
  return { db, rows, updates, handlers, async call(method, route, slug, body = {}) {
    let status = 200, result;
    const res = { status(n) { status = n; return this; }, json(value) { result = value; return this; } };
    await handlers[method + route].at(-1)({ params: { slug }, body }, res);
    return { status, ...result };
  } };
}

test('Site Pages lists all ten category defaults with exact existing HTML', async () => {
  const api = pagesApi([{ slug: 'about', content: '<h2>About</h2>', extra: '{"stat_accuracy":"75%"}' }]);
  const response = await api.call('get', '/admin/list');
  assert.equal(response.success, true);
  assert.equal(response.pages.filter(p => p.kind === 'category').length, 10);
  for (const slug of Object.keys(shared.categories)) {
    const p = response.pages.find(p => p.slug === 'category-' + slug);
    assert.equal(p.content, fs.readFileSync(path.join(root, 'public/content/categories', slug + '.html'), 'utf8'));
    assert.equal(p.url, '/predictions/' + slug);
  }
});

test('formatted category saves, reloads, removes and restores on public page and homepage', async () => {
  const api = pagesApi();
  const content = '<h2>Goals &amp; form</h2><p><strong>Bold</strong> and <em>italic</em> <a href="/results">results</a></p><ol><li>First</li></ol>';
  const template = fs.readFileSync(path.join(root, 'public/predictions.html'), 'utf8');
  const home = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  for (const article of [content, '', content]) {
    assert.equal((await api.call('put', '/admin/:slug', 'category-1-5-goals', { content: article })).success, true);
    const list = await api.call('get', '/admin/list');
    assert.equal(list.pages.find(p => p.slug === 'category-1-5-goals').content, article);
    const overrides = await shared.loadArticleOverrides(api.db);
    assert.equal(overrides['1-5-goals'], article);
    const rendered = shared.renderArticles(template, '1-5-goals', overrides);
    const homepage = shared.renderArticles(home, null, overrides);
    if (article) { assert.ok(rendered.includes(article)); assert.ok(homepage.includes(article)); }
    else {
      assert.ok(!rendered.includes(content));
      assert.ok(!rendered.includes('Rootedpredict gives 100 sure'));
      assert.ok(rendered.includes('id="seo-1-5-goals" style="display:none;"></div>'));
      assert.ok(!homepage.includes('Rootedpredict gives 100 sure free over/under 1.5'));
    }
  }
  assert.equal(api.handlers['put/admin/:slug'].length, 4);
  assert.equal((await api.call('put', '/admin/:slug', 'category-../../about', { content })).status, 404);
  assert.equal((await api.call('put', '/admin/:slug', 'category-free', {})).status, 400);
});

test('About fallback is available in admin and public API; blank writes rejected; omitted content preserved', async () => {
  const api = pagesApi([{ slug: 'about', page_title: 'About', content: null }]);
  const response = await api.call('get', '/:slug', 'about');
  assert.ok(response.page.content.includes('What Is Rooted Predictions?'));
  const list = await api.call('get', '/admin/list');
  assert.equal(list.pages.find(p => p.slug === 'about').content, response.page.content);
  for (const content of ['', null, '<p><br></p>', '<p>&nbsp;</p>']) {
    assert.equal((await api.call('put', '/admin/:slug', 'about', { content })).status, 400);
  }
  assert.equal((await api.call('put', '/admin/:slug', 'about', { page_title: 'New title' })).success, true);
  assert.ok(!api.updates.at(-1).sql.includes('content='));
  api.rows.get('about').content = '<h2>Custom About</h2>';
  assert.equal((await api.call('get', '/:slug', 'about')).page.content, '<h2>Custom About</h2>');
});

test('About displays saved content when stats data exists but stats elements do not', async () => {
  const html = fs.readFileSync(path.join(root, 'public/about.html'), 'utf8');
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('/api/pages/about'));
  const element = () => ({ style: {}, children: [], setAttribute() {}, append(...items) { this.children.push(...items); } });
  const elements = Object.fromEntries(['page-title','page-meta-desc','hero-title','hero-subtitle','page-loading','page-content'].map(id => [id, element()]));
  await vm.runInNewContext(script, {
    fetch: async () => ({ json: async () => ({ success: true, page: { content: '<h2>Visible About</h2>', extra: { stat_accuracy: '75%', about_sections: [{ title: 'FAQ', content: '<h3>Question?</h3><p>Answer</p>' }] } } }) }),
    document: { getElementById: id => elements[id] || null, createElement: element },
  });
  assert.equal(elements['page-content'].innerHTML, '<h2>Visible About</h2>');
  assert.equal(elements['page-content'].style.display, 'block');
  assert.equal(elements['page-loading'].style.display, 'none');
  assert.equal(elements['page-content'].children[0].children[0].textContent, 'FAQ');
  assert.equal(elements['page-content'].children[0].children[1].innerHTML, '<h3>Question?</h3><p>Answer</p>');
});

test('Site Pages script parses and all literal element IDs exist', () => {
  const html = fs.readFileSync(path.join(root, 'public/admin/pages.html'), 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  for (const match of html.matchAll(/getElementById\('([^']+)'\)/g)) assert.ok(html.includes('id="' + match[1] + '"'), match[1]);
});

test('category headings and metadata persist and render on server and browser', async () => {
  const api = pagesApi([{ slug:'category-1-5-goals', page_title:'Over 1.5 SEO Article', content:'<p>Legacy article</p>', hero_title:null, hero_subtitle:null }]);
  const legacy = (await api.call('get','/admin/list')).pages.find(p => p.slug === 'category-1-5-goals');
  assert.equal(legacy.hero_title, shared.categoryPage('1-5-goals').hero_title);
  assert.notEqual(legacy.page_title, 'Over 1.5 SEO Article');
  const payload = { page_title:'Custom title', meta_description:'Custom description', hero_title:'Goals <today>', hero_subtitle:'Custom subtitle', content:'<h2>Custom article</h2>' };
  assert.equal((await api.call('put','/admin/:slug','category-1-5-goals',payload)).success,true);
  const page = (await shared.loadCategoryOverrides(api.db))['1-5-goals'];
  for (const [field,value] of Object.entries(payload)) assert.equal(page[field],value);
  const source = fs.readFileSync(path.join(root,'server.js'),'utf8');
  const start = source.indexOf('function renderCategoryMeta(');
  const end = source.indexOf("app.get(['/', '/index.html']", start);
  const render = vm.runInNewContext(source.slice(start,end)+'\nrenderCategoryMeta', {
    categoryMetadata: require('../services/categoryMetadata.json'), process:{env:{}},
    escHtml: s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
  });
  const rendered = render(fs.readFileSync(path.join(root,'public/predictions.html'),'utf8'),'1-5-goals',page);
  assert.ok(rendered.includes('Goals &lt;today&gt;'));
  const json = rendered.match(/id="category-page-meta">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(json)['1-5-goals'].h1,payload.hero_title);
  assert.equal(JSON.parse(json)['1-5-goals'].sub,payload.hero_subtitle);
  await api.call('put','/admin/:slug','category-1-5-goals',{content:'<p>Only article changed</p>'});
  assert.equal((await shared.loadCategoryOverrides(api.db))['1-5-goals'].hero_title,payload.hero_title);
});

test('About FAQ and pricing defaults can be edited, reordered and removed persistently', async () => {
  const api = pagesApi([{slug:'about',content:'<h2>About</h2>',extra:null}]);
  const defaults = (await api.call('get','/:slug','about')).page.extra.about_sections;
  assert.equal(defaults.length,2);
  assert.equal(defaults[0].title,'Frequently Asked Questions');
  assert.ok(defaults[1].content.includes('NGN 15,000'));
  const sections = [{title:'Our team',content:'<p><strong>Meet the team</strong></p>'},defaults[1]];
  assert.equal((await api.call('put','/admin/:slug','about',{extra:{about_sections:sections}})).success,true);
  assert.deepEqual(JSON.parse(JSON.stringify((await api.call('get','/:slug','about')).page.extra.about_sections)),sections);
  await api.call('put','/admin/:slug','about',{extra:{about_sections:[]}});
  assert.equal((await api.call('get','/:slug','about')).page.extra.about_sections.length,0);
  assert.equal((await api.call('put','/admin/:slug','about',{extra:{about_sections:[{title:'Bad',content:null}]}})).status,400);
});
