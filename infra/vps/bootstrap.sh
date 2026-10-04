#!/usr/bin/env bash
# One-time preparation of a fresh Contabo VPS (Ubuntu 22.04/24.04), run as root:
#   curl -fsSL <raw url of this file> -o bootstrap.sh && less bootstrap.sh && bash bootstrap.sh
# Installs Docker, hardens SSH/firewall, creates the deploy user and directory layout.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
BASE=/srv/newsmedia

echo "==> system packages"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg ufw fail2ban unattended-upgrades

echo "==> docker (official apt repository)"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

echo "==> deploy user"
id -u "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

echo "==> firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> ssh hardening (key-only login)"
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd || true

echo "==> automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> swap (2G) if none"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> directory layout"
for env in production staging; do
  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE/$env" "$BASE/$env/data/backups"
  install -d "$BASE/$env/data/postgres" "$BASE/$env/data/typesense"
  # web and worker run as the image's "node" user (uid 1000)
  install -d -o 1000 -g 1000 "$BASE/$env/data/media"
done
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BASE/edge"
docker network inspect edge >/dev/null 2>&1 || docker network create edge

cat <<MSG

Done. Next steps (see docs/DEPLOYMENT.md):
  1. Add the GitHub Actions deploy public key to /home/$DEPLOY_USER/.ssh/authorized_keys
  2. As $DEPLOY_USER: docker login ghcr.io (token with read:packages), unless the images are public
  3. Create $BASE/edge/{compose.yml,Caddyfile,.env,staging_users.caddy} and start Caddy
  4. Create $BASE/<environment>/.env from infra/env/app.env.example
  5. Push to develop (staging) or main (production) — GitHub Actions does the rest
MSG
