'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

function load(file, mocks) {
  const filename = path.resolve(__dirname, '..', file);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, require: id => mocks[id] || localRequire(id),
    __dirname: path.dirname(filename), process: { env: {} }, console,
  });
  return module.exports;
}

for (const outcome of ['approved', 'rejected']) {
  for (const delivered of [true, false]) {
    test(`${outcome}: sends email and reports delivery=${delivered}`, async () => {
      const emails = [], queries = [];
      const ctrl = load('controllers/subscriptions.js', {
        '../config/db': { query: async (sql, args) => {
          queries.push({ sql, args });
          return sql.includes('SELECT ps.*') ? [[{ id: 7, user_id: 9, status: 'pending', plan: 'standard', user_email: 'user@example.com', user_name: '<User>', amount_ngn: 15000 }]] : [{ affectedRows: 1 }];
        } },
        '../utils/email': { sendEmail: async email => { emails.push(email); return { success: delivered }; } },
        '../services/mailer': { sendMail() { throw new Error('Wrong provider'); } },
        '../services/planPricing': { amounts: { standard: 15000 }, plans: { standard: { label: 'Standard' } } },
        '../services/manualPayments': {},
      });
      let result;
      const res = { json(value) { result = value; }, status(code) { throw new Error('Unexpected status ' + code); } };
      await ctrl[outcome === 'approved' ? 'adminApproveSubmission' : 'adminRejectSubmission'](
        { params: { id: 7 }, user: { id: 1 }, body: { notes: '<invalid receipt>', duration: 'yearly' } }, res);
      assert.equal(result.success, true);
      assert.equal(result.email_sent, delivered);
      assert.equal(emails.length, 1);
      assert.equal(emails[0].to, 'user@example.com');
      assert.ok(emails[0].html.includes('&lt;User&gt;'));
      if (outcome === 'rejected') assert.ok(emails[0].html.includes('&lt;invalid receipt&gt;'));
      assert.ok(queries.some(q => q.sql.includes(`status='${outcome}'`)));
      if (outcome === 'approved') {
        const activation = queries.find(q => q.sql.includes('INSERT INTO subscriptions'));
        assert.equal(activation.args[8] - activation.args[7], 365 * 86400000);
      }
    });
  }
}

test('Notification routes require authentication and scope reads and acknowledgement to the current user', async () => {
  const handlers = {}, calls = [], queries = [];
  const router = { use: fn => calls.push(fn) };
  for (const method of ['get', 'post']) router[method] = (url, ...fns) => { handlers[method + url] = fns.at(-1); calls.push(url); };
  const authenticate = () => {};
  load('routes/subscriptions.js', {
    express: { Router: () => router },
    '../controllers/subscriptions': {},
    '../middleware/auth': { authenticate },
    '../utils/helpers': { asyncHandler: fn => fn },
    '../services/subscriptionExpiry': { expireDue: async () => {} },
    '../config/db': { query: async (sql, args) => { queries.push({ sql, args }); return [[]]; } },
  });
  assert.ok(calls.indexOf(authenticate) < calls.indexOf('/notifications'));
  const res = { setHeader() {}, json() {} };
  await handlers['get/notifications']({ user: { id: 42 } }, res);
  await handlers['post/notifications/:id/read']({ user: { id: 42 }, params: { id: '7' } }, res);
  assert.deepEqual(Array.from(queries[0].args), [42]);
  assert.match(queries[0].sql, /notification_read_at IS NULL/);
  assert.deepEqual(Array.from(queries.at(-1).args), ['7', 42]);
  assert.match(queries.at(-1).sql, /WHERE id = \? AND user_id = \?/);
  await handlers['post/notifications/:id/read']({ user: { id: 42 }, params: { id: 'expiry-3' } }, res);
  assert.deepEqual(Array.from(queries.at(-1).args), ['3', 42]);
  assert.match(queries.at(-1).sql, /WHERE id=\? AND user_id=\?/);
});
