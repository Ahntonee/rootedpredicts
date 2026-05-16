// services/scheduler.js
// AfroPredict — Cron job scheduler
'use strict';

const cron       = require('node-cron');
const db         = require('../config/db');
const apiSvc     = require('./apiFootball');
const confidence = require('./confidence');

const SYNC_SCHEDULE    = process.env.SYNC_CRON_SCHEDULE || '0 6 * * *';
const DAILY_SYNC_LEAGUES = [39, 140, 135, 78, 61, 2, 3, 253, 71, 6, 323];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runDailySync() {
  console.log('[SCHEDULER] Daily sync started at', new Date().toISOString());
  if (!process.env.API_FOOTBALL_KEY) {
    console.log('[SCHEDULER] API_FOOTBALL_KEY not set — skipping live sync'); return;
  }
  const today    = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  let totalCreated = 0, errors = 0;
  for (const leagueId of DAILY_SYNC_LEAGUES) {
    try {
      const r1 = await apiSvc.syncFixtures(today, leagueId);
      totalCreated += r1.created; await sleep(300);
      const r2 = await apiSvc.syncFixtures(tomorrow, leagueId);
      totalCreated += r2.created; await sleep(300);
    } catch(e) { console.error(`[SCHEDULER] Sync failed league ${leagueId}:`, e.message); errors++; }
  }
  console.log(`[SCHEDULER] Daily sync done: ${totalCreated} new fixtures, ${errors} errors`);
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

function startScheduler() {
  if (!cron.validate(SYNC_SCHEDULE)) { console.error(`[SCHEDULER] Invalid cron: ${SYNC_SCHEDULE}`); return; }
  cron.schedule(SYNC_SCHEDULE, runDailySync, { timezone: 'UTC' });
  console.log(`[SCHEDULER] Daily fixture sync: ${SYNC_SCHEDULE} UTC`);
  cron.schedule('30 23 * * *', runResultsSync, { timezone: 'UTC' });
  console.log('[SCHEDULER] Results sync: 23:30 UTC daily');
  cron.schedule('0 * * * *', runSubscriptionExpiryCheck, { timezone: 'UTC' });
  console.log('[SCHEDULER] Subscription expiry check: every hour');
  cron.schedule('15 6 * * *', runConfidenceScoring, { timezone: 'UTC' });
  console.log('[SCHEDULER] Confidence scoring: 06:15 UTC daily');
}

module.exports = { startScheduler, runDailySync, runResultsSync, runSubscriptionExpiryCheck };
