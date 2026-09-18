'use strict';
const pricing = require('./planPricing');
const jwt = require('jsonwebtoken');
function methods() {
  return {
    moniepoint: { label: 'Moniepoint bank transfer', currency: 'NGN', account_name: 'Anthony Ikpe', account_number: '9077025895', provider: 'Moniepoint Microfinance Bank', enabled: true },
    momo: { label: 'MoMo', currency: process.env.MOMO_CURRENCY || '', account_name: 'Anthony Ikpe', account_number: '0590583485', provider: process.env.MOMO_PROVIDER || '', country: process.env.MOMO_COUNTRY || '', enabled: !!(process.env.MOMO_CURRENCY && process.env.MOMO_PROVIDER && process.env.MOMO_COUNTRY) },
    usdt: { label: 'USDT', currency: 'USDT', account_number: '0xb4bb5688c25e185d89817f39bfcd5f435b8f3fc0', network: process.env.USDT_NETWORK || '', enabled: !!process.env.USDT_NETWORK },
  };
}
async function createQuote(userId, plan, method, duration = 'monthly') {
  if (!Object.hasOwn(pricing.plans, plan)) throw new Error('Choose Standard or Deluxe.');
  const destination = methods()[method];
  if (!destination || !destination.enabled) throw new Error('This payment method is not available yet.');
  const prices = await pricing.quote(method === 'usdt' ? 'USD' : destination.currency, duration);
  const amount = prices.plans[plan].amount;
  const data = { purpose: 'payment-proof', userId, plan, method, amount, currency: destination.currency, destination, ngn: prices.plans[plan].ngn, duration, days: prices.days };
  const token = jwt.sign(data, process.env.JWT_SECRET, { expiresIn: '24h', audience: 'manual-payment' });
  return { ...data, token, expires_at: new Date(Date.now() + 86400000).toISOString() };
}
function verifyQuote(token, userId, plan) {
  const quote = jwt.verify(token, process.env.JWT_SECRET, { audience: 'manual-payment', algorithms: ['HS256'] });
  if (quote.purpose !== 'payment-proof' || quote.userId !== userId || quote.plan !== plan) throw new Error('Payment quote does not match this account or plan.');
  return quote;
}
module.exports = { methods, createQuote, verifyQuote };
