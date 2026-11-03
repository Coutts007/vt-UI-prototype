#!/bin/sh
# Nightly encrypted backups and the restore drill (backend-spec 14.7, M16).
#   vt-backup nightly        dump every night at 03:00 Nairobi (00:00 UTC; Nairobi has no DST)
#   vt-backup once           dump now
#   vt-backup restore-drill FILE KEY_FILE
#                            decrypt FILE with the owner's private key, restore it into a scratch
#                            database, print the row counts, drop the scratch database
# The dump is pg_dump's custom format (already compressed), piped straight into age, so no
# clear-text copy ever touches the disk. Output lines carry counts and file names only.
set -eu
BACKUPS=${BACKUPS_DIR:-/backups}
# Backup files are readable by root only on the VM.
umask 077
KEEP=${BACKUP_KEEP_DAYS:-30}

dump() {
  recipient=${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT (age1...) is not set}
  case "$recipient" in age1*) ;; *) echo "BACKUP_AGE_RECIPIENT must be an age public key" >&2; exit 1 ;; esac
  stamp=$(date -u +%Y-%m-%dT%H%MZ)
  out="$BACKUPS/vt-$stamp.dump.age"
  pg_dump --format=custom --no-owner --no-privileges | age -r "$recipient" > "$out.part"
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
  # The dump carries no owners or grants, so the restore needs none of the application roles.
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
