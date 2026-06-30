'use strict';

const nodemailer = require('nodemailer');

let _transport = null;

function getTransport() {
  if (_transport) return _transport;
  _transport = nodemailer.createTransport({
    host:   process.env.SMTP_HOST   || process.env.MAIL_HOST   || 'smtp.gmail.com',
    port:   parseInt(process.env.SMTP_PORT   || process.env.MAIL_PORT)  || 587,
    secure: (process.env.SMTP_SECURE || process.env.MAIL_SECURE) === 'true',
    auth: {
      user: process.env.SMTP_USER || process.env.MAIL_USER,
      pass: process.env.SMTP_PASS || process.env.MAIL_PASS,
    },
  });
  return _transport;
}

async function sendMail({ to, subject, html, text }) {
  const user = process.env.SMTP_USER || process.env.MAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.MAIL_PASS;
  if (!user || !pass) {
    console.warn('[MAILER] Not configured — skipping send to', to);
    return;
  }
  const from = process.env.EMAIL_FROM || process.env.MAIL_FROM || ('Rooted Predictions <' + user + '>');
  try {
    await getTransport().sendMail({ from, to, subject, html, text });
    console.log('[MAILER] Sent "' + subject + '" to ' + to);
  } catch (e) {
    console.error('[MAILER] Send failed:', e.message);
  }
}

module.exports = { sendMail };
