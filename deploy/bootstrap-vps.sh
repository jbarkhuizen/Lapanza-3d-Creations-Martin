#!/usr/bin/env bash
# One-time VPS setup. Run as root on a fresh Ubuntu/Debian VPS:
#   ssh root@YOUR_VPS_IP 'bash -s' < bootstrap-vps.sh
#
# Installs Node 20, nginx, certbot, git, build tools; creates a non-root
# "deploy" user with sudo; opens the firewall for SSH/HTTP/HTTPS only.
# Idempotent-ish -- safe to re-run.

set -euo pipefail

DEPLOY_USER="deploy"
DEPLOY_PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEu87hzq0KoCiNW5exKUqmG+mmzv4DiYW7Ff5c845e4d lapanza-deploy"

echo "==> Updating system packages"
apt-get update -y
apt-get upgrade -y

echo "==> Installing base packages"
apt-get install -y curl git build-essential python3 ufw nginx certbot python3-certbot-nginx

echo "==> Installing Node.js 20 LTS"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

echo "==> Creating deploy user (if missing)"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  usermod -aG sudo "$DEPLOY_USER"
fi

echo "==> Installing deploy user's SSH key"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
grep -qxF "$DEPLOY_PUBKEY" "/home/$DEPLOY_USER/.ssh/authorized_keys" 2>/dev/null || \
  echo "$DEPLOY_PUBKEY" >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"

echo "==> Firewall (OpenSSH + HTTP/HTTPS only)"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> Creating app directory"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/lapanza

echo ""
echo "==================================================================="
echo "Bootstrap done. From your own machine, verify key login works:"
echo "  ssh -i ~/.ssh/lapanza_vps_deploy $DEPLOY_USER@<VPS_IP>"
echo ""
echo "Once that works, do NOT rely on the root password for this box"
echo "again for app deploys -- use the deploy user. Next: run"
echo "deploy-app.sh as the deploy user inside /opt/lapanza."
echo "==================================================================="
