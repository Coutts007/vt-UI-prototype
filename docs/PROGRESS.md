# Progress log

The newest entry comes first. Every change or improvement adds a line in the same commit.

## 2026-11-01: M8 ingest and public endpoints

- `POST /profiles` runs the whole of backend-spec 9: size, image guard, strict parse, the validation order, consent, study, idempotency, versions, conflict rows, then server checks in one transaction. A check that fails internally is logged by type and the profile is still kept.
- The image guard reads every JSON key and value on every route before any schema, so a picture is refused as a picture wherever it hides.
- The server re-derives each profile with `vt_measure` under the profile's own rules. The mismatch rate on the seed profiles is 0. Static proportion bounds, change since last and height checks warn only.
- `GET /rules/current` and `/rules/{version}` serve checked artifacts; the API refuses to start on a wrong checksum.
- `POST /deletion-requests` and `POST /data-requests/access` work with proof of possession. The API role can now delete profiles (migration 0003), for deletion requests only, and still cannot delete clients or audit rows.

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
