# Runbook

How to run Virtual Tailor in production (backend-spec 16.3, M16). Every command runs on the VM in the repository folder unless it says otherwise. The site is one VM with Docker Compose: PostgreSQL, the API (two Uvicorn workers), the nightly jobs, the backup job and Caddy. Everything the stack keeps sits under `VT_DATA_DIR` (default `/srv/vt`) on the encrypted disk. Secrets live in `deploy/prod.env`, root only, never in git.

Related: `docs/study-site.md` (the study laptop, no cloud), `docs/incident-response.md`, `docs/retention-schedule.md`, `docs/data-inventory.md`, `docs/calibration.md`, `docs/analysis.md`.

## 1. First deployment

1. **Decide the region** (decision D19): a Kenyan-hosted VM if one is available, otherwise South Africa with the transfer disclosed in the consent text. One VM: 2 vCPU, 4 GB RAM, 40 GB encrypted disk, Ubuntu LTS. Ask the provider for an encrypted volume, or set up LUKS on the data disk and mount it at `/srv/vt`.
2. **Point the DNS name** (`VT_SITE_ADDRESS`) at the VM before starting Caddy, or the certificate request fails.
3. **Prepare the VM** as root, with the addresses that may use SSH:
   ```sh
   VT_SSH_ALLOW="203.0.113.5" sh deploy/vm-setup.sh
   ```
   It installs Docker, opens only 80 and 443, limits SSH to the allow-list by key, turns on unattended security upgrades, creates `/srv/vt/{db,sheets,reports,caddy,backups}` and warns when `/srv/vt` is not on a LUKS volume.
4. **Make the owner's backup key on your own laptop**, never on the VM:
   ```sh
   age-keygen -o vt-backup-key.txt      # keep this file offline (password manager or an encrypted USB stick)
   grep 'public key' vt-backup-key.txt  # age1...
   ```
5. **Write the secrets file** on the VM (root only, generated, refused if it exists):
   ```sh
   make prod-secrets VT_SITE_ADDRESS=vt.example.org VT_ACME_EMAIL=you@example.org BACKUP_AGE_RECIPIENT=age1...
   ```
6. **Start the stack**:
   ```sh
   make prod-up
   ```
   The pre-flight refuses a world-readable secrets file, a recipient that is not an age key, a missing data directory, and warns on an unencrypted one. Compose builds the images, migrates as the database owner, sets the role passwords, starts the API and waits for `/api/v1/health`. `ENV=production` refuses default secrets, the demo seed and `RATE_LIMITS_OFF`, and keeps the A9 approvals guard on.
7. **Create the first administrator**:
   ```sh
   make prod-admin VT_ADMIN_EMAIL=you@example.org
   ```
8. **Check**: `curl https://vt.example.org/api/v1/ready` answers `{"status":"ok"}`; the admin signs in; the study screens show the approvals banner (A9) until the approvals are entered.

## 2. Deploy a new version

```sh
git fetch && git checkout <tag or main>
make prod-up            # rebuilds what changed, runs migrations, restarts with --wait
```
A deploy is a rolling restart of the API container; phones keep their local data and sync when the API answers again. Deploy outside the study's capture hours.

## 3. Roll back

1. `git checkout <previous tag>` and `make prod-up`.
2. If the new version added a migration, downgrade first, as the database owner, from the previous checkout:
   ```sh
   docker compose -p vt-prod --env-file deploy/prod.env -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml \
     run --rm migrate .venv/bin/python -c "from app.config import Settings; from app.migrate import downgrade; downgrade(Settings().migration_database_url, '<revision>')"
   ```
   Every migration has a tested `downgrade`. Then `make prod-up` on the previous checkout.
3. If data has been written in the meantime that the old schema cannot hold, restore last night's backup instead (section 5) and tell the tailors which hours are lost.

## 4. Migrate

Migrations run on every `make prod-up` through the `migrate` service (`vt db upgrade`), which also sets the `vt_app` and `vt_retention` passwords from `deploy/prod.env`. To run them by hand: `docker compose -p vt-prod ... run --rm migrate`. Never edit the database by hand; the audit tables refuse updates and deletes even from the owner.

## 5. Backups and restore

**What runs:** the `backup` container dumps the database every night at 03:00 Nairobi (after the 02:00 retention job): `pg_dump` custom format piped straight into `age`, encrypted to `BACKUP_AGE_RECIPIENT`, written to `/srv/vt/backups/vt-<UTC stamp>.dump.age`, root-only, kept 30 days. No clear-text copy touches the disk. A manual backup: `make prod-backup`. Check that last night's file exists: `ls -la /srv/vt/backups`. Copy the files off the VM to the owner's encrypted storage in the same region at least weekly (they are useless without the private key).

**Restore drill (monthly; record it in section 11):** run it on the owner's laptop, so the private key never reaches the VM. Copy a backup file off the VM, then from a checkout of the repository:

```sh
scp vm:/srv/vt/backups/vt-<stamp>.dump.age ~/vt-backups/
docker build -f deploy/Dockerfile.backup -t vt-backup .
docker run -d --name vt-drill-db -e POSTGRES_PASSWORD=drill postgres:16-alpine
docker run --rm --link vt-drill-db:db -e PGHOST=db -e PGUSER=postgres -e PGPASSWORD=drill \
  -v ~/vt-backup-key.txt:/run/age-key:ro -v ~/vt-backups/vt-<stamp>.dump.age:/run/b.age:ro \
  vt-backup vt-backup restore-drill /run/b.age /run/age-key
docker rm -f vt-drill-db
```

The drill decrypts, restores into a scratch database, prints the row counts and the migration head, and drops the scratch database. It skips grants, so it needs none of the application roles. `make prod-restore-drill` runs the same drill on the VM; use it only when the laptop cannot reach a backup, because it needs the key on the VM.

**Full restore (data loss, failed VM):**
1. On a fresh VM, do section 1 up to `make prod-up`, which creates an empty, migrated database with the roles and their grants.
2. Stop the API and the jobs: `docker compose -p vt-prod ... stop api jobs backup`.
3. Replace the schema with the dump (the dump keeps the grants to the application roles):
   ```sh
   C="docker compose -p vt-prod --env-file deploy/prod.env -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml"
   $C exec -T db psql -U vt -d vt -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
   age -d -i /root/vt-backup-key.txt /srv/vt/backups/vt-....dump.age | \
     $C exec -T db pg_restore -U vt -d vt --no-owner --exit-on-error
   ```
4. `make prod-up` again: migrations find the restored head and set the role passwords; the API starts.
5. Sheet files under `/srv/vt/sheets` are not in the database dump. A missing file answers 404 and the tailor renders the sheet again from the order.
6. Remove the key file from the VM (`rm`; on SSD or LUKS storage `shred` gives no guarantee, so never leave the key there longer than the restore). Record the restore in section 11 and in the incident log if it followed an incident.

Caddy obtains its certificate from Let's Encrypt (ZeroSSL as fallback), which sees only the host name and `VT_ACME_EMAIL`. It is the only outside service the stack contacts.

## 6. Rotate secrets

Edit `deploy/prod.env`, then `make prod-up`. Effects:

| Secret | Effect of rotating |
|---|---|
| `JWT_SECRET` | Every tailor, admin and measurer is signed out and signs in again. Phones are unaffected (they hold no token). |
| `SIGNED_URL_SECRET` | Sheet links older than ten minutes stop working; the tailor opens the sheet again. |
| `VT_APP_DB_PASSWORD`, `VT_RETENTION_DB_PASSWORD`, `POSTGRES_PASSWORD` | Set on the next migration run; the API reconnects on restart. |
| `IP_PEPPER` | **Breaks IP-hash continuity:** audit rows and rate-limit windows written before the change hash the same address differently from rows after it, so an address cannot be followed across the change. Rotate only after an incident or at the study's end, and write the date here. |

Rotating the backup key: generate a new pair, set `BACKUP_AGE_RECIPIENT`, `make prod-up`, keep the old private key for the 30 days its files still exist.

## 7. Freeze a rules version

Only the owner freezes rules (golden rule 8). Follow `docs/calibration.md` section 4: register the draft, freeze it (one way, audited), set it current, copy the served file into `packages/rules/frozen/`, point the web build at it and deploy. The database refuses every later change to a frozen row; the server refuses an artifact whose checksum does not match.

## 8. Handle a data-subject request by hand

Most requests arrive through the app and need no hand work: a client's delete or withdraw request from the phone is proven by the device secret and carried out or scheduled (D10); one that cannot be proven is held for the admin under **Admin › Deletion requests › Carry out** (`POST /admin/deletion-requests/{id}/honour`, audited). A participant's withdrawal is **Admin › Study › Record withdrawal** (`POST /study/participants/{id}/withdraw`).

A request that arrives by letter, phone or WhatsApp:
1. Verify the person: they must give the client code shown on their phone (or the tailor confirms it from their client list). Never act on a name alone, and never ask for a photograph.
2. **Access:** the tailor's client page and "Print measurements" show everything held about a client; the admin audit export (`GET /admin/audit.csv`) shows every view and export of it. Send it through the tailor, as the study privacy notice says.
3. **Erasure:** create the held request with the admin's "Carry out" after entering the code, which erases the profiles, marks the client deleted and writes the system audit row; the nightly job removes the rest on schedule. Study capture sets are kept pseudonymous under the withdrawal rule (D44) unless the owner decides otherwise.
4. **Correction:** measurements are not corrected by hand; the client captures again. Height, sex and fit are changed by the tailor on the client page.
5. Record the request, the date and what was done in the owner's private request log (not in the repository), and answer within 30 days (Data Protection Act, 2019, section 26).

## 9. End of collection

1. The admin sets **Admin › Settings › Study collection end** (`study_collection_end`) and confirms it. From that date the 30-day and 12-month study retention steps start (`docs/retention-schedule.md`).
2. Export the calibration bundle and the test-cohort CSV (`vt study export-calibration`, **Admin › Study › Export**) to the encrypted research laptop; see `docs/calibration.md` and `docs/analysis.md`.
3. Take a manual backup (`make prod-backup`) and copy it to the owner's encrypted storage.
4. Run the restore drill and record it below.
5. Check the next dry-run report in `/srv/vt/reports` for what the job will remove, then let it run.
6. Disable the measurers' accounts (**Admin › Accounts › Disable**) and turn the study mode off in the settings when the last tape reading is in.
7. After the 12-month study retention, confirm in the dry-run report that the study rows are gone, and write the date here.

## 10. Routine checks

| When | What |
|---|---|
| Daily (automatic) | `/api/v1/ready` probed by the provider's uptime check or a cron line `curl -fsS https://vt.example.org/api/v1/ready >/dev/null \|\| logger -t vt "ready failed"`. No third-party monitoring service. |
| Weekly | `ls -la /srv/vt/backups` shows last night's file; `docker compose -p vt-prod ... logs --since 168h jobs backup \| tail` shows the retention and backup lines; `df -h /srv/vt`; copy the backups off the VM. |
| Monthly | Restore drill (section 5); `apt list --upgradable`; rebuild the images so base-image fixes land (`make prod-up` after `docker compose ... build --pull`). |
| Logs | Structured JSON from the API with a correlation id per request, no bodies, no personal data; Docker keeps them; prune with `docker system prune` monthly. Caddy writes no access log because paths carry client codes. |

## 11. Restore drill record

| Date | Backup file | Where restored | Result | By |
|---|---|---|---|---|
| 2026-11-03 | `vt-2026-11-03T1633Z.dump.age` (98 KB, demo seed, migration 0011) | Scratch database on a local compose stack, through the `backup` image and a throw-away age key | OK: 28 tables, 11 clients, 12 profiles, 10 orders, 40 audit rows, head 0011; scratch dropped | Implementer (M16) |
| 2026-11-03 | `vt-2026-11-03T2048Z.dump.age` (108 KB, demo seed) | Same, after the review fixes (pipefail, size floor, archive listing) | OK: 11 clients, 12 profiles, 10 orders, 40 audit rows, head 0011; a dump against an unreachable database failed and left no file | Implementer (M16) |
|  |  |  |  | Owner (M16 "You check") |
