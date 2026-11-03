#!/bin/sh
# The production VM profile (M16). Usage: sh scripts/prod.sh secrets|up|admin|backup|restore-drill|down
# deploy/prod.env holds the secrets, the site address and the data directory. It is git-ignored
# and stays on the VM, readable by root only.
set -eu
ENV_FILE=deploy/prod.env
PROJECT=vt-prod
COMPOSE="docker compose -p $PROJECT --env-file $ENV_FILE -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml"

value() { sed -n "s/^$1=//p" "$ENV_FILE"; }

preflight() {
  [ -e "$ENV_FILE" ] || { echo "Run 'make prod-secrets VT_SITE_ADDRESS=<domain> VT_ACME_EMAIL=<email> BACKUP_AGE_RECIPIENT=<age1...>' first"; exit 1; }
  case "$(stat -c %a "$ENV_FILE")" in 600|400) ;; *) echo "$ENV_FILE must be readable by its owner only (chmod 600)"; exit 1 ;; esac
  case "$(value BACKUP_AGE_RECIPIENT)" in age1*) ;; *) echo "BACKUP_AGE_RECIPIENT in $ENV_FILE is not an age public key"; exit 1 ;; esac
  data=$(value VT_DATA_DIR)
  [ -d "$data" ] || { echo "VT_DATA_DIR=$data does not exist; run deploy/vm-setup.sh first"; exit 1; }
  source=$(findmnt -no SOURCE --target "$data" 2>/dev/null || true)
  case "$source" in
    /dev/mapper/*) ;;
    *) echo "Warning: $data is not on a LUKS volume ($source). Backend-spec 14.7 wants an encrypted disk." ;;
  esac
}

case "${1:-}" in
  secrets)
    if [ -e "$ENV_FILE" ]; then echo "$ENV_FILE exists; not overwritten"; exit 1; fi
    site=${VT_SITE_ADDRESS:?give the public host name, e.g. VT_SITE_ADDRESS=vt.example.org}
    email=${VT_ACME_EMAIL:?give the certificate contact email, e.g. VT_ACME_EMAIL=you@example.org}
    recipient=${BACKUP_AGE_RECIPIENT:?give the owner's age public key, e.g. BACKUP_AGE_RECIPIENT=age1...}
    case "$recipient" in age1*) ;; *) echo "BACKUP_AGE_RECIPIENT must start with age1"; exit 1 ;; esac
    umask 077
    r() { python3 -c 'import secrets; print(secrets.token_urlsafe(36))'; }
    {
      echo "# Production secrets (M16). Root only; never commit or copy off the VM."
      echo "VT_SITE_ADDRESS=$site"
      echo "VT_ACME_EMAIL=$email"
      echo "VT_DATA_DIR=${VT_DATA_DIR:-/srv/vt}"
      echo "BACKUP_AGE_RECIPIENT=$recipient"
      echo "BACKUP_KEEP_DAYS=30"
      echo "VT_API_WORKERS=2"
      echo "DIRECTORY_ENABLED=false"
      echo "POSTGRES_PASSWORD=$(r)"
      echo "VT_APP_DB_PASSWORD=$(r)"
      echo "VT_RETENTION_DB_PASSWORD=$(r)"
      echo "JWT_SECRET=$(r)"
      echo "IP_PEPPER=$(r)"
      echo "SIGNED_URL_SECRET=$(r)"
    } > "$ENV_FILE"
    echo "Wrote $ENV_FILE"
    ;;
  up)
    preflight
    $COMPOSE up -d --build --wait
    echo "Production site: https://$(value VT_SITE_ADDRESS)"
    ;;
  admin)
    $COMPOSE exec api .venv/bin/vt users create-admin --email "${VT_ADMIN_EMAIL:?set VT_ADMIN_EMAIL}"
    ;;
  backup)
    $COMPOSE run --rm backup vt-backup once
    ;;
  restore-drill)
    # The owner's private key is read from VT_AGE_KEY on this machine and mounted read-only into a
    # throw-away container; nothing of it is written to the data directory.
    key=${VT_AGE_KEY:?set VT_AGE_KEY to the path of the owner's age identity file}
    file=${VT_BACKUP_FILE:-$(ls -t "$(value VT_DATA_DIR)"/backups/vt-*.dump.age 2>/dev/null | head -1)}
    [ -n "$file" ] || { echo "no backup file found; set VT_BACKUP_FILE"; exit 1; }
    $COMPOSE run --rm -v "$(realpath "$key")":/run/age-key:ro -v "$(realpath "$file")":/run/backup.dump.age:ro \
      backup vt-backup restore-drill /run/backup.dump.age /run/age-key
    ;;
  down)
    $COMPOSE down
    ;;
  *)
    echo "usage: sh scripts/prod.sh secrets|up|admin|backup|restore-drill|down"
    exit 2
    ;;
esac
