'use strict';

const nodemailer = require('nodemailer');

let _transport = null;

function getTransport() {
  if (_transport) return _transport;
  _transport = nodemailer.createTransport({
    host:   process.env.MAIL_HOST   || 'smtp.gmail.com',
    port:   parseInt(process.env.MAIL_PORT) || 587,
    secure: process.env.MAIL_SECURE === 'true',
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });
  return _transport;
}

async function sendMail({ to, subject, html, text }) {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    console.warn('[MAILER] Not configured — skipping send to', to, '| Set MAIL_USER + MAIL_PASS in .env');
    return;
  }
  const from = process.env.MAIL_FROM || `Rooted Predictions <${process.env.MAIL_USER}>`;
  try {
    await getTransport().sendMail({ from, to, subject, html, text });
    console.log(`[MAILER] Sent "${subject}" to ${to}`);
  } catch (e) {
    console.error('[MAILER] Send failed:', e.message);
  }
}

module.exports = { sendMail };
