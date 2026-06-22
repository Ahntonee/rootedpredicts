// services/scheduler.js
// Rooted Predictions — Cron job scheduler
'use strict';

const cron       = require('node-cron');
const db         = require('../config/db');
const apiSvc     = require('./apiFootball');
const confidence = require('./confidence');
const accuracy   = require('./accuracy');

const SYNC_SCHEDULE = process.env.SYNC_CRON_SCHEDULE || '0 6 * * *';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runDailySync() {
  console.log('[SCHEDULER] Daily sync started at', new Date().toISOString());
  if (!process.env.API_FOOTBALL_KEY) {
    console.log('[SCHEDULER] API_FOOTBALL_KEY not set — skipping live sync'); return;
  }
  const today    = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  let totalCreated = 0, errors = 0;
  try {
    // Sync all leagues for today and tomorrow in two API calls (no leagueId filter)
    const r1 = await apiSvc.syncFixtures(today);
    totalCreated += r1.created;
    console.log(`[SCHEDULER] Today sync: ${r1.created} new, ${r1.skipped} skipped`);
    await sleep(500);
    const r2 = await apiSvc.syncFixtures(tomorrow);
    totalCreated += r2.created;
    console.log(`[SCHEDULER] Tomorrow sync: ${r2.created} new, ${r2.skipped} skipped`);
  } catch(e) { console.error('[SCHEDULER] Fixture sync failed:', e.message); errors++; }

  console.log(`[SCHEDULER] Daily sync done: ${totalCreated} new fixtures, ${errors} errors`);

  // Always run auto-predict — picks up any TBD stubs for today/tomorrow.
  // Limit is derived from the remaining API budget so the day never exceeds 7,400 calls:
  //   remaining budget  = getRemainingCount() (tracks calls made so far today)
  //   reserved          = calls still needed for live-sync + scores + results + 200 buffer
  //   calls per fixture = 8 (fixture info + 2×team form + H2H + 2×team stats + standings + odds)
  const CALLS_PER_FIXTURE = 8;
  const DAILY_RESERVED    = 600; // live (480) + scores (72) + results (2) + 46 buffer
  const remaining         = apiSvc.getRemainingCount();
  const autoLimit         = Math.max(0, Math.floor((remaining - DAILY_RESERVED) / CALLS_PER_FIXTURE));
  console.log(`[SCHEDULER] Running auto-predict (budget: ${remaining} remaining, limit: ${autoLimit} fixtures)...`);
  if (autoLimit > 0) {
    try {
      await sleep(2000);
      const result = await apiSvc.autoPredictFixtures(db, { limit: autoLimit, minConfidence: 65, autoPublish: true });
      console.log(`[SCHEDULER] Auto-predict: ${result.enriched} enriched, ${result.skipped} skipped, ${result.errors} errors`);
    } catch(e) { console.error('[SCHEDULER] Auto-predict failed:', e.message); }
  } else {
    console.log('[SCHEDULER] Auto-predict skipped — daily API budget exhausted');
  }
}

async function runResultsSync() {
  console.log('[SCHEDULER] Results sync started');
  if (!process.env.API_FOOTBALL_KEY) return;
  const today     = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  try {
    const r1 = await apiSvc.syncResults(today);
    const r2 = await apiSvc.syncResults(yesterday);
    console.log(`[SCHEDULER] Results: today ${r1.updated}, yesterday ${r2.updated} updated`);
  } catch(e) { console.error('[SCHEDULER] Results sync error:', e.message); }
}

// ── Live in-play score sync (cheap: 1 API call, updates all live matches) ─────
async function runLiveSync() {
  if (!process.env.API_FOOTBALL_KEY) return;
  try {
    const r = await apiSvc.syncLive();
    if (r.updated > 0) console.log(`[SCHEDULER] Live sync: ${r.updated} predictions updated`);
  } catch (e) { console.error('[SCHEDULER] Live sync error:', e.message); }
}

// ── Today's scores + status + grading (catches finished matches through the day)
async function runTodayScores() {
  if (!process.env.API_FOOTBALL_KEY) return;
  try {
    const today = new Date().toISOString().split('T')[0];
    const r = await apiSvc.syncScores(today);
    if (r.updated > 0) console.log(`[SCHEDULER] Today scores: ${r.updated} updated, ${r.graded} graded`);
  } catch (e) { console.error('[SCHEDULER] Today scores error:', e.message); }
}

async function runSubscriptionExpiryCheck() {
  try {
    const [expired] = await db.query(
      `SELECT s.user_id, s.id as sub_id FROM subscriptions s
       WHERE s.status = 'active' AND s.expires_at < NOW() AND s.expires_at IS NOT NULL`
    );
    for (const sub of expired) {
      await db.query("UPDATE users SET role='user',updated_at=NOW() WHERE id=? AND role='vip'", [sub.user_id]);
      await db.query("UPDATE subscriptions SET status='expired',updated_at=NOW() WHERE id=?", [sub.sub_id]);
      console.log(`[SCHEDULER] Subscription expired user ${sub.user_id}`);
    }
    const [trialEnded] = await db.query(
      `SELECT s.user_id, s.id as sub_id FROM subscriptions s
       WHERE s.status='trialing' AND s.trial_ends_at < NOW() AND s.trial_ends_at IS NOT NULL`
    );
    for (const sub of trialEnded) {
      await db.query("UPDATE users SET role='user',updated_at=NOW() WHERE id=? AND role='vip'", [sub.user_id]);
      await db.query("UPDATE subscriptions SET status='expired',updated_at=NOW() WHERE id=?", [sub.sub_id]);
    }
  } catch(e) { console.error('[SCHEDULER] Expiry check failed:', e.message); }
}

async function runConfidenceScoring() {
  console.log('[SCHEDULER] Confidence scoring started');
  try {
    const updated = await confidence.scoreAllPending(db);
    console.log(`[SCHEDULER] Confidence scoring done: ${updated} predictions scored`);
  } catch(e) { console.error('[SCHEDULER] Confidence scoring error:', e.message); }
}

// ── Run after results sync — logs outcomes and recalculates accuracy stats ────
async function runAccuracyTracking() {
  console.log('[SCHEDULER] Accuracy tracking started');
  try {
    const logged = await accuracy.logUntracked(db);
    if (logged > 0) {
      await accuracy.recalculateStats(db);
      console.log(`[SCHEDULER] Accuracy tracking: ${logged} new outcomes logged and stats updated`);
    } else {
      console.log('[SCHEDULER] Accuracy tracking: no new outcomes to log');
    }
  } catch(e) { console.error('[SCHEDULER] Accuracy tracking error:', e.message); }
}

function startScheduler() {
  // In PM2 cluster mode (instances: 'max'), every worker calls this function.
  // Only worker 0 should run cron jobs — otherwise each job fires N times.
  const instanceId = process.env.NODE_APP_INSTANCE;
  if (instanceId !== undefined && instanceId !== '0') {
    console.log(`[SCHEDULER] Instance ${instanceId} — cron skipped (only instance 0 runs jobs)`);
    return;
  }
  if (!cron.validate(SYNC_SCHEDULE)) { console.error(`[SCHEDULER] Invalid cron: ${SYNC_SCHEDULE}`); return; }
  cron.schedule(SYNC_SCHEDULE, runDailySync, { timezone: 'UTC' });
  console.log(`[SCHEDULER] Daily fixture sync: ${SYNC_SCHEDULE} UTC`);
  cron.schedule('30 23 * * *', runResultsSync,           { timezone: 'UTC' });
  console.log('[SCHEDULER] Results sync: 23:30 UTC daily');
  cron.schedule('45 23 * * *', runAccuracyTracking,       { timezone: 'UTC' });
  console.log('[SCHEDULER] Accuracy tracking: 23:45 UTC daily (after results sync)');
  cron.schedule('0 * * * *',   runSubscriptionExpiryCheck, { timezone: 'UTC' });
  console.log('[SCHEDULER] Subscription expiry check: every hour');
  cron.schedule('15 6 * * *',  runConfidenceScoring,      { timezone: 'UTC' });
  console.log('[SCHEDULER] Confidence scoring: 06:15 UTC daily');
  cron.schedule('*/3 * * * *', runLiveSync,               { timezone: 'UTC' });
  console.log('[SCHEDULER] Live score sync: every 3 minutes');
  cron.schedule('*/20 * * * *', runTodayScores,           { timezone: 'UTC' });
  console.log('[SCHEDULER] Today score/result sync: every 20 minutes');
}

module.exports = {
  startScheduler, runDailySync, runResultsSync,
  runLiveSync, runTodayScores,
  runSubscriptionExpiryCheck, runAccuracyTracking,
};
