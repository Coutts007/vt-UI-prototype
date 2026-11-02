# Data inventory

What Virtual Tailor holds, where, why, and for how long. It describes the code on the `main` branch as of M11 (2026-11-02). It is a technical input to the Data Protection Impact Assessment (DPIA). **The DPIA itself, its filing with the Office of the Data Protection Commissioner (ODPC) and the ethics and NACOSTI approvals are the project owner's**, not this document's.

Retention periods are in `docs/retention-schedule.md`. Who can reach each item is in `docs/dpia-technical-annex.md`.

## 1. On the client's phone (browser storage)

| Item | Store | Personal data? | Why | Removed |
|---|---|---|---|---|
| Camera frames during capture | Memory only | Yes (images of the body) | Pose, mask and marker detection | Released after measurement; never written to storage, sent or logged (golden rule 1, tested) |
| Measurement profiles (landmarks, silhouette profiles, marker corners, nine values with flags, session facts) | IndexedDB (`profiles`) | Pseudonymous body measurements | Review, offline use, upload | "Delete my data" on the phone; clearing the browser |
| Upload and deletion queues | IndexedDB | Pseudonymous | Sending when online | When the server answers |
| Draft (language, client code, typed height, sex, clothing fit, consent answer; on the study phone, the study block) | IndexedDB (`settings`) | Pseudonymous | The capture flow | At the end of the flow or on clearing |
| Client code secret (256 random bits per code, D45) | IndexedDB | No (a key) | Proof the phone holds the code | With the phone's data |
| Measurer's queued tape readings (participant code, reading number, nine values) | IndexedDB (`study_readings`) | Pseudonymous | Readings taken offline | When the server accepts them |
| Sign-in token and the signed-in user's profile (tailor, admin, measurer) | Memory and sessionStorage | Email, role | Session | Sign-out or closing the tab |

No image field exists in the phone's database; a test refuses image-like values.

## 2. On the server (PostgreSQL)

No binary columns exist and the API accepts JSON only; a privacy guard refuses image-like content.

| Table | Personal data held | Purpose |
|---|---|---|
| `user_account` | Email, password hash (Argon2), role, status, last sign-in | Staff sign-in (tailors, admin, measurers) |
| `tailor` | Business name, phone (E.164), area, optional directory listing text | The tailor's account and directory listing |
| `client` | Client code (pseudonym), optional display name and height typed by the tailor, sex, clothing fit, hash of the phone's secret | The tailor's client record. No phone, email or address is stored for clients |
| `consent` | Version, language, scope, given and withdrawn time, source (`app` or `study_paper`) | Proof of consent and of withdrawal |
| `capture_session` | Device model, OS, browser, capture facts and checks; for study sets, participant link, set number, lighting, distance, observed fit, lux | Quality control and the validation study |
| `measurement_profile`, `measurement`, `measurement_derivation`, `server_check`, `conflict` | Pseudonymous body measurements and the numeric shape data they come from (landmarks, silhouette profiles, marker corners) | Orders, re-derivation, the study |
| `order`, `order_item`, `order_status_history` | Garment, sizes, due date, free-text notes | The tailor's work |
| `spec_sheet`, `sheet_share` | Whether the name was included, file hashes, how it was shared | Sheets and their share log |
| `deletion_request`, `deleted_profile` | Hash of the client code, reason, status; profile ids already deleted | Carrying out deletions; stopping a queue from bringing a profile back |
| `participant` | Participant code (P###), link to a pseudonymous client code, sex, age band, venue, cohort | The validation study. No name, phone, weight or key list is ever entered (the screen says so) |
| `measurer`, `reference_measurement`, `reference_correction` | Measurer code, training date; tape readings and corrections | Study reference values. Readings cannot be changed or deleted by the API role |
| `audit_log` | Who did what and when, the entity id, a keyed hash of the IP address, a short detail without measurements or names | Accountability (append-only) |
| `app_setting` | Retention periods, study settings, approval references and dates | Configuration and the A9 guard |
| `revoked_token`, `rules_version`, `ease_preset` | No personal data | Sessions, measurement rules, ease defaults |

## 3. Files on the server

| Item | Where | Personal data | Removed |
|---|---|---|---|
| Specification sheets (PDF and PNG of a drawing and numbers, no photograph) | `SHEETS_DIR` volume | Measurements; the client's name only if the tailor ticked it | 30 days, or at once when the order is deleted |
| Retention job reports | `/data/reports` volume | None: counts only | Not removed automatically |

## 4. Exports

- **Audit CSV** (admin): the audit log as listed above, emails of staff included. Each export is audited.
- **Study exports** (admin): `captures.csv` and `reference.csv`, columns exactly as backend-spec 12.1. Codes only: no name, phone, email or client code. Participants who withdrew are left out (D44 default). Each export is audited with its row count. The researcher's copy on the laptop is outside the system and must be held encrypted, as the study protocol says.

## 5. What is never collected

Photographs or video on the server; client phone numbers, emails or addresses; GPS location; analytics or third-party trackers (no third-party runtime requests; all models and fonts are self-hosted); participants' names (they stay on the paper key list, which never enters the system).

## 6. Logs

Application logs record event names and error types only. Emails, client codes, display names, measurements and tokens are never logged (golden rule 4). Request bodies are not logged.

## 7. Not yet in place (honest gaps)

- **Backups** (age-encrypted, backend-spec 16) are not built yet; they are planned for M12. Until then there are no backup copies to expire.
- **Disk encryption** of the server is a deployment choice outside this code; it must be confirmed on the study server.
- A Content Security Policy header is not set yet (M12).
- Kiswahili text in the app is a draft awaiting review (`reviewed:false`).
