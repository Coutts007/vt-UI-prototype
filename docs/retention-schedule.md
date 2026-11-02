# Retention schedule

How long each kind of data stays, and what removes it. The nightly job is `vt jobs nightly` (the `jobs` service in `deploy/docker-compose.yml`), which runs `vt jobs retention` at 02:00 Africa/Nairobi as the database role `vt_retention`. `vt jobs retention --dry-run` does the same work, writes the report and rolls back. Every real run writes one system audit row with the counts, and every run writes a JSON report of counts only to `/data/reports`.

Periods marked *setting* are changed by the admin in Settings and are audited.

| Data | Kept for | Removed by |
|---|---|---|
| Client record, profiles, orders | `retention_months` (setting, default 24) after the last of: the client's creation, an order update, a profile received; never while an order is open, and never for a study participant | Nightly job |
| A client the tailor removed (`deleted_at`) | Until it has no order | Nightly job |
| Directory code nobody measured with (D27) | 30 days | Nightly job |
| Profile the client asked to delete | At once, unless an open or collected order uses it | API, at the request |
| Profile kept for an order after a deletion request | 30 days after the order is collected (D10), only within the claim round the request covered (D45) | Nightly job, which then marks the request done |
| A held deletion request the admin carries out | At once, on every claim round, for profiles no order uses; the typed name and height are cleared | Admin, Settings › Deletion requests |
| Record that a profile was deleted (tombstone) | 90 days (the longest a phone's queue can wait) | Nightly job |
| Study records: participants, tape readings, corrections, re-derivations, the study columns of capture sessions | 12 months after `study_collection_end` (setting) | Nightly job |
| Audit log | `audit_retention_months` (setting, default 24) | Nightly job (only `vt_retention` may delete audit rows) |
| Revoked sign-in tokens | Until they would have expired | Nightly job |
| Specification sheet files | 30 days; unnamed files after an hour | Nightly job (`clean_sheets`) |
| Data on the client's phone | Until the client deletes it or clears the browser | The client |
| Backups | Not built yet (M12) | — |

**Withdrawal of study consent (D44, open for the owner).** Until the owner decides, the most protective reversible default applies: the participant's row, capture sets and tape readings are kept but are excluded from both study exports, and no new readings are accepted for them. Nothing is destroyed, so the owner's later decision can still go either way.
