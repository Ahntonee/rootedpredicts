'use strict';
const axios = require('axios');
const amounts = Object.freeze({ standard: 15000, deluxe: 25000 });
const usdAmounts = Object.freeze({ standard: 30, deluxe: 45 });
const plans = Object.freeze({
  standard: { label: 'Standard Plan', days: 30, features: ['Daily 2+ odds picks', '95% Accuracy', '24/7 support', 'Free 10+ odds on weekends'] },
  deluxe: { label: 'Deluxe Plan', days: 30, features: ['Access to Standard Plan', 'Daily 2 - 5+ odds picks', '97% Accuracy', 'Instant support', 'Free 5+ odds on weekends'] },
});
let cached = null;
let expires = 0;
let retryAfter = 0;
let pending = null;
async function rates() {
  if (cached && Date.now() < expires) return cached;
  if (Date.now() < retryAfter) throw new Error('Exchange rates unavailable');
  if (!pending) pending = axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 8000 })
    .then(({ data }) => {
      if (data.result !== 'success' || data.base_code !== 'USD' || data.rates?.USD !== 1 || !Number.isFinite(data.time_last_update_unix)) throw new Error('Invalid exchange rates');
      cached = data;
      expires = Date.now() + 24 * 60 * 60 * 1000;
      return data;
    }).catch(error => { retryAfter = Date.now() + 5 * 60 * 1000; throw error; })
    .finally(() => { pending = null; });
  return pending;
}
async function quote(currency = 'NGN') {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid currency');
  const data = ['NGN', 'USD'].includes(currency) ? null : await rates();
  const rate = data ? data.rates[currency] : 1;
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Currency unavailable');
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  return { currency, base_currency: currency === 'NGN' ? 'NGN' : 'USD', updated_at: data ? new Date(data.time_last_update_unix * 1000).toISOString() : null,
    plans: Object.fromEntries(Object.entries(amounts).map(([plan, ngn]) => [plan, { ngn, usd: usdAmounts[plan], label: plans[plan].label, amount: Number(((currency === 'NGN' ? ngn : usdAmounts[plan]) * rate).toFixed(digits)) }])) };
}
module.exports = { amounts, usdAmounts, plans, quote };
