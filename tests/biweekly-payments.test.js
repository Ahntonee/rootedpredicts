'use strict';
process.env.JWT_SECRET = 'biweekly-payment-test-secret';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const payments = require('../services/manualPayments');
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
