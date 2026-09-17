'use strict';
const db = require('../config/db');
async function recentForm(team, before, stored) {
  const saved = String(stored || '').toUpperCase().replace(/[^WDL]/g, '').slice(0, 5);
  const [rows] = await db.query(`SELECT DISTINCT home_team, away_team, home_score, away_score, match_date
    FROM predictions WHERE (home_team = ? OR away_team = ?) AND match_date < ?
    AND home_score IS NOT NULL AND away_score IS NOT NULL AND status_short IN ('FT','AET','PEN')
    ORDER BY match_date DESC LIMIT 5`, [team, team, before]);
  const form = rows.map(row => {
    const home = row.home_team === team;
    const scored = Number(home ? row.home_score : row.away_score);
    const conceded = Number(home ? row.away_score : row.home_score);
    return scored === conceded ? 'D' : scored > conceded ? 'W' : 'L';
  }).join('');
  return form.length >= saved.length ? form : saved;
}
async function fillRecentForm(prediction) {
  const [home, away] = await Promise.all([
    recentForm(prediction.home_team, prediction.match_date, prediction.home_form),
    recentForm(prediction.away_team, prediction.match_date, prediction.away_form),
  ]);
  prediction.home_form = home;
  prediction.away_form = away;
  return prediction;
}
module.exports = { fillRecentForm, recentForm };
