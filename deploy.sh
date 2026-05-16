#!/usr/bin/env bash
# =============================================================
# AfroPredict — Phase 10: Production Deployment Script
# Target: Ubuntu 22.04 LTS on DigitalOcean ($6/mo Droplet)
#
# Run this script ONCE on a fresh Droplet as root.
# After first run use the daily workflow at the bottom.
# =============================================================

set -euo pipefail

APP_DIR="/var/www/afropredict"
APP_USER="afropredict"
NODE_VERSION="20"

# ── Step 1: System packages ─────────────────────────────────
echo "==> Updating system..."
apt-get update -y && apt-get upgrade -y
apt-get install -y curl git nginx mysql-server ufw certbot python3-certbot-nginx

# ── Step 2: Node.js via nvm (system-wide) ───────────────────
echo "==> Installing Node.js ${NODE_VERSION}..."
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt-get install -y nodejs
node -v && npm -v

# ── Step 3: PM2 globally ────────────────────────────────────
echo "==> Installing PM2..."
npm install -g pm2
pm2 startup systemd -u ${APP_USER} --hp /home/${APP_USER}

# ── Step 4: Create app user ─────────────────────────────────
echo "==> Creating app user..."
id -u ${APP_USER} &>/dev/null || useradd -m -s /bin/bash ${APP_USER}
mkdir -p ${APP_DIR}
chown -R ${APP_USER}:${APP_USER} ${APP_DIR}

# ── Step 5: MySQL setup ─────────────────────────────────────
echo "==> Configuring MySQL..."
mysql -u root <<'SQL'
CREATE DATABASE IF NOT EXISTS `afropredict`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'afropredict_user'@'localhost'
  IDENTIFIED BY 'CHANGE_THIS_DB_PASSWORD';
GRANT ALL PRIVILEGES ON `afropredict`.* TO 'afropredict_user'@'localhost';
FLUSH PRIVILEGES;
SQL
# IMPORTANT: Replace CHANGE_THIS_DB_PASSWORD above and in your .env

# ── Step 6: UFW firewall ────────────────────────────────────
echo "==> Configuring firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status

# ── Step 7: Deploy application code ─────────────────────────
# Run these commands as the afropredict user:
echo ""
echo "==> Now switch to app user and deploy:"
echo "    sudo -u ${APP_USER} bash"
echo "    cd ${APP_DIR}"
echo "    git clone https://github.com/YOUR_USERNAME/afropredict.git ."
echo "    cp .env.example .env   # then fill in all values!"
echo "    nano .env"
echo "    npm install --production"
echo "    node config/migrate.js"
echo "    pm2 start ecosystem.config.js --env production"
echo "    pm2 save"

# ── Step 8: Nginx configuration ─────────────────────────────
echo ""
echo "==> Copying Nginx config..."
cp nginx.conf.example /etc/nginx/sites-available/afropredict
ln -sf /etc/nginx/sites-available/afropredict /etc/nginx/sites-enabled/afropredict
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── Step 9: SSL with Let's Encrypt ──────────────────────────
echo ""
echo "==> Obtaining SSL certificate..."
echo "    Run: certbot --nginx -d afropredict.com -d www.afropredict.com"
echo "    Certbot will update your Nginx config automatically."
echo "    Auto-renewal is configured by: certbot renew --dry-run"

echo ""
echo "============================================================"
echo "DEPLOYMENT COMPLETE. Verify at: https://www.afropredict.com"
echo "============================================================"
echo ""
echo "POST-DEPLOY CHECKLIST:"
echo "  [ ] Fill ALL values in .env (Stripe, Paystack, SMTP, JWT)"
echo "  [ ] Set SITE_URL=https://www.afropredict.com in .env"
echo "  [ ] Change DB password in MySQL and .env"
echo "  [ ] Login to /admin — change default password immediately"
echo "  [ ] Set up Stripe webhooks to: https://www.afropredict.com/api/webhooks/stripe"
echo "  [ ] Set up Paystack webhooks to: https://www.afropredict.com/api/webhooks/paystack"
echo "  [ ] Submit sitemap to Google Search Console"
echo "  [ ] Verify robots.txt at https://www.afropredict.com/robots.txt"
