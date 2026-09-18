'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

async function pricingPage(user) {
  const buttons = ['standard', 'deluxe'].map(plan => ({ dataset: { plan }, style: {}, disabled: true, addEventListener() {} }));
  const banner = { style: {} };
  const document = {
    readyState: 'complete',
    getElementById: id => id === 'vip-active-banner' ? banner : id === 'spin-style' ? {} : null,
    querySelectorAll: () => buttons,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/pricing.js'), 'utf8'), {
    document, window: { location: { search: '' } }, URLSearchParams,
    fetch: async url => ({ json: async () => url === '/api/auth/me' ? { success: !!user, data: user } : { success: false } }),
  });
  await new Promise(resolve => setImmediate(resolve));
  return { buttons, banner };
}

test('Manually granted Standard membership blocks Standard and allows Deluxe upgrade', async () => {
  const { buttons, banner } = await pricingPage({ role: 'vip', membership_tier: 'standard' });
  assert.equal(buttons[0].textContent, 'Already subscribed');
  assert.equal(buttons[0].disabled, true);
  assert.equal(buttons[1].textContent, 'Upgrade to Deluxe');
  assert.equal(buttons[1].disabled, false);
  assert.equal(banner.style.display, 'block');
});
test('Deluxe membership blocks purchases on both cards', async () => {
  const { buttons } = await pricingPage({ role: 'vip', membership_tier: 'deluxe' });
  for (const button of buttons) {
    assert.equal(button.textContent, 'Already subscribed');
    assert.equal(button.disabled, true);
  }
});
for (const user of [null, { role: 'user', membership_tier: 'free' }]) {
  test('Guests and free or expired members can select either plan: ' + JSON.stringify(user), async () => {
    const { buttons, banner } = await pricingPage(user);
    assert.ok(buttons.every(button => !button.disabled));
    assert.equal(banner.style.display, 'none');
  });
}
test('Admin accounts cannot start payment', async () => {
  const { buttons } = await pricingPage({ role: 'admin' });
  assert.ok(buttons.every(button => button.disabled && button.textContent === 'Admin Account'));
});
