// config/migrate_auth.js
// Rooted Predictions — Auth column additions
// Compatible with MySQL 5.7 and MySQL 8.0
// Run: node config/migrate_auth.js
'use strict';
require('dotenv').config();
const mysql = require('mysql2/promise');

const isTiDB = (process.env.DB_HOST || '').includes('tidbcloud.com');

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST||'localhost', port: parseInt(process.env.DB_PORT)||3306,
    user: process.env.DB_USER||'root', password: process.env.DB_PASSWORD||'',
    database: process.env.DB_NAME||'rootedpredictions',
    ...(isTiDB && { ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true } }),
  });
  console.log('[MIGRATE_AUTH] Connected');

  // Check which columns already exist
  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users'
     AND COLUMN_NAME IN ('password_reset_token','password_reset_expires')`,
    [process.env.DB_NAME||'rootedpredictions']
  );
  const existing = cols.map(c => c.COLUMN_NAME);

  if (!existing.includes('password_reset_token')) {
    await conn.query(`ALTER TABLE users ADD COLUMN password_reset_token VARCHAR(255) DEFAULT NULL`);
    console.log('[MIGRATE_AUTH] ✓ password_reset_token added');
  } else {
    console.log('[MIGRATE_AUTH] ↷ password_reset_token already exists');
  }

  if (!existing.includes('password_reset_expires')) {
    await conn.query(`ALTER TABLE users ADD COLUMN password_reset_expires DATETIME DEFAULT NULL`);
    console.log('[MIGRATE_AUTH] ✓ password_reset_expires added');
  } else {
    console.log('[MIGRATE_AUTH] ↷ password_reset_expires already exists');
  }

  try {
    await conn.query(`ALTER TABLE users ADD INDEX idx_users_reset_token (password_reset_token)`);
    console.log('[MIGRATE_AUTH] ✓ Index added');
  } catch(e) {
    console.log('[MIGRATE_AUTH] ↷ Index already exists');
  }

  await conn.end();
  console.log('[MIGRATE_AUTH] ✅ Auth migration complete');
}
run().catch(e => { console.error('[MIGRATE_AUTH] Fatal:', e.message); process.exit(1); });
