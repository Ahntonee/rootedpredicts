'use strict';

const db         = require('../config/db');
const { sendMail } = require('../services/mailer');

// ── POST /api/newsletter/subscribe  (public)
async function subscribe(req, res) {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const name  = (req.body.name  || '').trim().slice(0, 100);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    // Upsert — if previously unsubscribed, reactivate
    await db.query(
      `INSERT INTO newsletter_subscribers (email, name, status, subscribed_at)
       VALUES (?, ?, 'active', NOW())
       ON DUPLICATE KEY UPDATE
         status = 'active',
         name   = IF(VALUES(name) != '', VALUES(name), name),
         subscribed_at = IF(status = 'unsubscribed', NOW(), subscribed_at),
         unsubscribed_at = NULL`,
      [email, name]
    );

    return res.json({ success: true, message: 'You are now subscribed to Rooted Predictions updates!' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// ── POST /api/newsletter/unsubscribe  (public — via email link)
async function unsubscribe(req, res) {
  try {
    const email = (req.query.email || req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, message: 'Email required.' });

    await db.query(
      `UPDATE newsletter_subscribers SET status='unsubscribed', unsubscribed_at=NOW() WHERE email=?`,
      [email]
    );
    return res.json({ success: true, message: 'You have been unsubscribed.' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// ── GET /api/admin/newsletter/subscribers  (superadmin)
async function adminListSubscribers(req, res) {
  try {
    const status = req.query.status || 'active';
    const [rows] = await db.query(
      `SELECT id, email, name, status, subscribed_at FROM newsletter_subscribers
       WHERE status = ? ORDER BY subscribed_at DESC`,
      [status]
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM newsletter_subscribers WHERE status = ?`, [status]
    );
    return res.json({ success: true, data: rows, total });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

// ── POST /api/admin/newsletter/send  (superadmin)
async function adminSend(req, res) {
  try {
    const { subject, html, audience } = req.body;
    if (!subject || !subject.trim()) {
      return res.status(400).json({ success: false, message: 'Subject is required.' });
    }
    if (!html || !html.trim()) {
      return res.status(400).json({ success: false, message: 'Email body is required.' });
    }

    // audience: 'all_users' | 'vip' | 'free' | 'subscribers' | 'everyone'
    const aud = audience || 'all_users';
    let emails = [];

    if (aud === 'subscribers') {
      const [rows] = await db.query(
        `SELECT email, name FROM newsletter_subscribers WHERE status = 'active'`
      );
      emails = rows;
    } else if (aud === 'everyone') {
      const [users] = await db.query(`SELECT email, name FROM users WHERE status = 'active'`);
      const [subs]  = await db.query(
        `SELECT email, name FROM newsletter_subscribers WHERE status = 'active'`
      );
      // Merge, deduplicate by email
      const seen = new Set();
      for (const u of [...users, ...subs]) {
        if (!seen.has(u.email)) { seen.add(u.email); emails.push(u); }
      }
    } else {
      let roleFilter = '';
      if (aud === 'vip')  roleFilter = `AND role = 'vip'`;
      if (aud === 'free') roleFilter = `AND role = 'user'`;
      const [rows] = await db.query(
        `SELECT email, name FROM users WHERE status = 'active' ${roleFilter}`
      );
      emails = rows;
    }

    if (!emails.length) {
      return res.status(400).json({ success: false, message: 'No recipients found for the selected audience.' });
    }

    const siteUrl   = process.env.SITE_URL || 'https://www.rootedpredict.com';
    const fromLabel = process.env.EMAIL_FROM || 'Rooted Predictions <noreply@rootedpredict.com>';
    let sent = 0, failed = 0;

    // Send in small batches to avoid overwhelming SMTP
    for (const recipient of emails) {
      const unsubLink = siteUrl + '/api/newsletter/unsubscribe?email=' + encodeURIComponent(recipient.email);
      const body = html + `
        <div style="margin-top:32px;padding-top:16px;border-top:1px solid #333;font-family:sans-serif;font-size:11px;color:#888;text-align:center;">
          You received this because you signed up for Rooted Predictions updates.<br>
          <a href="${unsubLink}" style="color:#888;">Unsubscribe</a>
        </div>`;
      try {
        await sendMail({ to: recipient.email, subject: subject.trim(), html: body });
        sent++;
      } catch (e) {
        failed++;
        console.error('[NEWSLETTER] Failed to send to', recipient.email, ':', e.message);
      }
    }

    return res.json({
      success: true,
      message: 'Newsletter sent.',
      data: { sent, failed, total: emails.length },
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

module.exports = { subscribe, unsubscribe, adminListSubscribers, adminSend };
