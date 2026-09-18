'use strict';
const pricing = require('./planPricing');
const jwt = require('jsonwebtoken');
function methods() {
  return {
    moniepoint: { label: 'Moniepoint bank transfer', currency: 'NGN', account_name: 'Anthony Ikpe', account_number: '9077025895', provider: 'Moniepoint Microfinance Bank', enabled: true },
    momo: { label: 'MoMo', currency: process.env.MOMO_CURRENCY || 'NGN', account_name: 'Anthony Ikpe', account_number: '0590583485', provider: process.env.MOMO_PROVIDER || 'MTN MoMo PSB', country: process.env.MOMO_COUNTRY || 'Nigeria', enabled: true },
    usdt: { label: 'USDT', currency: 'USDT', account_number: '0xb4bb5688c25e185d89817f39bfcd5f435b8f3fc0', network: process.env.USDT_NETWORK || 'BEP-20 (BNB Smart Chain)', enabled: true },
  };
}
async function createQuote(userId, plan, method, duration = 'monthly', country) {
  if (!Object.hasOwn(pricing.plans, plan)) throw new Error('Choose Standard or Deluxe.');
  const destination = methods()[method];
  if (!destination || !destination.enabled) throw new Error('This payment method is not available yet.');
  const foreign = !!country && !['NG', 'NIGERIA'].includes(String(country).trim().toUpperCase());
  const remittance = method === 'momo' && foreign;
  if (country !== undefined && destination.currency === 'NGN') {
    const registeredCountry = String(country || '').trim().toUpperCase();
    if (!registeredCountry) throw new Error('Please set your country in your account profile before paying.');
    if (foreign && method !== 'momo') {
      throw new Error('This account receives NGN and is only available for Nigerian accounts. Local-currency checkout is not available yet. You can choose USDT if you want to pay in USDT.');
    }
  }
  if (remittance) {
    destination.transfer_url = 'https://www.lightwayfinance.com/';
    destination.international = true;
  }
  const prices = await pricing.quote(method === 'usdt' ? 'USD' : destination.currency, duration, remittance);
  const amount = prices.plans[plan].amount;
  const data = { purpose: 'payment-proof', userId, plan, method, amount, currency: destination.currency, destination, ngn: remittance && destination.currency === 'NGN' ? amount : prices.plans[plan].ngn, duration, days: prices.days };
  const token = jwt.sign(data, process.env.JWT_SECRET, { expiresIn: '24h', audience: 'manual-payment' });
  return { ...data, token, expires_at: new Date(Date.now() + 86400000).toISOString() };
}
function verifyQuote(token, userId, plan) {
  const quote = jwt.verify(token, process.env.JWT_SECRET, { audience: 'manual-payment', algorithms: ['HS256'] });
  if (quote.purpose !== 'payment-proof' || quote.userId !== userId || quote.plan !== plan) throw new Error('Payment quote does not match this account or plan.');
  return quote;
}
module.exports = { methods, createQuote, verifyQuote };
