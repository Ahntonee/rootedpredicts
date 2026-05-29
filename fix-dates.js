// fix-dates.js
// AfroPredict — One-off fix: move all stale pending predictions to today's date
// Run once: node fix-dates.js
'use strict';

require('dotenv').config();
const db = require('./config/db');

async function run() {
  try {
    const today = new Date().toISOString().split('T')[0];

    // 1. Update match_date to today for all pending predictions that are in the past
    const [result] = await db.query(
      `UPDATE predictions
       SET match_date    = CONCAT(?, ' ', TIME(match_date)),
           published_at  = IFNULL(published_at, NOW()),
           updated_at    = NOW()
       WHERE result      = 'pending'
         AND DATE(match_date) < CURDATE()`,
      [today]
    );

    console.log(`✅ Updated ${result.affectedRows} predictions → match_date set to ${today}`);

    // 2. Also ensure all pending predictions have published_at set
    const [result2] = await db.query(
      `UPDATE predictions
       SET published_at = NOW(), updated_at = NOW()
       WHERE result     = 'pending'
         AND published_at IS NULL`
    );
    console.log(`✅ Published ${result2.affectedRows} previously unpublished predictions`);

    // 3. Summary
    const [[summary]] = await db.query(
      `SELECT COUNT(*) as total,
              SUM(DATE(match_date) = CURDATE()) as today_count
       FROM predictions WHERE result = 'pending' AND published_at IS NOT NULL`
    );
    console.log(`\n📊 Summary: ${summary.today_count} pending predictions now showing for today (${today})`);
    console.log(`   Total published pending: ${summary.total}`);

    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
}

run();
