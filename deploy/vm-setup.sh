#!/bin/sh
# One-time setup of the production VM (backend-spec 16.1, M16). Run as root on Ubuntu LTS:
#   VT_SSH_ALLOW="203.0.113.5 198.51.100.0/24" sh deploy/vm-setup.sh
# It installs Docker, opens only 80 and 443, limits SSH to the allow-list by key only, turns on
# unattended security upgrades, and checks that VT_DATA_DIR sits on an encrypted volume.
set -eu
DATA_DIR=${VT_DATA_DIR:-/srv/vt}
ALLOW=${VT_SSH_ALLOW:?set VT_SSH_ALLOW to the addresses that may use SSH}

apt-get update
apt-get install -y --no-install-recommends ca-certificates curl ufw unattended-upgrades docker.io docker-compose-v2
systemctl enable --now docker

# Firewall: 80 and 443 for everyone, SSH only from the allow-list, nothing else.
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 80/tcp
ufw allow 443/tcp
for address in $ALLOW; do ufw allow from "$address" to any port 22 proto tcp; done
ufw --force enable

# SSH by key only.
mkdir -p /etc/ssh/sshd_config.d
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' \
  > /etc/ssh/sshd_config.d/90-vt.conf
systemctl reload ssh 2>/dev/null || systemctl reload sshd

# Security upgrades without asking.
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' \
  > /etc/apt/apt.conf.d/20auto-upgrades
systemctl enable --now unattended-upgrades

# Everything the stack keeps lives under one directory on the encrypted disk.
mkdir -p "$DATA_DIR"/db "$DATA_DIR"/sheets "$DATA_DIR"/reports "$DATA_DIR"/caddy "$DATA_DIR"/backups
chmod 0700 "$DATA_DIR"
source=$(findmnt -no SOURCE --target "$DATA_DIR")
case "$source" in
  /dev/mapper/*) echo "$DATA_DIR is on an encrypted volume ($source)" ;;
  *) echo "WARNING: $DATA_DIR is on $source, which is not a LUKS volume. Use the provider's encrypted disk or set up LUKS before starting the stack (backend-spec 14.7)." ;;
esac
echo "VM setup done. Next: clone the repository, 'make prod-secrets', then 'make prod-up'."
