#!/bin/sh
# The study-site profile (M12). Usage: sh scripts/study.sh secrets|up|admin|cert|down
# deploy/study.env holds the secrets and the laptop's address on the study router. It is
# git-ignored and stays on the encrypted laptop.
set -eu
ENV_FILE=deploy/study.env
COMPOSE="docker compose -p vt-study --env-file $ENV_FILE -f deploy/docker-compose.yml -f deploy/docker-compose.study.yml"

private_address() {
  case "$1" in
    10.*|192.168.*) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) return 0 ;;
    *) return 1 ;;
  esac
}

case "${1:-}" in
  secrets)
    if [ -e "$ENV_FILE" ]; then echo "$ENV_FILE exists; not overwritten"; exit 1; fi
    host=${VT_STUDY_HOST:?give the laptop address on the study router, e.g. VT_STUDY_HOST=192.168.8.10}
    private_address "$host" || { echo "VT_STUDY_HOST must be a private (router) address"; exit 1; }
    umask 077
    r() { uv run python -c 'import secrets; print(secrets.token_urlsafe(36))'; }
    {
      echo "# Study-site secrets (M12). Keep on the encrypted laptop; never commit or copy off it."
      echo "VT_STUDY_HOST=$host"
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
    [ -e "$ENV_FILE" ] || { echo "Run 'make study-secrets VT_STUDY_HOST=<address>' first"; exit 1; }
    host=$(sed -n 's/^VT_STUDY_HOST=//p' "$ENV_FILE")
    private_address "$host" || { echo "VT_STUDY_HOST in $ENV_FILE is not a private address"; exit 1; }
    ip -o addr 2>/dev/null | grep -q " $host/" ||
      echo "Warning: $host is not an address of this laptop now; join the study router first"
    $COMPOSE up -d --build --wait
    echo "Study site: https://$host  (phones must trust the certificate: docs/study-site.md)"
    ;;
  admin)
    $COMPOSE exec api .venv/bin/vt users create-admin --email "${VT_ADMIN_EMAIL:?set VT_ADMIN_EMAIL}"
    ;;
  cert)
    $COMPOSE cp caddy:/data/caddy/pki/authorities/local/root.crt deploy/study-root.crt
    echo "Wrote deploy/study-root.crt (the certificate only, no private key)"
    ;;
  down)
    $COMPOSE down
    ;;
  *)
    echo "usage: sh scripts/study.sh secrets|up|admin|cert|down"
    exit 2
    ;;
esac
