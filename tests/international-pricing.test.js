'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
test('Naira amounts remain fixed and foreign conversions use dollar plan prices', async () => {
  const module = { exports: {} };
  let requests = 0;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'services/planPricing.js'), 'utf8'), {
    module, Intl, Date, require: () => ({ get: async () => {
      requests++;
      return { data: { result: 'success', base_code: 'USD', rates: { USD: 1, EUR: 0.9, GHS: 12 }, time_last_update_unix: 1789603200 } };
    } })
  });
  const svc = module.exports;
  const ngn = await svc.quote('NGN');
  assert.equal(ngn.plans.standard.amount, 15000);
  assert.equal(ngn.plans.deluxe.amount, 25000);
  assert.equal((await svc.quote('USD')).plans.standard.amount, 30);
  assert.equal(requests, 0);
  assert.equal((await svc.quote('EUR')).plans.standard.amount, 27);
  assert.equal((await svc.quote('GHS')).plans.standard.amount, 360);
  assert.equal(requests, 1);
  const fortnightNgn = await svc.quote('NGN', 'biweekly');
  assert.equal(fortnightNgn.plans.standard.amount, 7500);
  assert.equal(fortnightNgn.plans.deluxe.amount, 12500);
  const fortnightUsd = await svc.quote('USD', 'biweekly');
  assert.equal(fortnightUsd.plans.standard.amount, 15);
  assert.equal(fortnightUsd.plans.deluxe.amount, 22.5);
  assert.equal(fortnightUsd.days, 14);
  assert.equal((await svc.quote('EUR', 'biweekly')).plans.standard.amount, 13.5);
  await assert.rejects(svc.quote('NGN', 'invalid'), /Invalid billing period/);
});
test('Country selection handles Nigeria names and codes and hides conversion explanations', async () => {
  const elements = { 'pricing-currency': { value: '', appendChild() {}, addEventListener() {} }, 'sub-standard-price': {}, 'sub-deluxe-price': {} };
  const window = {};
  const currencies = [];
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/pricing-currency.js'), 'utf8'), {
    window, Intl, navigator: { language: 'en-US', languages: ['en-US'] }, localStorage: { getItem: () => null },
    document: { getElementById: id => elements[id], createElement: () => ({}) },
    fetch: async url => { const currency = new URL(url, 'https://example.test').searchParams.get('currency'); currencies.push(currency); return { ok: true, json: async () => ({ success: true, data: { currency, plans: { standard: { amount: 30 }, deluxe: { amount: 45 } } } }) }; }
  });
  await new Promise(resolve => setImmediate(resolve));
  for (const [country, currency] of [['Nigeria', 'NGN'], ['GB', 'GBP'], ['NG', 'NGN'], ['Ghana', 'GHS']]) {
    window.PricingCurrency.setCountry(country);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(currencies.at(-1), currency);
  }
  const html = fs.readFileSync(path.join(root, 'public/pricing.html'), 'utf8');
  assert.ok(!html.includes('Prices are based on naira'));
  assert.ok(!html.includes('Currency suggested'));
  assert.ok(!html.includes('id="currency-note"'));
});

test('Cards and both billing menus show country prices together, including offline fallback', async () => {
  const elements = {};
  function el(value) { return { value, options: [], listeners: {}, appendChild(o) { this.options.push(o); }, addEventListener(k, fn) { this.listeners[k] = fn; } }; }
  elements['pricing-currency'] = el('');
  elements['pricing-duration'] = el('monthly');
  for (const plan of ['standard','deluxe']) {
    elements['sub-' + plan + '-price'] = {};
    elements['sub-' + plan + '-local-price'] = {};
    elements['bank-' + plan + '-duration'] = el('monthly');
    elements['bank-' + plan + '-duration'].options = [{ value:'monthly' }, { value:'biweekly' }];
  }
  const window = {};
  let offline = false;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js/pricing-currency.js'), 'utf8'), {
    window, Intl, navigator: { language:'en-US', languages:['en-US'] }, localStorage: { getItem: () => 'NGN', setItem() {} },
    document: { getElementById: id => elements[id], createElement: () => ({}) },
    fetch: async url => {
      if (offline) throw Error('offline');
      const q = new URL(url, 'https://test.example').searchParams;
      const currency = q.get('currency'), factor = q.get('duration') === 'biweekly' ? 0.5 : 1;
      const plans = Object.fromEntries(['standard','deluxe'].map((plan,i) => [plan, { usd: [30,45][i] * factor, amount: (currency === 'NGN' ? [15000,25000][i] : [30,45][i] * (currency === 'UGX' ? 3800 : 1)) * factor }]));
      return { ok:true, json: async () => ({ success:true, data:{ currency, plans } }) };
    }
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  window.PricingCurrency.setCountry('Uganda'); await settle();
  assert.match(elements['sub-standard-price'].textContent, /USD\s*30/);
  assert.match(elements['sub-standard-local-price'].textContent, /UGX\s*114,000/);
  const menus = plan => elements['bank-' + plan + '-duration'].options.map(o => o.textContent).join(' ');
  assert.match(menus('standard'), /USD\s*15/);
  assert.match(menus('deluxe'), /USD\s*22.50/);
  assert.doesNotMatch(menus('standard'), /NGN|15,000/);
  elements['pricing-duration'].value = 'biweekly'; elements['pricing-duration'].listeners.change(); await settle();
  assert.match(elements['sub-standard-price'].textContent, /USD\s*15/);
  assert.match(elements['sub-standard-local-price'].textContent, /57,000/);
  window.PricingCurrency.setCountry('Nigeria'); await settle();
  assert.match(elements['sub-standard-price'].textContent, /NGN\s*7,500/);
  assert.equal(elements['sub-standard-local-price'].textContent, '');
  assert.match(menus('deluxe'), /NGN\s*25,000/);
  offline = true;
  window.PricingCurrency.setCountry('UG'); await settle();
  assert.match(elements['sub-standard-price'].textContent, /USD\s*15/);
  assert.equal(elements['sub-standard-local-price'].textContent, '');
  assert.doesNotMatch(menus('standard'), /NGN/);
});
