// config/migrate_auth.js
// AfroPredict — Auth column additions
// Run once: node config/migrate_auth.js
'use strict';
require('dotenv').config();
const mysql = require('mysql2/promise');

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT)||3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  console.log('[MIGRATE_AUTH] Connected');

  const migrations = [
    {
      name: 'Add password_reset_token to users',
      sql: `ALTER TABLE users
            ADD COLUMN IF NOT EXISTS password_reset_token   VARCHAR(255) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS password_reset_expires DATETIME    DEFAULT NULL;`,
    },
    {
      name: 'Add index on password_reset_token',
      sql: `ALTER TABLE users ADD INDEX IF NOT EXISTS idx_users_reset_token (password_reset_token);`,
    },
  ];

  for (const m of migrations) {
    try {
      console.log(`[MIGRATE_AUTH] ${m.name}`);
      await conn.query(m.sql);
      console.log(`[MIGRATE_AUTH] ✓ Done`);
    } catch(e) {
      if (e.code === 'ER_DUP_KEYNAME' || e.message.includes('Duplicate')) {
        console.log(`[MIGRATE_AUTH] ↷ Already exists`);
      } else {
        console.error(`[MIGRATE_AUTH] Error:`, e.message);
      }
    }
  }

  await conn.end();
  console.log('[MIGRATE_AUTH] ✅ Auth migration complete');
}
run();
