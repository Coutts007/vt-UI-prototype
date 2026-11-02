# Progress log

The newest entry comes first. Every change or improvement adds a line in the same commit.

## 2026-11-02: M12 integration hardening and the study-site profile

- `docs/integration-report.md` records the backend-spec 15.6 walk-through step by step with screenshots in `docs/integration/` (synthetic data only), the load figures, and what is not verified: step 9 (M13, M14), three new study capture sets on a phone, and the laptop-and-two-phones check. The walk-through's deep-link check now looks for the tailor's name the app shows for the code.
- Load-test findings fixed (M12-11, M12-12): the client list looked up every client's latest profile through all its versions (about 200 ms for 5,000 clients on the half-CPU database, so lists queued behind each other); a partial index on each client's current profile (migration 0009) and a count that reads only client rows when nothing is filtered. Sheet generation held its database connection while waiting to render, which drained the pool under 50 users and gave one 500 after a 30-second wait; the read now ends before rendering (test failed first). Tests for the list's answers and the index.
- **Load figures after the fixes (2 vCPU, 4 GB; synthetic data; one 60-second run each):** uploads 17.2 req/s against 20, p95 1,800 ms (target 300). Lists with 10 tailors: median 33 to 80 ms; p95 `GET /clients` 1,300, its search 850, a client's profiles 540, orders 280 ms (target 200). 50 mixed users: 21.4 req/s, **no errors**, sheets median 7.7 s and p95 12 s (target 1.5 s). Before the fixes: `GET /clients` median 7,600 ms and p95 14,000 ms, sheets median 14 to 27 s, one error. **The targets are not met.** One upload costs about 110 ms and one sheet about 0.9 s of a single process, so 20 uploads a second and 50 users with sheets need more CPU than one Uvicorn worker has. A second worker waits on the rate limiter (M12-13, open for the owner).
- Walk-through fixes: the audit-log step looks for the "Issued a client code" entry (the log never shows the code itself, which it also checks), and the retention dry-run file keeps only the report, not the container's start-up noise.

- Load test (backend-spec 16.4): `make load` starts the stack with the API at 1.5 vCPU and 2.5 GB and the database at 0.5 vCPU and 1.5 GB (the 2 vCPU, 4 GB VM together), loads `vt seed volume` (one synthetic tailor, 5,000 clients, 20,000 profiles copied from a seed profile, refused in production), then runs Locust (`tests/load/locustfile.py`): 20 profile uploads a second, the list endpoints, and 50 users mixed with sheet generation. `scripts/load_report.py` checks the figures against the targets. The seed loader's profile writer is now a row builder shared by both loaders.
- Study site (A10): `make study-secrets VT_STUDY_HOST=<router address>` writes git-ignored `deploy/study.env` with fresh secrets (private addresses only); `make study-up` runs the stack in production mode with Caddy `tls internal` on that address; `make study-admin` creates the first administrator (`vt users create-admin`, refused once one exists, audited as a system action); `make study-cert` exports the public root certificate for the phones. `docs/study-site.md` is the one-page guide, including trusting and later removing the certificate on Android and iPhone.
- Caddy now sends the frontend-spec 19 CSP on the web build (`connect-src 'self'` only, plus `object-src 'none'`, `base-uri`, `form-action`, `font-src`), HSTS, nosniff, `Referrer-Policy: no-referrer`, a Permissions-Policy that allows the camera and motion sensors to the site only, COOP and `X-Frame-Options: DENY`; the server banner is removed and no access log is written. API replies keep the API's own stricter CSP. The shell and service worker are sent `no-cache` so updates land.
- **Deviation (M12-10):** OpenCV.js's embind builds its wrappers with the Function constructor, so the marker worker cannot run without `'unsafe-eval'`. Running real vision through Caddy found it: the detector never started. Caddy gives the marker worker's own script a narrow policy with `'unsafe-eval'` (`default-src 'none'`); the page keeps the strict one. Rebuilding OpenCV.js without dynamic execution would remove the exception.
- `make e2e-real-api` now serves the test build through Caddy with the production Caddyfile, so every real-API browser test runs under the real CSP, and adds a `real-vision-csp` project (MediaPipe and OpenCV.js in their workers through Caddy) and `csp.spec.ts` (headers, and no violation on the client, tailor, admin and study screens). `make stack-check` runs the production build with rate limits on: headers, no violation, no development screen, and sign-in limited per address behind Caddy, with a forged `X-Forwarded-For` unable to reset the limit. CI runs both in a new `e2e-real-api` job, and schemathesis in a `fuzz` job. Test stacks use ports 8453 to 8456 so they never meet a stack already running on 8443.
- The backend-spec 15.6 walk-through is a Playwright run (`make walkthrough`): `walkthrough.spec.ts` covers registration and approval, the deep link and both audit logs, and the existing suites save screenshots at their steps when `VT_SHOTS_DIR` is set. The retention dry-run output is kept next to them.
- Signed-in fuzzing found three replies that broke the contract, all fixed with contract tests that failed first: conflicts (list and resolve) sent `null` for a measurement's optional numbers, which the contract says are left out, and the admin's deletion-request list dropped `completed_at`, which the contract requires (as null while open), while a null `note` must be left out. The fuzz script no longer signs itself out or changes its password mid-run, which had hidden every signed-in endpoint behind 401.
- Schemathesis (MIT, a development dependency) fuzzes every endpoint of the contract as nobody, a tailor and the admin (`make fuzz`, `scripts/fuzz.sh`): no 500 responses, and responses must match the contract. Its first runs found two server errors, both fixed with tests: a NUL character in a query, path or JSON string reached PostgreSQL, which cannot store it (now refused at the edge with `validation_failed`), and `page=2^63` overflowed the database offset (the contract and the API now cap `page` at 100,000).
## 2026-11-02: M11 admin, study mode, approvals guard, exports, retention

- The study e2e accessibility check now waits for running animations to end, so a button changing colour as it becomes enabled is not measured half-way. CI had flagged it once on a commit that passed in its other run.
- Contract: participants say whether they withdrew (D44 default, open for the owner), an admin can carry out a held deletion request on every claim round (`POST /admin/deletion-requests/{request_id}/honour`), the admin's deletion list names the code, and the audit log gains a `retention` action.
- Admin API: accounts (list by status, approve, reject, disable, enable; disabling ends every session; an admin cannot lock themself out; a rejection reason is never stored, only that one was given), measurer accounts, settings with the approvals and the earliest collection date, the audit export as CSV (formula-like cells quoted, the export audited), the deletion queue with codes, and carrying out a held deletion on every claim round.
- The A9 guard: in production, enrolment and tape readings answer 409 `approvals_missing` until the five approval fields are filled and 60 days have passed since the DPIA, or the ODPC has answered. Development and staging hold seed and synthetic data only.
- Enrolment: seeded cohort allocation balanced by sex, in blocks of eight (one pilot, two calibration, five test). The seed comes from `vt study allocate --seed` or is drawn and logged at the first enrolment. Each participant gets a new pseudonymous code with no name, phone or height. The cohort locks once readings exist.
- Blind tape readings: all nine sites at once, locked on save (`reading_locked`), reading 2 before 1 marked, a measurer reads back only their own values and never a system value. Corrections are separate rows by the admin, audited. A withdrawn participant gets no new readings (D44 default).
- Exports: `captures.csv` and `reference.csv` with exactly the backend-spec 12.1 columns, centimetres to one decimal, corrections applied, withdrawn participants left out (D44 default), no names, phones, emails or client codes. `?rules_version=` takes values from re-derivations under that version and refuses an unknown version.
- Study capture with paper consent: `study-paper-1.0` counts only with a study block, and is stored with source `study_paper`.
- Retention job (backend-spec 14.6) as `vt jobs retention [--dry-run]`, running as `vt_retention`: profiles kept for an order go 30 days after collection, with the order and a tombstone, and only in the claim round the request covered (D45); clients inactive past `retention_months` with no open order; clients a tailor removed; directory codes unused for 30 days (D27); study records 12 months after the collection end; audit rows past `audit_retention_months`; expired revoked tokens; tombstones after 90 days; sheet files. One system audit row with the counts. A JSON report with counts only goes to `/data/reports`. A dry run does the same work and rolls back. Tested with seeded ages.
- `vt jobs nightly` runs it at 02:00 Africa/Nairobi, in a new `jobs` service in compose. `vt study allocate --seed` sets the allocation seed once and logs it. Migration 0007 records the round a deletion request covers and lets the job write tombstones.
- Production config refuses the development retention password; the older production config tests now pass that secret so each still tests what it names.
- Admin and study screens moved onto the contract client: accounts (tabs, approve all, reject with a reason that is not stored, disable, re-enable), the audit log for every account with action, entity, user and date filters and the server's CSV, settings (retention, audit period, rules version, oldest app version, consent version read-only, study mode with a confirm, collection end, the A9 approvals with what is missing and the earliest collection date, and the deletion queue with Carry out), measurers, participants (code-only enrolment with the next code suggested, cohort, sets and readings done, a Withdrew tag, the A9 banner), and the two study exports.
- Study capture builds a draft with the study block and `study-paper-1.0` consent on the participant's own code, then runs the client flow from the phone check. Turning study mode on or off updates the study routes at once.
- Tape entry is blind: the nine Appendix C sites to 0.1 cm, how-to notes for each, a confirm for values outside a plausible adult range, a locked receipt, and a queue on the phone (numbers only) that sends when the connection returns. A browser test proves the measurer's page holds none of the seed's system values for P001 and never asks for profiles, clients, admin or export data.
- The prototype's mock client (`src/api/client.ts`, `src/api/mockData.ts`) is gone, and the seed's sign-ins live in a dev-only chunk that a production build never includes. The admin and study words have their own dictionary in English with a Kiswahili draft. The header's last literal words are translated.
- The MSW mock follows the server: carrying out a deletion, codes in the deletion list, `withdrawn` on participants, no readings for a withdrawn participant, a fresh code for each enrolment, the participant list readable with study mode off, and CSV headers from `packages/contracts/study-export-columns.json`, which an API test holds equal to the export's columns.
- Compliance documents: `docs/data-inventory.md`, `docs/dpia-technical-annex.md`, `docs/retention-schedule.md` and `docs/incident-response.md` describe what the code holds and does today, list the gaps (no backups or Content Security Policy yet, M12) and say that the DPIA, its filing and the approvals are the owner's.
- `scripts/budget.mjs` now fails a production build that carries a demo sign-in. With the mock client gone the production build has none; D38's client flow plus capture engine figure is 179.2 KB gzip (about 179.5 KB before), the flow line 167.8 KB of 170, first screen 88.1 KB, tailor 110.1 KB.
- The measurer-screen test matched digit runs inside ids and hashes on the real API ("450" inside a generated id); it now counts whole numbers only.
- Review of PR #14, API and database:
  - Withdrawal now lives on the participant row (`participant.withdrawn_at`, migration 0008), so a participant with no consent record can withdraw. A proven phone request (delete or withdraw) on a participant's code sets it. An unproven one is held for the admin instead of answering "nothing held". The admin's "Carry out" sets it, and so does the new audited `POST /study/participants/{id}/withdraw`. Exports and readings check it, and a trigger makes it one way.
  - No deletion path removes study capture sets (D44 default), and they never hold a request open.
  - A9: an ODPC date needs its reference and must fall between the DPIA date and today. No approval date may be in the future. The server records who confirmed and when from the signed-in admin. The audit row keeps the approval values. Study uploads to `POST /profiles` apply the guard in production.
  - A new collection end needs `confirm_study_deletion`. A past end is refused while study mode is on, and the audit row keeps old and new. The job deletes study records only after a dry-run report at least a week older showed that deletion for the same end.
  - Enrolments take an advisory lock, so concurrent ones keep the allocation blocks.
  - Triggers lock the cohort once readings exist, a capture set's participant and set number, and the allocation seed.
  - `vt_retention` may delete only from the tables it cleans (audit rows past their period included, as spec 14.6 needs). It can no longer read accounts or the migration table.
  - Migration 0007 copies the client's round onto old deletion requests. A new `all_rounds` flag marks the admin's checked requests, and a request with neither is left for the admin.
- Review of PR #14, web:
  - Settings asks before setting a collection end and sends the confirmation. Who confirmed the approvals and when are read-only, filled in by the server.
  - Participants have "Record withdrawal".
  - The tape queue keeps a locked reading whose saved values differ and tells the measurer, dropping it only on an exact match.
  - The mock follows the API.
  - A duplicate `hdrMenu` key from the header change, which broke the web typecheck in `0385a26`, is removed.
- Review of PR #14, documents: the DPIA annex, retention schedule and data inventory now describe withdrawal on the participant row, study capture sets kept by every deletion path, the A9 date rules and server-set confirmer, the week's dry-run notice before study deletion, and the narrower `vt_retention` (which keeps DELETE on audit rows past their period, as spec 14.6 needs).

## 2026-11-02: M10 specification sheets and sharing

- The WhatsApp share text has one source: `packages/contracts/share-text.json` holds its labels in English and Kiswahili and four expected texts. The API builder and the mock's builder both pass every case character for character. Lines are the order's sites in sheet order, with the body value, a ✓ or ▲ check mark, "not measured" or "measure at fitting". Centimetres to one decimal; inches to the nearest eighth, which never ties for whole millimetres, so the two languages cannot round differently. A new error code, `sheet_link_invalid` (403), and a 429 on sheet generation are in the contract.
- Sheets are rendered on the server (backend-spec 13): a Jinja2 template laid out as Figure 5.6, WeasyPrint to an A4 PDF, page 1 to a 1240 x 1754 PNG with pypdfium2, a QR code of the profile id from segno, and bundled Noto Sans and Noto Sans Mono (OFL). Labels follow the tailor's language and values the tailor's unit. The outlines are two static drawings, the same for every client; a test checks the page holds no picture. With the font timestamp pinned, two renders are byte-identical. A render takes about 1.2 s on the laptop.
- `POST /orders/{id}/sheets` writes both files under `SHEETS_DIR`, records their SHA-256 and returns 10-minute HMAC-signed links and the share text. It is audited as `export` with whether the name was included, never the name itself, and limited to 60 an hour per tailor. At most two renders run at once, off the event loop. `GET /files/sheets/...` needs no sign-in: an expired, future-dated or altered link answers 403 `sheet_link_invalid`, and a missing file 404; replies are `no-store`. `POST /sheets/{id}/shares` records how a sheet left, with the tailor's id, and writes a `share` audit row.
- `vt jobs clean-sheets` deletes sheet files after 30 days and files no sheet names after an hour; the rows stay for the share log. Deleting an order removes its sheet files at once. Scheduling the job arrives with M11's job runner.
- The API image installs Pango and HarfBuzz for WeasyPrint, keeps sheets in their own volume, and production refuses the development link secret. WeasyPrint is imported only when a sheet is drawn, so the API still starts without Pango. Pyphen, a WeasyPrint dependency offered under GPL, LGPL or MPL, is taken under MPL-1.1, as `scripts/licences.mjs` records; the fonts are listed with their OFL licence.
- The sheet screen previews the server's PNG and offers Share on WhatsApp, Download picture, Download PDF and Print. Share uses the phone's share sheet with the PNG and the text when it can share files; otherwise it saves the picture and opens `wa.me` with the text, and tells the tailor to attach it. Each path records itself through the share log. An expired or cleaned-up link makes a new sheet with the same name choice and carries on (F6). The name toggle starts from the tailor's setting. Files come through a new `ApiClient.sheetFile`, with no sign-in sent, so no screen calls `fetch` itself.
- The mock builds the real share text from the seed order and serves stand-in files. Browser tests cover both share paths, the PDF download and, on the real API, an expired link being replaced; the real API's preview is checked at 1240 px wide.
- The mock's contract test fetches a file for a sheet it made, since files of unknown sheets now answer 404 as on the API. Formatting fixed.
- After review: changing the include-name box drops a sheet already made, so a sheet or share text with the name cannot go out after the tailor unticked it; a new one is generated under the current choice.
- After review: WeasyPrint gets a fetcher that serves only files under the sheet template folder; `file://` elsewhere, `http(s)` and paths that climb out are refused. Cleanup touches only regular files named `<id>.png`, `<id>.pdf` or their `.part` forms, never folders, links or other names. Each render gets its own font configuration, since two run at once.
- After review: a name typed with a newline, tab or other control character could add lines to the WhatsApp text. Both builders now turn controls into spaces and collapse runs of space, and the sheet does the same; two fixture cases cover it. The stored name is unchanged.
- After review: the WhatsApp and Print buttons open their tab during the tap and fill it after the file arrives, because Safari blocks windows opened after an await. **Needs the iPhone check**: not yet tried on a real iPhone or Android phone.

## 2026-11-02: M9 review fixes

- After a reset the next phone was told the earlier client's measurements through `change_since_last`. Comparisons now read only the phone's own claim round. A phone is never told the height check, since holding a code's secret does not prove the typed height is theirs. A low version against an earlier round goes to the tailor as a conflict and answers 201, so the phone learns nothing about what came before.
- Reading `/conflicts` writes a `profile_view` row for each side. Superseding the row a conflict waited on makes the other row final and records `conflict_resolve` with the tailor's id; before, it closed the conflict silently and stranded the row.
- A code review's audit now names each profile, withdrawal (with its date) and request it touched. The deletion banner ends once a request is done or refused. Rotating a code locks the client row.
- Orders: each flagged row of the garment must be answered, an override must change the value, a row in conflict cannot be ordered on, and a collected order's items are locked. The override reason stays optional, as frontend-spec 13 says.
- The freeing e2e test no longer fails when the profile list reloads before it looks, so the word appears twice.
- Profile lists give each row's `claim_round`. When rows from different claims sit side by side, the order form makes the tailor choose instead of defaulting to the newest.

## 2026-11-02: M9 tailor slice

- The API now serves the tailor's clients, profiles, conflicts, orders, ease suggestions and presets, and the audit list, with the role matrix covering each. Finished is always body plus ease; flagged rows must be confirmed or overridden; due dates run from today to 180 days in Nairobi time.
- A tailor can free a client code. Each freeing starts a new claim round, so the next phone can claim the code but reads and deletes only what it uploaded itself. A replay proves only its own row: it claims nothing if another row shares the round.
- The claim page shows profiles by round, withdrawals and deletion requests, including any that wiped the name and height. Superseding, clearing a withdrawal and closing a request happen only when the tailor names them, on a freed code.
- The tailor's screens now use the real sign-in and API: register, pending, login, clients, issuing a code with its QR and WhatsApp text, client page with deletion banner, profile view, conflicts, the order form with ease suggestions and flagged rows, queue, order detail with status history, presets, settings and own audit. Each is tested at 360 px with axe on the mock and on the API.
- The older shell, directory and claim-audit tests now follow the real screens and rules.
- Sunlight mode (high contrast) is a setting for the tailor's screens. Its contrast is tested on the main screens.
- A left-behind profile refused `code_not_found` now stays on the phone as rejected, because the server has no copy.
- The mock follows the server on claim rounds, withdrawals, `stale_app_version`, the per-code limit and session reuse. It now separates a deleted client from a client who asked for deletion.
- A deletion request on an unclaimed code that holds anything is now passed to the tailor and changes nothing. It no longer says "nothing is held" when a name is held, and it no longer blocks the phone's queue.

## 2026-11-01: M8 ingest and public endpoints

- The image guard could be made to take about 6 s on one unauthenticated request, by combining nested encoding with characters that expand when normalised, and it blocked the API meanwhile. Each body now has a budget of 64,000 normalised characters and is refused past it; the same request takes milliseconds and ordinary text is unaffected.
- `POST /profiles` runs the whole of backend-spec 9: size, image guard, strict parse, the validation order, consent, study, idempotency, versions, conflict rows, then server checks in one transaction. A check that fails internally is logged by type and the profile is still kept.
- The image guard reads every JSON key and value on every route before any schema, so a picture is refused as a picture wherever it hides.
- The server re-derives each profile with `vt_measure` under the profile's own rules. The mismatch rate on the seed profiles is 0. Static proportion bounds, change since last and height checks warn only.
- `GET /rules/current` and `/rules/{version}` serve checked artifacts; the API refuses to start on a wrong checksum.
- `POST /deletion-requests` and `POST /data-requests/access` work with proof of possession. The API role can now delete profiles (migration 0003), for deletion requests only, and still cannot delete clients or audit rows.
- The phone no longer reads every 409 as a conflict. `stale_app_version` means nothing reached the server, so the profile stays queued and asks for help after three tries.
- `make e2e-real-api` runs the client suite against the API on compose, plus new tests of what the server stored: an offline save arrives once, the server's own derivation agrees with the phone, and deleting removes the data from the server.
- **After review, the owner chose a device secret (D45).** The first version let anyone who knew a code upload a profile and then use its id to read or delete the client's data, or block them with a very high version. Now the phone holds a 256-bit secret per code and the server keeps only its hash. Forged uploads leave no row. The per-code allowance counts only uploads that passed validation and the claim check and are about to be stored; refused requests and replays do not use it. Access and deletion rest on the secret. A client on a new phone is refused and told to ask their tailor, and the tailor's reset is carried forward to M9.
- **Limit that remains:** the first caller can still claim a code nobody has used, which blocks the honest client until a tailor reset. A lost secret also has no remedy until M9 merges. See D45.
- **After a second independent review (D45, D49):**
  - A code that already holds data can no longer be claimed by an upload. It gets the same reply as a wrong secret. An exact replay of a stored body can claim it, which closes a lost reply after a reset. Each claim has its own audit row, `client_code_claim`.
  - A deletion or withdrawal by whoever holds the proof clears the name and height (spec 14.5), and an empty unclaimed code changes nothing. A stranger who claims a fresh code and uploads can therefore wipe those two fields, an accepted minor harm in favour of the right to deletion (D45).
  - Deleting on an unclaimed code with no profiles replies done, with nothing done, so a first upload that never arrived no longer leaves a stuck deletion.
  - The phone stops after five refusals, ends in `gave_up`, says something true for the cause, and offers Try again. A failed secret write stops only its own code.
  - The queue holds new uploads for a code while a deletion or withdrawal for it is pending, so a late deletion cannot wipe a newer profile.
  - Silhouette tenths are exact. The guard now decodes percent-encoding up to eight layers and HTML entities, and strips all invisible, format and combining marks.
  - Profile ids are looked up within their client, and another client's id gets one refusal, live or deleted (migration 0005).
  - The generated OpenAPI declares the 403s and header lengths, the drift test covers paths and responses, and the mock now matches the server (410, override refusal, tenths, secret format, claim rules, real deletion). The migration 0004 downgrade warns.
- Other review fixes, each with a test: a replay answers before the app version check, and an updated app can send an old profile (D42); a deletion is no longer dropped on a generic 404, and only `code_not_found` rejects a profile; the public upload refuses overrides (D46); the guard's regex is linear, and it sees through zero-width characters, BOM, fullwidth forms and percent-encoding; silhouette numbers finer than 0.1 mm are refused; a deleted profile cannot return by replay (D47); a lost connection is no longer called a bad payload; a failed re-derivation keeps the other checks and records `rederive_failed`; `stale_rules` only when older; `/rules/{version}` serves frozen rules and the current one (D48).
- The seed's silhouettes are now in tenths of a millimetre, like a real phone's, so `seed.json` changed.
- **Open (D49):** landmarks can still carry a little hidden numeric data.
- **Unverified:** the browser tests use the fake vision worker, so no profile from a real capture has reached the server. The 150 ms budget for server checks is not measured, and the airplane-mode check on a real phone is still the owner's. The tailor banner for a deletion request arrives with M9, and profiles on an order leave with M11's job.
- **Open:** D40 still stands: re-derivation is only comparable while the depth correction is 0.

## 2026-11-01: M7 TypeScript measurement module (not yet run on a phone)

- `src/measure/derive.ts` is a port of `vt_measure`. All 68 parity cases match in both languages, and `make parity` now runs both.
- `src/measure/silhouette.ts` reads each person mask into the 101-sample profiles and the crotch row before the mask is released (A5 F1, A14). The prototype engine is gone, so review values now come from the same derivation the server re-runs.
- An independent review drew hard masks and found wrong values passing. Fixed, each with a test: mask holes cutting a width, a merged arm or hand widening or undercutting the torso, a forearm adding to the side depth, a speck in the leg gap read as the crotch, a stray pixel setting the height, and a view with no mask measuring the frame instead of the person. A row where an arm has merged is now left empty, so the site fails visibly instead of showing an estimate (D39).
- Profiles are read before compute, so a crash cannot lose them, and any failure while building the profile now reaches the error screen and releases the masks. It used to leave a stuck spinner with masks held.
- A failed front view now reports 100% disagreement rather than 0, which read as perfect agreement.
- **Unverified:** no real capture has run through this, and the browser tests only cover the front view on a drawn figure. Values on real people are unknown, and hole, arm and hand limits are provisional (D39). Chest may fail too often if real arms merge at chest level.
- **Open:** profiles store millimetres at capture scale, so a later depth correction would rescale lengths but not girths (D40). This does not affect today's rules, where the correction is 0.
- **Size:** the capture engine is now 10.9 KB, taking the real client figure to about 179.5 KB (D38).

## 2026-11-01: M6 real capture pipeline (code complete, not yet run on a phone)

- Camera: rear 1080p, `zoom:1` pinned where the lens can go wider, a wide lens swapped for the main one, applied settings read back, landscape delivery turned upright in the pipeline, ImageCapture still on Android, all tracks stopped on leaving. A stream that arrives after the screen has gone is stopped at once (the M5 finding). The wake lock no longer leaks if it is granted after leaving.
- `pose.worker`: self-hosted MediaPipe lite and full models with WASM, GPU then CPU, masks as `Uint8Array`. `marker.worker`: a custom OpenCV.js ArUco build with sub-pixel corners, documented in `docs/opencv-build.md`. Both return numbers and masks only.
- All 10.3 checks now run on real numbers with hysteresis, then the burst and medians of 10.4. Combined masks are kept for M7 and released after computing. Every frame is closed, with a dev-only live-object counter and tests.
- `/setup` has a real download with checksums, progress and resume. Models and WASM get their own service-worker cache. The production "measuring isn't available yet" stop is gone.
- `/dev/capture-tuning` has a real-camera switch with live numbers for every check.
- The measuring sheet's marker is now read by the real detector from the generated PDF, in a unit test. An earlier draft of this entry claimed that before it was true: the OpenCV file was a temporary stub. The real 3.9 MB build is now in place, and `docs/opencv-build.md` records how to rebuild it.
- Running against the real build found and fixed three faults: the detector could not be constructed (a missing `Algorithm` binding), stopping a capture restarted the workers and kept a frame alive, and stopping kept the combined mask in memory until the next capture. The memory-release browser test now passes on real workers.
- Browser tests run the real models and detector end to end on a synthetic figure: front view measured, stop, everything freed, no request leaving the site.
- **Known intermittent:** the real-vision flow test passed 8 of 9 runs alone on one worker, using software rendering. A logged passing run shows the burst being rejected and retried on the synthetic figure, which may explain the timeout, but the failing run was not captured, so the cause is unproven. The project allows one retry. Watch for repeated retakes in the phone test. `make e2e` now runs real vision as a separate step, because it times out alongside the other browser tests.
- First load is 19.4 MB on a floor phone and 28.4 MB with the full model, against the 30 MB limit.
- **Size:** see D38. The budget flow line passes only because the capture code loads on demand; the real main-thread figure is printed and is over 170 KB. That is the owner's decision.
- **Provisional numbers:** measurements still come from the prototype engine until M7, and the silhouette profiles are empty, so a real capture's values are not usable yet.
- **Unverified:** no real phone has run this. Four-phone test, fps, memory, sunlight, lenses, iPhone rotation direction and airplane mode are all open (A10). Thresholds are untuned. Tests use a drawn figure on Chromium's fake camera.
- **Not built:** the camera file-input fallback (10.1.7), see D37.

## 2026-11-01: Tailor directory after the independent review (D27)

- Fixed an intermittent browser test: it reloaded the page with a directory-issued code, which the mock forgets, so it passed only if its click beat the mock's 404. It now uses a seeded code.
- **Stays off in production** until both M8 and M11's cleanup job exist. The API now has its own switch, `DIRECTORY_ENABLED`, off by default: the public directory endpoints and the listing opt-in answer 404 `not_found` while it is off. A tailor can still see and clear existing codes.
- Issuing is capped at 50 codes a day per tailor and 1000 a day overall, both settings, on top of the limits per address, refused with `rate_limited` and `Retry-After`. IPv6 now counts per /64 on the directory and code check endpoints. IPv4 is unchanged.
- Removing a client is refused with the new `client_records_retained` for collected orders or a study participant, for tailors and admins alike. Those records leave only through the retention job. A measured client with neither can still be removed.
- `POST /me/directory-clients/remove-unused` removes a tailor's directory clients with no profile, no orders and no participant, in one audit row with the count only. The list now reports `unused_total`.
- Tailor Settings pages through directory clients, offers Remove unused codes with a count and a warning, and gives a measured client a separate, stronger warning and confirm button, with Cancel on each. The panel's words moved to their own lazy file, which a client's phone never downloads. New Kiswahili is unreviewed.
- Typing or linking a different code on Start now drops consent given for the old one, and waits for that to reach phone storage before moving on. Retyping the same code keeps it.
- A new browser test builds in production mode with the flag unset. It found a real gap: the flag was switched off at run time only, so the directory screen and panel chunks still shipped. The build now settles the flag, and those chunks are gone from a switched-off build. The client flow is 168.9 KB of the 170 KB stop.
- A production build no longer deletes the mock worker from another build's folder when several run at once. `VT_E2E_PORT` moves the browser test ports, so two checkouts can test side by side.
- **Carried forward to M9:** rate limit counts live in memory and reset on restart (`services/ratelimit.py`), and the client list in `ClientListView` does not show where a client came from.

## 2026-10-31: Tailor directory and Get code (D27)

- API: public `GET /tailors` and `POST /tailors/{listing_id}/codes`, `GET /me/directory-clients`, `DELETE /clients/{id}`, and `GET /client-codes/{code}` (the part of M8 this flow needs). Migration 0002 adds the listing fields, off by default, and each client's `source`. Issuing is limited to 10 an hour and 30 a day per address, and audited with no personal data. The mock answers the same.
- Web: the client screen `/tailors` is rewritten on the contract client in both languages: browse, search, filter by specialty and area, Get code, copy, then Continue to `/start` with the code filled in and the tailor named. The code is saved on the phone before it is shown. Tailor Settings gains the opt-in, what to publish, and a list of directory clients with Remove. The prototype's shared business code is gone from settings, registration and the prototype client. Privacy text says what listed tailors publish, only when the directory is on.
- The flag: on in dev and mock builds, off in production builds unless set to `true`. Production stays off until M8's client flow runs on the real API. Settings and registration used to claim a directory listing even with the flag off, and no longer do.
- Browser tests cover the flow, the rate limit message, Kiswahili, accessibility and touch targets at 360 and 1280 px, plus a separate real build with the flag off. The directory is its own 2.8 KB chunk outside the client flow count; its words add to the dictionaries, so the client flow is now 169.3 KB of the 170 KB stop.
- The size check now prints the directory chunk on its own line, and `make e2e` also builds the flag-off copy.
- A new code from the directory clears any consent in the phone's draft, because that consent was given for another tailor.
- **Carried forward:** removing directory codes that are never used goes to the M11 retention job. Tailors can already remove them by hand.

## 2026-10-31: M5 consent save timing

- The app moved on from the consent screen before the answer reached phone storage, so a reload straight afterwards asked for consent again. It now waits for the save. This was failing one browser test on CI.

## 2026-10-31: M5 client capture flow on fake vision

- After the review, capture: a production build now says measuring is not available yet and stops before capture. Stopping a retake returns to the reviewed result. Retake works after a failed save. The spoken record counts only clips that really played, so 14 browser tests now run in real time and the suite takes about 11 minutes. Screen readers now hear each check's state, and browser tests read the stored data itself.
- After an independent review, phone data: Delete my data now removes the code, height and sex. Clearing a shared phone keeps rejected as well as pending profiles and warns about both. Only the profiles left behind are purged, so a later client is safe, and they no longer reappear. Deleting during a first send still asks the server to delete. Change code is also on My measurements, with a notice. Start saves as you type, and a clear forgets the code from the link. Coming online skips the backoff wait.
- **Known limit:** a corrected code takes the next version known on this phone. If the server already holds that version under the code, the profile still ends as a conflict; the phone cannot know.
- Browser tests cover the 21.1 client scenarios against the mock, including accessibility and a check that nothing but numbers leaves the phone.
- **Not done:** the real camera and MediaPipe (M6) and the real measure port (M7), so a production build cannot measure yet.
- Voice clips and the printable measuring sheet now work offline. The sheet's marker has not been read by a real detector yet.
- Every client screen (9.1 to 9.14) now works on a laptop in English and Kiswahili, using the contract API client. Client screens have no literal words, and a test checks that. New Kiswahili is unreviewed and privacy contact details are still [CONFIRM].
- Each client now downloads one language (D35), which keeps the whole flow at 168.5 KB, under the 170 KB stop but still over the 120 KB target.
- Fixed along the way: the phone check's SIMD test rejected every browser, and the header caused sideways scrolling on phones.
- Added the sync queue (pending, synced, conflict, rejected, with backoff) and the delete-my-data queue.
- Added voice guidance with A3 pacing, a volume check before Start, 64 placeholder clips and a script listing every message. Clips are placeholders, with Kiswahili read by an English voice; the recording is still OPEN.
- Added a fake vision worker that replays each check state, selectable at `/dev/capture-tuning`, and the runner that drives capture.
- Added the typed capture state machine with a test per transition, thresholds in one config file, and the checks, burst and phone-check logic.

## 2026-10-31: M4 backend foundation

- Added all database tables as a reversible migration, with limited database roles and triggers that keep the audit log, reference readings and their corrections from being changed.
- Added register, sign-in, sign-out, `/me` and password change: Argon2id passwords, 24-hour tokens that can be revoked, and a 15-minute lockout after 5 wrong passwords.
- Added role and ownership checks, the audit service, rate limits, standard error replies from the shared error codes, and `vt seed demo`, which production refuses.
- `make up` now applies migrations first, and the API connects with the limited role. `make seed` loads the demo data, and `wanjiru@vt.test` can sign in through the API docs page in a development build.
- After an independent review: database errors can no longer print submitted values into logs, and crashes log only the error type. NUL characters are refused. Added the limit of 300 requests a minute per user, a limit and audit on guessing the current password, and the same lockout reply for unknown emails. Attempts on a locked account are now audited. Replies are now tested against the contract, and new tests cover role and ownership checks through real routes, proxy address handling and the register limit. The API role can no longer delete clients directly, since that would delete their profiles. Study sessions in the seed now link to their participant.
- **Carried forward:** database checks on `sex`, `clothing_fit`, `lighting`, `age_band`, `consent.language` and the sheet locale and unit come with their endpoints (M8 to M11). The retention role's narrower rights come with the jobs (M11). HSTS and the frontend permissions header come with M12. The development API docs page loads its assets from a CDN; production has no docs page.

## 2026-10-31: M3 web foundation

- Every URL in the route map now has a screen, with sign-in and role checks. A wrong role sees a 403 page, an unknown URL a 404 page, and study pages stay hidden when study mode is off.
- Screens load on demand, and a browser test confirms the client flow downloads no tailor, admin or study code.
- Added a typed API client (real and mock) and a mock server covering all 60 contract endpoints. A test calls each one and checks the reply against the contract, plus sign-in and role refusals.
- Moved phone storage to Dexie, with a stronger guard that refuses image content. Removed the fallback that kept profiles in localStorage.
- Added the service worker, which never caches `/api/`, plus the offline banner and update toast.
- Added the shared components, the developer gallery and failure panel, which production builds leave out, and a Kiswahili review register, with every string marked unreviewed.
- Browser tests cover the routes in English and Kiswahili at 360 and 1280 px, with no serious accessibility problems and no sideways scrolling. Fixing them meant linking about 40 form labels and darkening low-contrast text. Dynamic detail routes, such as one client or one order, are not in this sweep yet.
- **Not met:** the whole client flow is 162 KB against the 120 KB budget (the first screen is about 94 KB). Decision D34 records why; meeting 120 KB fully would mean changing React or Dexie, which is the owner's call. The budget check stops further growth, but does not yet enforce 120 KB.
- After an independent review: "clear this phone" now also removes the prototype's local copies; the image guard sits on every database table and catches more forms of image data; links to the switched-off tailor directory are hidden; client screens work offline after one visit; "new order from profile" opens the chosen profile; a wrong current password no longer ends the session; malformed addresses show a 404 page instead of a blank one.
- **Carried forward, and blocks any public release:** the screens still run on the prototype's local mock client, so in a production build any password signs in, including as admin, and the new API client and mock server are not connected to the screens yet. This moves to the real API client in M9 to M11.
- **Carried forward:** some screens still have English text in Kiswahili mode (M9 to M11), and some controls, including the header ones, are under the 48 px touch size (M16). The accessibility check does not catch either.

## 2026-10-31: M2 Python measurement core

- Added `vt_measure`, which turns profile numbers into nine measurements and flags. It handles the one-handed sheet pose (A14), using the free arm for the sleeve, and warns when that arm is unknown.
- Added a synthetic body with known answers. The code recovers each known value to within 0.1 mm.
- Added 68 parity cases in `packages/parity-fixtures`, for the TypeScript version to match later. `make parity` now runs the Python half, and the CI parity job runs it with a 95% coverage limit.
- After an independent review: added two-view test cases worked out by hand, because the first tests could not tell the front and side views apart. Removed calculations that differ between Python and JavaScript, and made bad pose data (a hip above the shoulder) fail instead of giving a value. Re-ran the deliberate bugs the review used, and the tests now catch them all.
- Rebuilt the demo seed from `vt_measure`, so every stored measurement recomputes from the numbers beside it.
- Added the `free_arm_unknown` flag reason to the contract. Added `nominal_distance_mm` and `free_arm_min_distance_ratio` to the draft rules. The depth correction stays at 0.

## 2026-10-31: M1 shared contract, seed and rules

- Added the API contract: 60 endpoints in OpenAPI 3.1, with generated TypeScript types.
- Added 26 stable error codes, including `approvals_missing`.
- Added the rules schema and the `0.1-uncalibrated` artifact, with a checksum. It is a draft built from literature values, and nothing is frozen.
- Added a deterministic seed with synthetic accounts, 11 clients, 12 profiles, 10 orders, 40 audit rows and 5 study participants.
- Added tests for the contract, rules and seed. Tests confirm that no upload is possible and that the seed matches the contract.
- `make contract` now validates, regenerates and fails if the generated files drifted from what is committed. The CI contract job now runs it.
- Added `docs/api-contract.md`, a plain-language guide to every endpoint.
- After an independent review: conflict replies now always carry `server_version` and `conflict_id`, and rate-limit replies carry `Retry-After`.
- Bounded every string in the contract, plus every number and list a phone sends, and limited free-form fields in rules files, to close routes for hidden content.
- Corrected the seed: audit retention is 24 months, order numbers restart per tailor, and the conflict pair follows the ingest rule.

## 2026-10-31: M0 monorepo foundation

- Moved the prototype to `apps/web` and added the API and Python package skeletons.
- Added the Makefile, CI, Docker Compose stack and licence check.
- Kept planning documents out of the public repository.
