// services/telegram.js
// Rooted Predictions — Telegram bot notification service
//
// Sends new auto-predicted tips to a Telegram channel/group.
// Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.
'use strict';

const TELEGRAM_API = 'https://api.telegram.org';

function isConfigured() {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

async function sendMessage(text, parseMode) {
  if (!isConfigured()) return;
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const body = {
    chat_id:    chatId,
    text,
    parse_mode: parseMode || 'HTML',
    disable_web_page_preview: true,
  };
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json();
}

function confidenceBar(score) {
  const filled = Math.round((score / 100) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${score}%`;
}

function formatPrediction(p) {
  const base    = process.env.SITE_URL || 'https://www.rootedpredict.com';
  const time    = p.match_date
    ? new Date(p.match_date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
    : '';
  const league  = [p.league_name, p.league_country].filter(Boolean).join(' · ');
  const detailUrl = p.slug ? `${base}/prediction/${p.slug}` : base;
  const oddsStr   = p.odds ? ` @ <b>${parseFloat(p.odds).toFixed(2)}</b>` : '';
  const confStr   = p.confidence_score ? `\n📊 ${confidenceBar(p.confidence_score)}` : '';

  return [
    `⚽ <b>${p.home_team} vs ${p.away_team}</b>`,
    league  ? `🏆 ${league}`                  : '',
    time    ? `🕐 ${time}`                     : '',
    `\n🎯 Tip: <b>${p.tip || 'TBD'}</b>${oddsStr}`,
    confStr,
    `\n🔗 <a href="${detailUrl}">View full analysis</a>`,
  ].filter(Boolean).join('\n');
}

/**
 * Post a batch of new predictions to the Telegram channel.
 * Sends one intro message, then one message per prediction.
 * Falls back silently if Telegram is not configured.
 *
 * @param {Array}  predictions   Rows returned by autoPredictFixtures
 * @param {object} meta          { date, generated, total }
 */
async function sendPredictions(predictions, meta) {
  if (!isConfigured() || !predictions || !predictions.length) return;

  meta = meta || {};
  const dateLabel = meta.date || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  try {
    // Header message
    await sendMessage(
      `🔥 <b>Rooted Predictions — ${dateLabel}</b>\n` +
      `✅ <b>${predictions.length} tip${predictions.length !== 1 ? 's' : ''}</b> just published!\n\n` +
      `Free high-confidence picks below 👇`
    );

    // One message per prediction (Telegram has a 4096-char limit per message)
    for (const p of predictions) {
      await sendMessage(formatPrediction(p));
      // Small delay to avoid Telegram flood limits (30 messages/second group limit)
      await new Promise(r => setTimeout(r, 350));
    }

    // Footer CTA
    const base = process.env.SITE_URL || 'https://www.rootedpredict.com';
    await sendMessage(
      `📱 See all tips with full analysis:\n${base}/predictions.html\n\n` +
      `🔒 VIP tips: ${base}/pricing.html`
    );

    console.log(`[TELEGRAM] Sent ${predictions.length} predictions to channel`);
  } catch (e) {
    console.error('[TELEGRAM] Failed to send predictions:', e.message);
  }
}

/**
 * Send a simple text notification to the channel.
 */
async function notify(text) {
  if (!isConfigured()) return;
  try {
    await sendMessage(text);
  } catch (e) {
    console.error('[TELEGRAM] notify failed:', e.message);
  }
}

module.exports = { sendPredictions, notify, isConfigured };
