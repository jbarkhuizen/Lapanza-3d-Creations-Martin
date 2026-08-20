#!/usr/bin/env bash
# One-time VPS setup for AlmaLinux/RHEL/CentOS. Run as root on a fresh VPS:
#   ssh root@YOUR_VPS_IP 'bash -s' < bootstrap-vps.sh
#
# Installs Node 20, nginx, certbot, git, build tools; creates a non-root
# "deploy" user with sudo (wheel); opens the firewall for SSH/HTTP/HTTPS only.
# Idempotent-ish -- safe to re-run.

set -euo pipefail

DEPLOY_USER="deploy"
DEPLOY_PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEu87hzq0KoCiNW5exKUqmG+mmzv4DiYW7Ff5c845e4d lapanza-deploy"

echo "==> Updating system packages"
dnf update -y

echo "==> Installing base packages"
dnf install -y curl git gcc gcc-c++ make python3 nginx firewalld

echo "==> Installing EPEL (needed for certbot)"
dnf install -y epel-release
dnf install -y certbot python3-certbot-nginx

echo "==> Installing Node.js 22 LTS"
# better-sqlite3 in this project's package.json requires Node >=22.
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
  dnf install -y nodejs
fi
node -v
npm -v

echo "==> Installing rclone (offsite backup sync)"
# Not in AlmaLinux's default repos even with EPEL -- rclone's own installer
# handles arch detection and is the officially documented install path.
if ! command -v rclone >/dev/null 2>&1; then
  curl -fsSL https://rclone.org/install.sh | bash
fi
rclone --version | head -1

echo "==> Creating deploy user (if missing)"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd -m -G wheel "$DEPLOY_USER"
  passwd -l "$DEPLOY_USER"   # lock password login -- key-only for this account
fi

echo "==> Installing deploy user's SSH key"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
grep -qxF "$DEPLOY_PUBKEY" "/home/$DEPLOY_USER/.ssh/authorized_keys" 2>/dev/null || \
  echo "$DEPLOY_PUBKEY" >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"

echo "==> Allow deploy user passwordless sudo (needed by deploy-app.sh for systemd/nginx)"
echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$DEPLOY_USER"
chmod 440 "/etc/sudoers.d/90-$DEPLOY_USER"

echo "==> Firewall (SSH + HTTP/HTTPS only)"
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=ssh
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload

echo "==> Enabling nginx"
systemctl enable nginx

echo "==> Creating app directory"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/lapanza

echo ""
echo "==================================================================="
echo "Bootstrap done. From your own machine, verify key login works:"
echo "  ssh -i ~/.ssh/lapanza_vps_deploy $DEPLOY_USER@<VPS_IP>"
echo ""
echo "Next: run deploy-app.sh as the deploy user inside /opt/lapanza."
echo "==================================================================="
