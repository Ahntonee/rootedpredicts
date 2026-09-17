// Persistent local request budget. No calendar-based resets.
'use strict';
const db = require('../config/db');
const BUDGET_KEY = '1970-01-01';
let ready;
function init() {
  if (!ready) ready = (async () => {
    await db.query(`CREATE TABLE IF NOT EXISTS api_daily_usage (
      date DATE PRIMARY KEY, request_count INT NOT NULL DEFAULT 0
    )`);
    const [[row]] = await db.query('SELECT request_count FROM api_daily_usage ORDER BY date DESC LIMIT 1');
    await db.query('INSERT IGNORE INTO api_daily_usage (date, request_count) VALUES (?, ?)', [BUDGET_KEY, row?.request_count || 0]);
  })().catch(error => { ready = null; throw error; });
  return ready;
}
async function getCount() {
  await init();
  const [[row]] = await db.query('SELECT request_count FROM api_daily_usage WHERE date = ?', [BUDGET_KEY]);
  return Number(row.request_count);
}
async function increment(limit) {
  await init();
  const [result] = await db.query('UPDATE api_daily_usage SET request_count = request_count + 1 WHERE date = ? AND request_count < ?', [BUDGET_KEY, limit]);
  if (!result.affectedRows) throw new Error('API request budget exhausted. No automatic reset is enabled.');
  return getCount();
}
async function pin(limit) {
  await init();
  await db.query('UPDATE api_daily_usage SET request_count = GREATEST(request_count, ?) WHERE date = ?', [limit, BUDGET_KEY]);
}
module.exports = { increment, getCount, pin };
