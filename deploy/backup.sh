#!/bin/sh
# Nightly encrypted backups and the restore drill (backend-spec 14.7, M16).
#   vt-backup nightly        dump every night at 03:00 Nairobi (00:00 UTC; Nairobi has no DST)
#   vt-backup once           dump now
#   vt-backup restore-drill FILE KEY_FILE
#                            decrypt FILE with the owner's private key, restore it into a scratch
#                            database, print the row counts, drop the scratch database
# The dump is pg_dump's custom format (already compressed), piped straight into age, so no
# clear-text copy ever touches the disk. It carries the grants to vt_app, vt_retention and
# vt_readonly (a live restore keeps them) but no owners. Output lines carry counts and file
# names only.
# pipefail: a failed pg_dump must fail the backup, not hand age an empty stream.
set -euo pipefail
BACKUPS=${BACKUPS_DIR:-/backups}
# Backup files are readable by root only on the VM.
umask 077
KEEP=${BACKUP_KEEP_DAYS:-30}

dump() {
  recipient=${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT (age1...) is not set}
  case "$recipient" in age1*) ;; *) echo "BACKUP_AGE_RECIPIENT must be an age public key" >&2; exit 1 ;; esac
  stamp=$(date -u +%Y-%m-%dT%H%MZ)
  out="$BACKUPS/vt-$stamp.dump.age"
  if ! pg_dump --format=custom --no-owner | age -r "$recipient" > "$out.part"; then
    rm -f "$out.part"; echo "backup failed: pg_dump or age exited with an error" >&2; return 1
  fi
  # An encrypted dump of even an empty schema is several kilobytes; less means pg_dump wrote nothing.
  if [ "$(wc -c < "$out.part")" -lt 4096 ]; then
    rm -f "$out.part"; echo "backup failed: dump too small" >&2; return 1
  fi
  mv "$out.part" "$out"
  # Keep KEEP days: a file older than that goes (mtime is the dump time).
  find "$BACKUPS" -maxdepth 1 -name 'vt-*.dump.age' -mtime +"$((KEEP - 1))" -delete
  echo "backup written: $(basename "$out") ($(wc -c < "$out") bytes); files kept: $(find "$BACKUPS" -maxdepth 1 -name 'vt-*.dump.age' | wc -l)"
}

restore_drill() {
  file=${1:?backup file}; key=${2:?age identity file}
  scratch="vt_drill_$(date -u +%Y%m%d%H%M%S)"
  echo "restore drill: $(basename "$file") into $scratch"
  psql -v ON_ERROR_STOP=1 -q -d postgres -c "CREATE DATABASE \"$scratch\""
  trap 'psql -q -d postgres -c "DROP DATABASE IF EXISTS \"$scratch\"" >/dev/null; echo "scratch database dropped"' EXIT
  # A truncated or unreadable file fails here, before any restore starts.
  age -d -i "$key" "$file" | pg_restore -l > /dev/null
  # The drill skips the grants, so it also works on a machine without the application roles.
  age -d -i "$key" "$file" | pg_restore --no-owner --no-privileges --exit-on-error -d "$scratch"
  psql -v ON_ERROR_STOP=1 -q -At -d "$scratch" -c "
    SELECT relname || ': ' || n_live_tup FROM pg_stat_user_tables ORDER BY relname" \
    | sed 's/^/  /'
  echo "  (pg_stat counts are estimates; exact totals follow)"
  psql -v ON_ERROR_STOP=1 -q -At -d "$scratch" -c "
    SELECT 'clients: ' || count(*) FROM client
    UNION ALL SELECT 'profiles: ' || count(*) FROM measurement_profile
    UNION ALL SELECT 'orders: ' || count(*) FROM \"order\"
    UNION ALL SELECT 'audit rows: ' || count(*) FROM audit_log
    UNION ALL SELECT 'alembic: ' || version_num FROM alembic_version" | sed 's/^/  /'
  echo "restore drill: OK"
}

case "${1:-}" in
  nightly)
    while true; do
      now=$(date -u +%s)
      sleep $(( (now / 86400 + 1) * 86400 - now ))
      dump || echo "backup failed: $?" >&2
    done
    ;;
  once) dump ;;
  restore-drill) shift; restore_drill "$@" ;;
  *) echo "usage: vt-backup nightly|once|restore-drill FILE KEY_FILE" >&2; exit 2 ;;
esac
