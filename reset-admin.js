// reset-admin.js
// Rooted Predictions — Reset admin password
// Run: ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=YourPass node reset-admin.js
//   or: node reset-admin.js you@example.com YourPass
'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db     = require('./config/db');

const ADMIN_EMAIL    = process.argv[2] || process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.argv[3] || process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Usage: node reset-admin.js <email> <password>');
  console.error('   or: ADMIN_EMAIL=x ADMIN_PASSWORD=y node reset-admin.js');
  process.exit(1);
}

async function run() {
  try {
    console.log('[RESET] Hashing password...');
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    const [rows] = await db.query(
      'SELECT id, email FROM users WHERE email = ?', [ADMIN_EMAIL]
    );

    if (rows.length) {
      await db.query(
        "UPDATE users SET password_hash = ?, role = 'admin', updated_at = NOW() WHERE email = ?",
        [hash, ADMIN_EMAIL]
      );
      console.log('[RESET] Admin password updated for', ADMIN_EMAIL);
    } else {
      await db.query(
        `INSERT INTO users (name, email, password_hash, role, country, timezone)
         VALUES ('Rooted Predictions Admin', ?, ?, 'admin', 'Nigeria', 'Africa/Lagos')`,
        [ADMIN_EMAIL, hash]
      );
      console.log('[RESET] Admin account created for', ADMIN_EMAIL);
    }

    process.exit(0);
  } catch(e) {
    console.error('[RESET] Error:', e.message);
    process.exit(1);
  }
}

run();
