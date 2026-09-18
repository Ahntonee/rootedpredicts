'use strict';
const { sendEmail } = require('../utils/email');
const { tierForPlan } = require('./membership');
const durations = Object.freeze({ biweekly: 14, monthly: 30, quarterly: 90, yearly: 365 });
function durationDays(duration = 'monthly') {
  if (!Object.hasOwn(durations, duration)) throw new Error('Choose a valid subscription duration.');
  return durations[duration];
}

// Persist the notice before changing status, so a restart cannot lose it.
async function expireDue(db, userId) {
  const filter = userId == null ? '' : ' AND s.user_id = ?';
  const args = userId == null ? [] : [userId];
  await db.query(`INSERT IGNORE INTO subscription_expiry_notifications (subscription_id, user_id, plan)
    SELECT s.id, s.user_id, s.plan FROM subscriptions s
    WHERE s.status IN ('active','trialing','cancelled')
      AND (s.expires_at <= NOW() OR (s.status='trialing' AND s.trial_ends_at <= NOW()))${filter}`, args);
  await db.query(`UPDATE subscriptions s SET status='expired', updated_at=NOW()
    WHERE s.status IN ('active','trialing','cancelled')
      AND (s.expires_at <= NOW() OR (s.status='trialing' AND s.trial_ends_at <= NOW()))${filter}`, args);
  await db.query(`UPDATE users u SET role='user', updated_at=NOW()
    WHERE u.role='vip' ${userId == null ? '' : 'AND u.id = ?'}
    AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id=u.id
      AND s.status IN ('active','trialing','cancelled') AND s.expires_at > NOW()
      AND (s.status <> 'trialing' OR s.trial_ends_at IS NULL OR s.trial_ends_at > NOW()))`, args);
}

async function sendExpiryEmails(db, userId) {
  const [rows] = await db.query(`SELECT n.id, n.plan, u.email FROM subscription_expiry_notifications n
    JOIN users u ON u.id=n.user_id WHERE n.email_sent_at IS NULL
    AND (n.email_attempt_at IS NULL OR n.email_attempt_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE))
    ${userId == null ? '' : 'AND n.user_id=?'} ORDER BY n.id LIMIT 100`, userId == null ? [] : [userId]);
  let sent = 0;
  for (const row of rows) {
    const [claim] = await db.query(`UPDATE subscription_expiry_notifications SET email_attempt_at=NOW()
      WHERE id=? AND email_sent_at IS NULL
      AND (email_attempt_at IS NULL OR email_attempt_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE))`, [row.id]);
    if (!claim.affectedRows) continue;
    const plan = tierForPlan(row.plan) === 'standard' ? 'Standard' : 'Deluxe';
    const result = await sendEmail({ to: row.email, subject: 'Your ' + plan + ' subscription has expired',
      html: '<h2>Your ' + plan + ' subscription has expired</h2><p>VIP access for this subscription has ended. If you have not renewed or activated another plan, your account now has Free access.</p><p>Log in and visit the subscription page to renew, or contact our support team for help.</p>' });
    if (result.success) {
      await db.query('UPDATE subscription_expiry_notifications SET email_sent_at=NOW() WHERE id=?', [row.id]);
      sent++;
    }
  }
  return sent;
}
module.exports = { durationDays, expireDue, sendExpiryEmails };
