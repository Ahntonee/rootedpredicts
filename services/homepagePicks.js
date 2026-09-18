'use strict';
const { requiredTier } = require('./membership');
// Unique slots enforce the daily cap even when two admins select picks at once.
async function selectHomepagePick(db, id, selected) {
  if (typeof selected !== 'boolean') throw new Error('Select or remove a homepage pick.');
  if (!selected) { await db.query('DELETE FROM homepage_picks WHERE prediction_id=?', [id]); return; }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[prediction]] = await conn.query("SELECT *, DATE_FORMAT(match_date, '%Y-%m-%d') AS pick_date FROM predictions WHERE id=? FOR UPDATE", [id]);
    if (!prediction || !prediction.published_at || prediction.result === 'void' || requiredTier(prediction) !== 'free') {
      throw new Error('Only published free predictions can appear on the homepage.');
    }
    await conn.query('DELETE FROM homepage_picks WHERE prediction_id=?', [id]);
    // Release slots occupied by deleted, moved, unpublished or upgraded predictions.
    await conn.query(`DELETE h FROM homepage_picks h LEFT JOIN predictions p ON p.id=h.prediction_id
      WHERE h.pick_date=? AND (p.id IS NULL OR DATE(p.match_date)<>h.pick_date OR p.published_at IS NULL
      OR p.result='void' OR p.access_tier IN ('standard','deluxe')
      OR (p.visibility='vip' AND COALESCE(p.category,'')<>'Banker of the Day'))`, [prediction.pick_date]);
    let added = false;
    for (let slot = 1; slot <= 10; slot++) {
      try {
        await conn.query('INSERT INTO homepage_picks (pick_date, slot, prediction_id) VALUES (?,?,?)', [prediction.pick_date, slot, id]);
        added = true; break;
      } catch (error) { if (error.code !== 'ER_DUP_ENTRY') throw error; }
    }
    if (!added) throw new Error('This day already has 10 homepage picks. Remove one first. This prediction remains published in its category.');
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}
// Follow the actual tip when a standard market's saved category is stale.
// Safe Tips and Acca are intentional editorial groupings, not single markets.
const categorySql = `CASE WHEN p.category IN ('Banker of the Day','Acca Tips') THEN p.category
  WHEN LOWER(TRIM(p.tip)) REGEXP '^(over|under) +1[.]5$' THEN '1.5 Goals'
  WHEN LOWER(TRIM(p.tip)) REGEXP '^(over|under) +2[.]5$' THEN '2.5 Goals'
  WHEN LOWER(TRIM(p.tip)) REGEXP '^(over|under) +3[.]5$' THEN '3.5 Goals'
  WHEN LOWER(TRIM(p.tip)) REGEXP '^btts( +|-|$)' THEN 'BTTS'
  WHEN p.market='BTTS' THEN 'BTTS'
  WHEN p.market='Double Chance' THEN 'Double Chance'
  WHEN p.market='Accumulator' THEN 'Acca Tips'
  WHEN p.tip='Home Win' THEN 'Home Win'
  WHEN p.tip='Away Win' THEN 'Away Win'
  WHEN p.category IS NOT NULL AND p.category NOT IN ('','Free Pick') THEN p.category
  ELSE 'Free Pick' END`;
module.exports = { selectHomepagePick, categorySql };
