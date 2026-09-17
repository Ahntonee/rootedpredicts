'use strict';
const axios = require('axios');
const amounts = Object.freeze({ monthly: 15000, quarterly: 45000, annual: 150000 });
let cached = null;
let expires = 0;
let retryAfter = 0;
let pending = null;
async function rates() {
  if (cached && Date.now() < expires) return cached;
  if (Date.now() < retryAfter) throw new Error('Exchange rates unavailable');
  if (!pending) pending = axios.get('https://open.er-api.com/v6/latest/NGN', { timeout: 8000 })
    .then(({ data }) => {
      if (data.result !== 'success' || data.base_code !== 'NGN' || data.rates?.NGN !== 1 || !Number.isFinite(data.time_last_update_unix)) throw new Error('Invalid exchange rates');
      cached = data;
      expires = Date.now() + 24 * 60 * 60 * 1000;
      return data;
    }).catch(error => { retryAfter = Date.now() + 5 * 60 * 1000; throw error; })
    .finally(() => { pending = null; });
  return pending;
}
async function quote(currency = 'NGN') {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid currency');
  const data = currency === 'NGN' ? null : await rates();
  const rate = data ? data.rates[currency] : 1;
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Currency unavailable');
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  return { currency, base_currency: 'NGN', updated_at: data ? new Date(data.time_last_update_unix * 1000).toISOString() : null,
    plans: Object.fromEntries(Object.entries(amounts).map(([plan, ngn]) => [plan, { ngn, amount: Number((ngn * rate).toFixed(digits)) }])) };
}
module.exports = { amounts, quote };
