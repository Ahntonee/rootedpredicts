// config/migrate_counter.js
// Run once on the server: node config/migrate_counter.js
'use strict';

require('dotenv').config();
const db = require('./db');

async function run() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS api_daily_usage (
      date          DATE         NOT NULL,
      request_count INT UNSIGNED NOT NULL DEFAULT 0,
      updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('[MIGRATE] api_daily_usage table ready');
  process.exit(0);
}

run().catch(e => { console.error('[MIGRATE] Failed:', e.message); process.exit(1); });
