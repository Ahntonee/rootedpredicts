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
async function snapshotTable() {
  await db.query(`CREATE TABLE IF NOT EXISTS api_quota_snapshot (
    id INT PRIMARY KEY, requests_used INT NOT NULL, request_limit INT NOT NULL,
    checked_at DATETIME NOT NULL
  )`);
}
async function getSnapshot() {
  await snapshotTable();
  const [[row]] = await db.query('SELECT requests_used, request_limit, checked_at FROM api_quota_snapshot WHERE id = 1');
  return row || null;
}
async function reconcile(used, limit, before) {
  if (!Number.isInteger(used) || used < 0 || !Number.isInteger(limit) || limit <= 0) throw new Error('Invalid provider quota');
  await init();
  // Keep reservations made while the status request was in flight.
  await db.query('UPDATE api_daily_usage SET request_count = ? + GREATEST(0, request_count - ?) WHERE date = ?', [used, before, BUDGET_KEY]);
  await snapshotTable();
  await db.query(`INSERT INTO api_quota_snapshot (id, requests_used, request_limit, checked_at) VALUES (1, ?, ?, UTC_TIMESTAMP())
    ON DUPLICATE KEY UPDATE requests_used=VALUES(requests_used), request_limit=VALUES(request_limit), checked_at=VALUES(checked_at)`, [used, limit]);
  return getCount();
}
module.exports = { increment, getCount, pin, getSnapshot, reconcile };
