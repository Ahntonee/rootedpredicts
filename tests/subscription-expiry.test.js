'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { durationDays, expireDue } = require('../services/subscriptionExpiry');
const { attachMembership, canAccess } = require('../services/membership');

test('Duration choices have exact lengths and reject invalid input', () => {
  assert.equal(durationDays('biweekly'), 14);
  assert.equal(durationDays(), 30);
  assert.equal(durationDays('quarterly'), 90);
  assert.equal(durationDays('yearly'), 365);
  for (const value of ['weekly', -1, null, '__proto__']) assert.throws(() => durationDays(value));
});
test('Expiry records durable notices before changing status and preserves other active plans', async () => {
  const calls = [];
  await expireDue({ query: async (sql, args) => { calls.push({ sql, args }); return [{}]; } }, 7);
  assert.match(calls[0].sql, /INSERT IGNORE/);
  assert.match(calls[0].sql, /expires_at <= NOW\(\)/);
  assert.match(calls[1].sql, /SET status='expired'/);
  assert.match(calls[2].sql, /NOT EXISTS/);
  assert.match(calls[2].sql, /u.role='vip'/);
  assert.ok(calls.every(call => call.args[0] === 7));
});
test('An expired member is Free and blocked on the next request; a remaining Deluxe plan retains access', async () => {
  for (const active of [[], [{ plan: 'deluxe' }]]) {
    const db = { query: async sql => sql.startsWith('SELECT plan') ? [active] : [{}] };
    const user = await attachMembership(db, { id: 7, role: 'vip' });
    assert.equal(user.role, active.length ? 'vip' : 'user');
    assert.equal(canAccess({ access_tier: 'deluxe' }, user), !!active.length);
    assert.equal(canAccess({ access_tier: 'standard' }, user), !!active.length);
  }
});
test('Expiry email failures remain retryable and claimed notifications are not sent twice', async () => {
  let delivery = false, sent = 0, claimed = false, recorded = false;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/subscriptionExpiry.js'), 'utf8'), {
    module, require: id => id === './membership' ? { tierForPlan: x => x } : {
      sendEmail: async () => { sent++; return { success: delivery }; }
    }
  });
  const db = { query: async sql => {
    if (sql.startsWith('SELECT')) return [[{ id: 1, plan: 'standard', email: 'member@example.com' }]];
    if (sql.includes('email_attempt_at=NOW()')) {
      const affectedRows = claimed ? 0 : 1; claimed = true; return [{ affectedRows }];
    }
    if (sql.includes('email_sent_at=NOW()')) recorded = true;
    return [{}];
  } };
  await module.exports.sendExpiryEmails(db);
  assert.equal(recorded, false);
  await module.exports.sendExpiryEmails(db);
  assert.equal(sent, 1);
  claimed = false; delivery = true;
  await module.exports.sendExpiryEmails(db);
  assert.equal(recorded, true);
});
