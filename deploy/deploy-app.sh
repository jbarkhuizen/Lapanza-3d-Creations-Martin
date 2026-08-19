#!/usr/bin/env bash
# Run as the "deploy" user on the VPS, from /opt/lapanza, after bootstrap-vps.sh.
# First run: clones the repo. Later runs: pulls latest, rebuilds, restarts.
#
#   ssh deploy@YOUR_VPS_IP
#   cd /opt/lapanza && bash deploy-app.sh          # (or curl it down first run)

set -euo pipefail

REPO_URL="https://github.com/jbarkhuizen/Lapanza-3d-Creations-Martin.git"
APP_DIR="/opt/lapanza/app"

if [ ! -d "$APP_DIR/.git" ]; then
  echo "==> Cloning repo (first run)"
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

echo "==> Pulling latest main"
git fetch origin
git checkout main
git pull origin main

echo "==> Installing dependencies"
npm ci

echo "==> Building static site"
npm run build

if [ ! -f .env ]; then
  echo "==> No .env found -- copying template. EDIT THIS BEFORE GOING LIVE:"
  cp deploy/.env.production.template .env
  echo "    nano /opt/lapanza/app/.env"
fi

echo "==> Installing/refreshing systemd service"
sudo cp deploy/lapanza-admin.service /etc/systemd/system/lapanza-admin.service
sudo systemctl daemon-reload
sudo systemctl enable lapanza-admin
sudo systemctl restart lapanza-admin

if [ ! -f /etc/nginx/conf.d/lapanza.conf ]; then
  echo "==> Installing nginx site (first run)"
  # RHEL/AlmaLinux nginx auto-includes /etc/nginx/conf.d/*.conf -- no
  # sites-available/sites-enabled convention here (that's Debian's).
  sudo cp deploy/nginx-lapanza.conf /etc/nginx/conf.d/lapanza.conf
  sudo nginx -t
  sudo systemctl restart nginx
else
  # Once certbot has run, this file has "managed by Certbot" SSL blocks
  # appended -- blindly re-copying the plain-HTTP template here would
  # silently drop HTTPS (port 443) on every future deploy. Edit the live
  # file directly (or re-run certbot) for nginx config changes instead.
  echo "==> nginx site already configured -- leaving /etc/nginx/conf.d/lapanza.conf as-is (certbot manages it)"
  sudo nginx -t
  sudo systemctl reload nginx
fi

echo ""
echo "==================================================================="
echo "Deployed. Check status:"
echo "  sudo systemctl status lapanza-admin"
echo "  curl -s http://127.0.0.1:8787/api/health"
echo "==================================================================="
