// reset-admin.js
// AfroPredict — Reset admin password
// Run: node reset-admin.js
'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db     = require('./config/db');

const ADMIN_EMAIL    = 'admin@afropredict.com';
const ADMIN_PASSWORD = 'Admin@G33!';

async function run() {
  try {
    console.log('[RESET] Hashing password...');
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    // Check if admin user exists
    const [rows] = await db.query(
      'SELECT id, email FROM users WHERE email = ?', [ADMIN_EMAIL]
    );

    if (rows.length) {
      // Update existing admin
      await db.query(
        "UPDATE users SET password_hash = ?, role = 'admin', updated_at = NOW() WHERE email = ?",
        [hash, ADMIN_EMAIL]
      );
      console.log('[RESET] ✅ Admin password updated successfully');
    } else {
      // Create admin user if missing
      await db.query(
        `INSERT INTO users (name, email, password_hash, role, country, timezone)
         VALUES ('AfroPredict Admin', ?, ?, 'admin', 'Nigeria', 'Africa/Lagos')`,
        [ADMIN_EMAIL, hash]
      );
      console.log('[RESET] ✅ Admin account created successfully');
    }

    console.log('');
    console.log('Admin credentials:');
    console.log('  Email:    ' + ADMIN_EMAIL);
    console.log('  Password: ' + ADMIN_PASSWORD);
    console.log('');
    console.log('Visit: http://localhost:3000/admin/index.html');
    process.exit(0);
  } catch(e) {
    console.error('[RESET] Error:', e.message);
    process.exit(1);
  }
}

run();
