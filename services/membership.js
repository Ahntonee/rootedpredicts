'use strict';
function tierForPlan(plan) {
  if (plan === 'standard' || plan === 'deluxe') return plan;
  return ['monthly', 'quarterly', 'annual'].includes(plan) ? (process.env.LEGACY_VIP_TIER || 'deluxe') : 'free';
}
async function attachMembership(db, user) {
  if (!user || user.role !== 'vip') return user;
  await require('./subscriptionExpiry').expireDue(db, user.id);
  const [rows] = await db.query("SELECT plan, expires_at FROM subscriptions WHERE user_id=? AND status IN ('active','trialing','cancelled') AND expires_at > NOW() AND (status <> 'trialing' OR trial_ends_at IS NULL OR trial_ends_at > NOW()) ORDER BY expires_at DESC", [user.id]);
  const tiers = rows.map(row => tierForPlan(row.plan));
  user.membership_tier = tiers.includes('deluxe') ? 'deluxe' : tiers.includes('standard') ? 'standard' : 'free';
  if (user.membership_tier === 'free') user.role = 'user';
  return user;
}
function requiredTier(prediction) {
  if (['standard', 'deluxe'].includes(prediction.access_tier)) return prediction.access_tier;
  return prediction.visibility === 'vip' && prediction.category !== 'Banker of the Day' ? 'standard' : 'free';
}
function canAccess(prediction, user) {
  const tier = requiredTier(prediction);
  return tier === 'free' || user?.role === 'admin' || user?.membership_tier === 'deluxe' || (tier === 'standard' && user?.membership_tier === 'standard');
}
function maskPrediction(prediction, user) {
  if (canAccess(prediction, user)) return { ...prediction, locked: false };
  return { ...prediction, required_plan: requiredTier(prediction), tip: null, odds: null, analysis: null, alt_tips: null, odds_data: null, h2h_summary: null, confidence_score: null, locked: true };
}
module.exports = { tierForPlan, attachMembership, requiredTier, canAccess, maskPrediction };
