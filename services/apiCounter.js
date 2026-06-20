// services/apiCounter.js
// Cluster-safe DB-backed daily API counter.
// Falls back to in-memory if the table doesn't exist yet (safe before migration).
'use strict';

const db = require('../config/db');

let inMemory = 0;
let lastDate = todayKey();

function todayKey() { return new Date().toISOString().split('T')[0]; }

function checkReset() {
  const today = todayKey();
  if (today !== lastDate) { inMemory = 0; lastDate = today; }
}

async function increment() {
  checkReset();
  inMemory++;
  try {
    await db.query(
      `INSERT INTO api_daily_usage (date, request_count) VALUES (?, 1)
       ON DUPLICATE KEY UPDATE request_count = request_count + 1`,
      [todayKey()]
    );
  } catch (_) { /* table may not exist yet — in-memory is the fallback */ }
}

async function getCount() {
  try {
    const [[row]] = await db.query(
      'SELECT request_count FROM api_daily_usage WHERE date = ?', [todayKey()]
    );
    return row?.request_count ?? 0;
  } catch (_) {
    checkReset();
    return inMemory;
  }
}

module.exports = { increment, getCount };
