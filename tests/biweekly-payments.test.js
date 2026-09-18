'use strict';
process.env.JWT_SECRET = 'biweekly-payment-test-secret';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const payments = require('../services/manualPayments');
test('MoMo is available and its signed quote preserves receiving account details', async () => {
  const method = payments.methods().momo;
  assert.equal(method.enabled, true);
  const quote = await payments.createQuote(7, 'standard', 'momo', 'biweekly');
  const verified = payments.verifyQuote(quote.token, 7, 'standard');
  assert.equal(verified.method, 'momo');
  assert.equal(verified.destination.provider, process.env.MOMO_PROVIDER || 'MTN MoMo PSB');
  assert.equal(verified.destination.country, process.env.MOMO_COUNTRY || 'Nigeria');
  assert.equal(verified.destination.account_name, 'Anthony Ikpe');
  assert.equal(verified.destination.account_number, '0590583485');
  assert.equal(verified.currency, process.env.MOMO_CURRENCY || 'NGN');
  assert.equal(verified.days, 14);
});
test('USDT quotes preserve the configured network and dollar prices', async () => {
  for (const [plan, duration, amount] of [['standard','monthly',30], ['standard','biweekly',15], ['deluxe','monthly',45], ['deluxe','biweekly',22.5]]) {
    const quote = await payments.createQuote(7, plan, 'usdt', duration);
    const verified = payments.verifyQuote(quote.token, 7, plan);
    assert.equal(verified.currency, 'USDT');
    assert.equal(verified.amount, amount);
    assert.equal(verified.destination.network, process.env.USDT_NETWORK || 'BEP-20 (BNB Smart Chain)');
  }
});
test('Signed biweekly quotes bind the price and 14-day duration to the user and plan', async () => {
  for (const [plan, price] of [['standard', 7500], ['deluxe', 12500]]) {
    const quote = await payments.createQuote(7, plan, 'moniepoint', 'biweekly');
    const verified = payments.verifyQuote(quote.token, 7, plan);
    assert.equal(verified.amount, price);
    assert.equal(verified.ngn, price);
    assert.equal(verified.days, 14);
    assert.equal(verified.duration, 'biweekly');
    assert.throws(() => payments.verifyQuote(quote.token, 8, plan));
  }
  assert.equal((await payments.createQuote(7, 'standard', 'moniepoint')).amount, 15000);
  await assert.rejects(payments.createQuote(7, 'standard', 'moniepoint', 'bad'));
});
