#!/usr/bin/env bash
# =============================================================
# AfroPredict — Re-deploy script (run on server after git pull)
# Usage: bash redeploy.sh
# =============================================================

set -euo pipefail

APP_DIR="/var/www/afropredict"

echo "==> Pulling latest code..."
cd "$APP_DIR"
git pull origin master

echo "==> Installing/updating dependencies..."
npm install --production --omit=dev

echo "==> Applying database migrations before reloading..."
node config/migrate.js
node config/migrate_auth.js

echo "==> Reloading PM2..."
pm2 reload ecosystem.config.js --env production --update-env

echo "==> PM2 status:"
pm2 status

echo ""
echo "==> Done. Verify: https://www.afropredict.com/api/health"
