# Progress log

The newest entry comes first. Every change or improvement adds a line in the same commit.

## 2026-10-31: M5 client capture flow on fake vision

- Browser tests cover the 21.1 client scenarios against the mock, including accessibility and a check that nothing but numbers leaves the phone.
- **Not done:** the real camera and MediaPipe (M6) and the real measure port (M7), so a production build cannot measure yet.
- Voice clips and the printable measuring sheet now work offline. The sheet's marker has not been read by a real detector yet.
- Every client screen (9.1 to 9.14) now works on a laptop in English and Kiswahili, using the contract API client. Client screens have no literal words, and a test checks that. New Kiswahili is unreviewed and privacy contact details are still [CONFIRM].
- Each client now downloads one language (D35), which keeps the whole flow at 166.9 KB, under the 170 KB stop but still over the 120 KB target.
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
