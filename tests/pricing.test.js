'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function pricing(get) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'services/planPricing.js'), 'utf8'), {
    module, require: () => ({ get }), Intl, Date,
  });
  return module.exports;
}
test('conversions share one cached request and round for each currency', async () => {
  let calls = 0;
  const svc = pricing(async () => {
    calls++;
    return { data: { result:'success', base_code:'NGN', rates:{ NGN:1, USD:0.0007, JPY:0.10333, KWD:0.000215 }, time_last_update_unix:1789603200 } };
  });
  const naira = await svc.quote();
  assert.equal(calls, 0);
  assert.equal(naira.plans.annual.amount, 150000);
  const [usd, yen, dinar] = await Promise.all(['USD','JPY','KWD'].map(code => svc.quote(code)));
  assert.equal(calls, 1);
  assert.equal(usd.plans.monthly.amount, 10.5);
  assert.equal(usd.plans.quarterly.amount, 31.5);
  assert.equal(usd.plans.annual.amount, 105);
  assert.equal(yen.plans.monthly.amount, 1550);
  assert.equal(dinar.plans.monthly.amount, 3.225);
  await svc.quote('USD');
  assert.equal(calls, 1);
  await assert.rejects(svc.quote('BAD'), /unavailable/);
});
test('rate failures do not invent prices or repeatedly call the provider', async () => {
  let calls = 0;
  const svc = pricing(async () => { calls++; throw new Error('Offline'); });
  await assert.rejects(svc.quote('USD'));
  await assert.rejects(svc.quote('EUR'));
  assert.equal(calls, 1);
  assert.equal((await svc.quote('NGN')).plans.monthly.amount, 15000);
});
test('bank details and Stripe checkout use the same naira base prices', async () => {
  const svc = pricing(() => { throw new Error('Unexpected rate request'); });
  let checkout;
  const module = { exports:{} };
  const stripe = { checkout:{ sessions:{ create:async params => { checkout = params; return { url:'https://checkout.example' }; } } } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'controllers/subscriptions.js'), 'utf8'), {
    module, __dirname:path.join(root, 'controllers'), process:{ env:{ STRIPE_SECRET_KEY:'test', SITE_URL:'https://example.test' } }, console,
    require: id => {
      if (id === '../services/planPricing') return svc;
      if (id === '../config/db') return {};
      if (id === '../services/mailer') return {};
      if (id === 'stripe') return () => stripe;
      return require(id);
    },
  });
  let result;
  const res = { json: body => { result = body; }, status() { return this; } };
  await module.exports.getBankDetails({}, res);
  assert.equal(result.data.amounts.monthly.ngn, 15000);
  assert.equal(result.data.amounts.quarterly.ngn, 45000);
  assert.equal(result.data.amounts.annual.ngn, 150000);
  for (const plan of ['monthly', 'quarterly', 'annual']) {
    await module.exports.stripeCreateCheckout({ body:{ plan }, user:{ id:1, stripe_customer_id:'cus_test' } }, res);
    assert.equal(result.success, true);
    assert.equal(checkout.line_items[0].price_data.unit_amount, svc.amounts[plan] * 100);
    assert.equal(checkout.line_items[0].price_data.currency, 'ngn');
  }
});
test('pricing HTML inline scripts parse and cannot overwrite converted prices', () => {
  const html = fs.readFileSync(path.join(root, 'public/pricing.html'), 'utf8');
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  assert.ok(!html.includes('setPrice('));
  assert.ok(!html.includes('$4.89'));
});
