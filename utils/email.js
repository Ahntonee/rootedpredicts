// utils/email.js
// Rooted Predictions — Email sending utility via Nodemailer
// Used for: welcome emails, password reset, VIP confirmation

'use strict';

const nodemailer = require('nodemailer');

// Create transporter once — reused across all email calls
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send a generic email
 */
async function sendEmail({ to, subject, html, text }) {
  const mailOptions = {
    from:    process.env.EMAIL_FROM || 'Rooted Predictions <noreply@rootedpredict.com>',
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]*>/g, ''), // Fallback plain text
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] Sent to ${to}: ${subject} (ID: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`[EMAIL] Failed to send to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Welcome email sent on new user registration
 */
async function sendWelcomeEmail(user) {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background:#0B2A1A;font-family:Inter,Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0B2A1A;">
        <tr><td align="center" style="padding:40px 20px;">
          <table width="600" cellpadding="0" cellspacing="0" style="background:#0D3D22;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#1A8A44;padding:24px 40px;text-align:center;">
                <h1 style="color:#fff;margin:0;font-size:28px;letter-spacing:1px;">ROOTEDPREDICT</h1>
                <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Precision Tips. Global Reach. Real Results.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:40px;">
                <h2 style="color:#fff;margin:0 0 16px;font-size:22px;">Welcome, ${user.name}!</h2>
                <p style="color:#CBD5E1;line-height:1.7;margin:0 0 16px;">Your Rooted Predictions account is ready. You now have access to free daily football predictions across 1,200+ leagues worldwide.</p>
                <p style="color:#CBD5E1;line-height:1.7;margin:0 0 24px;">Your free account includes:</p>
                <ul style="color:#CBD5E1;line-height:2;margin:0 0 32px;padding-left:20px;">
                  <li>Daily free football tips</li>
                  <li>Bookmark your favourite predictions</li>
                  <li>Track your bets with our history tool</li>
                  <li>Comment on prediction cards</li>
                </ul>
                <a href="${process.env.SITE_URL}/dashboard"
                   style="display:inline-block;background:#1A8A44;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">
                  Go to My Dashboard
                </a>
                <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:32px 0;">
                <p style="color:#6B7280;font-size:13px;line-height:1.6;margin:0;">
                  Want premium VIP tips, early access, and Telegram alerts?
                  <a href="${process.env.SITE_URL}/pricing" style="color:#1A8A44;">Upgrade to VIP from $4.89/month.</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#0B2A1A;padding:20px 40px;text-align:center;">
                <p style="color:#4B5563;font-size:12px;margin:0;">
                  Rooted Predictions — ${process.env.SITE_URL}<br>
                  You are receiving this email because you registered at Rooted Predictions.<br>
                  Please gamble responsibly. Predictions are for informational purposes only.
                </p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;

  return sendEmail({ to: user.email, subject: 'Welcome to Rooted Predictions — Your account is ready', html });
}

/**
 * Password reset email with secure token link
 */
async function sendPasswordResetEmail(user, resetToken) {
  const resetUrl = `${process.env.SITE_URL}/reset-password?token=${resetToken}`;
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background:#0B2A1A;font-family:Inter,Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0B2A1A;">
        <tr><td align="center" style="padding:40px 20px;">
          <table width="600" cellpadding="0" cellspacing="0" style="background:#0D3D22;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#1A8A44;padding:24px 40px;text-align:center;">
                <h1 style="color:#fff;margin:0;font-size:28px;">ROOTEDPREDICT</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:40px;">
                <h2 style="color:#fff;margin:0 0 16px;">Reset Your Password</h2>
                <p style="color:#CBD5E1;line-height:1.7;margin:0 0 24px;">We received a request to reset the password for your account (${user.email}). Click the button below to set a new password. This link expires in 1 hour.</p>
                <a href="${resetUrl}"
                   style="display:inline-block;background:#1A8A44;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">
                  Reset Password
                </a>
                <p style="color:#6B7280;font-size:13px;margin:24px 0 0;">If you did not request this, you can safely ignore this email. Your password will not change.</p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;

  return sendEmail({ to: user.email, subject: 'Rooted Predictions — Password Reset Request', html });
}

/**
 * Email verification OTP sent during registration
 */
async function sendVerificationEmail(user, token) {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background:#0B2A1A;font-family:Inter,Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0B2A1A;">
        <tr><td align="center" style="padding:40px 20px;">
          <table width="600" cellpadding="0" cellspacing="0" style="background:#0D3D22;border-radius:12px;overflow:hidden;max-width:600px;">
            <tr>
              <td style="background:#1A8A44;padding:24px 40px;text-align:center;">
                <h1 style="color:#fff;margin:0;font-size:28px;letter-spacing:1px;">ROOTEDPREDICT</h1>
                <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Verify your email to complete registration</p>
              </td>
            </tr>
            <tr>
              <td style="padding:40px;">
                <h2 style="color:#fff;margin:0 0 12px;font-size:20px;">Hi ${user.name},</h2>
                <p style="color:#CBD5E1;line-height:1.7;margin:0 0 28px;">Enter the 6-digit code below to verify your email and create your Rooted Predictions account. This code expires in <strong style="color:#fff;">15 minutes</strong>.</p>
                <div style="background:#0B2A1A;border:1px solid rgba(26,138,68,0.35);border-radius:10px;padding:28px;text-align:center;margin-bottom:28px;">
                  <div style="font-size:48px;font-weight:900;letter-spacing:16px;color:#D4A017;font-family:Courier New,monospace;">${token}</div>
                </div>
                <p style="color:#6B7280;font-size:13px;line-height:1.6;margin:0;">If you did not attempt to register at Rooted Predictions, you can safely ignore this email. No account will be created without the code.</p>
              </td>
            </tr>
            <tr>
              <td style="background:#0B2A1A;padding:20px 40px;text-align:center;">
                <p style="color:#4B5563;font-size:12px;margin:0;">
                  Rooted Predictions — ${process.env.SITE_URL || 'rootedpredict.com'}<br>
                  Please gamble responsibly. 18+ only.
                </p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;

  return sendEmail({
    to:      user.email,
    subject: `${token} — Your Rooted Predictions verification code`,
    html,
  });
}

/**
 * VIP confirmation email sent after successful payment
 */
async function sendVipConfirmationEmail(user, plan) {
  const telegramLink = process.env.TELEGRAM_VIP_INVITE_LINK || '#';
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background:#0B2A1A;font-family:Inter,Arial,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0B2A1A;">
        <tr><td align="center" style="padding:40px 20px;">
          <table width="600" cellpadding="0" cellspacing="0" style="background:#0D3D22;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#1A8A44;padding:24px 40px;text-align:center;">
                <h1 style="color:#fff;margin:0;font-size:28px;">ROOTEDPREDICT VIP</h1>
                <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;">You are now a VIP member</p>
              </td>
            </tr>
            <tr>
              <td style="padding:40px;">
                <h2 style="color:#fff;margin:0 0 16px;">Welcome to VIP, ${user.name}!</h2>
                <p style="color:#CBD5E1;line-height:1.7;margin:0 0 16px;">Your <strong style="color:#1A8A44;">${plan}</strong> subscription is now active. You have full access to all VIP features.</p>
                <ul style="color:#CBD5E1;line-height:2;margin:0 0 24px;padding-left:20px;">
                  <li>Premium high-confidence VIP tip cards</li>
                  <li>Early access predictions (2 hours before public)</li>
                  <li>Full match analysis and H2H breakdowns</li>
                  <li>Exclusive Telegram VIP channel</li>
                </ul>
                <a href="${telegramLink}"
                   style="display:inline-block;background:#0088CC;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin-bottom:16px;">
                  Join Telegram VIP Channel
                </a>
                <br>
                <a href="${process.env.SITE_URL}/dashboard"
                   style="display:inline-block;background:#1A8A44;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">
                  View VIP Predictions
                </a>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;

  return sendEmail({ to: user.email, subject: 'Rooted Predictions VIP — Your subscription is active', html });
}

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendVipConfirmationEmail,
};
