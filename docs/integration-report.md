# Integration report (backend-spec 15.6, M12)

Run on 2 November 2026 with `make walkthrough`: the test build behind Caddy with the production
Caddyfile (so under the real Content Security Policy), the real API and PostgreSQL, and the demo
seed. **Synthetic data only**: every account is `@vt.test`, the phone numbers are placeholders and
the names come from `packages/seed/seed.json`. Screenshots are in `docs/integration/`, taken by
the Playwright suites at a 412 px phone width.

Result of that run: 49 browser tests through Caddy, 48 passed and the walk-through failed on its
deep-link check (the code fills one box per character, so it is not page text). The check now looks
for the tailor's name the app shows for the code, and the walk-through passes on its own run.

| Step | What happened | Proven by | Screenshots |
|---|---|---|---|
| 1. A tailor registers and the administrator approves | A new tailor registers, sees the pending page, the admin approves from Accounts, and the tailor signs in | `walkthrough.spec.ts` | `01a-register`, `01b-pending` (caught while loading), `01c-admin-approves` |
| 2. Code and WhatsApp deep link | The tailor issues a code; the deep link opens the client app with the code filled in and names the tailor | `walkthrough.spec.ts`, `tailor.spec.ts` | `02-code-issued`, `02a-code-and-whatsapp`, `02b-deep-link-opens` |
| 3. Capture, save offline, sync | Fake camera capture, review, save while offline, then the profile arrives once when back online and the server's re-derivation agrees with the phone | `server-sync.spec.ts`; real MediaPipe and OpenCV.js through Caddy in the `real-vision-csp` project | `03a-review`, `03b-saved-offline`, `03c-synced` |
| 4. Profile, order, sheet, share | The profile with flags and server checks (the view is audited); an order with ease suggestions and the flagged rows confirmed; a sheet generated and shared through the share sheet, and through download plus the `wa.me` link | `tailor.spec.ts`; the share log for both paths in `apps/api/tests/test_sheets.py` | `04a-profile`, `04b-order-flagged-rows-answered`, `04c-sheet` |
| 5. The audit log shows the steps | The tailor's log names each action and never a client code; the admin's log shows every account's actions | `walkthrough.spec.ts`; an audit assertion per endpoint in the API tests | `05a-tailor-audit`, `05b-admin-audit` |
| 6. A conflict is created and resolved | The client is told a newer version is saved; the tailor compares the two and resolves | `client.spec.ts`, `tailor.spec.ts` | `06-conflict` |
| 7. Deletion and the retention dry run | "Delete my data" removes the profile from the server; a deletion nobody can prove reaches the tailor, who decides; the dry run is in `retention-dry-run.txt` | `server-sync.spec.ts`, `tailor.spec.ts`; the retention periods with seeded ages in `apps/api/tests/test_m11_retention.py` | `07-deletion-requests` (shows the top of Settings, not the list itself), `retention-dry-run.txt` |
| 8. Study mode | The admin enrols P006, the cohort is allocated (Test), and measurer A saves reading 1 blind; the measurer screen never holds a system value | `study.spec.ts`; allocation and readings by measurers A and B in `test_m11_admin_study.py`; seeded study captures with their set numbers in `test_m11_exports.py` | `08a-participant-enrolled`, `08b-measurer-reading-saved` |
| 9. Export, calibrate, freeze, re-derive, analyse | **Not possible yet**: `vt-ml calibrate` comes with M13 and `vt-analysis run` with M14 (M12-8). The exports exist and are tested (M11) | — | — |

**About step 7.** The dry run reports zero for every count. The demo data holds nothing past its
retention period, and the deletion in step 7 happens at once rather than waiting for the job. The
retention job's effect is proven by the API tests, which give rows ages past each period.

**About step 8.** The browser test enrols a participant and enters one measurer's reading. The
second measurer is covered by the API tests. **Three new capture sets for P006 were not walked
through:** that needs three study captures from a phone, which the owner's two-phone check can
do. The seed's study captures, with their set numbers, go through the export tests.

## Security headers and fuzzing

- Every page is sent the frontend-spec 19 CSP, and API replies their own stricter one. HSTS, a
  Permissions-Policy, COOP and `X-Frame-Options` are also sent. `csp.spec.ts` checks the headers
  and finds no CSP violation on the client, tailor, admin and study screens. The marker worker
  alone may use `'unsafe-eval'`, because OpenCV.js needs it (M12-10).
- `make stack-check` runs the production build with rate limits on. A forged `X-Forwarded-For`
  cannot reset the sign-in limit behind Caddy.
- Schemathesis fuzzed every endpoint as nobody, a tailor and the admin. It found two server errors
  and three replies that broke the contract; all five are fixed with tests (see `docs/PROGRESS.md`).

## Load test (backend-spec 16.4)

`make load`: the API at 1.5 vCPU and 2.5 GB, the database at 0.5 vCPU and 1.5 GB (the 2 vCPU, 4 GB
VM together), one Uvicorn worker, 5,000 synthetic clients and 20,000 profiles, Locust for 60 seconds
per scenario. One run each, so the tails are noisy.

| Check | Target | Before the M12 fixes | After |
|---|---|---|---|
| Uploads (`POST /profiles`), rate | 20 req/s | 18.5 | 17.2 |
| Uploads, p95 | 300 ms | 1,500 ms | 1,800 ms |
| `GET /clients`, median / p95 | p95 200 ms | 7,600 / 14,000 ms | 80 / 1,300 ms |
| Client search, p95 | 200 ms | 5,600 ms | 850 ms |
| A client's profiles, p95 | 200 ms | 1,200 ms | 540 ms |
| Orders, p95 | 200 ms | 4,300 ms | 280 ms |
| 50 mixed users, throughput | — | 9.3 req/s | 21.4 req/s |
| Sheets under 50 users, median / p95 | 1,500 ms | 27 / 34 s | 7.7 / 12 s |
| Errors at 50 users | 0 | 1 | **0** |

**The speed targets are not met.** Two problems the load test found are fixed:

- **Client list:** the list read every version of every client's profiles (M12-11).
- **Sheets:** sheet generation held a database connection while it waited to render (M12-12).

What remains is CPU: one upload costs about 110 ms and one sheet about 0.9 s of a single process.
A second worker would use the spare CPU, but it waits on moving the rate limiter's counts out of
process memory. That choice is the owner's (M12-13).

## Not verified here

- The study site on the owner's laptop with two phones on the same Wi-Fi (`docs/study-site.md`):
  certificate trust on Android and iPhone, and capture end to end on real cameras.
- Steps 9 (M13, M14) and the load test on the real VM, rather than a laptop with CPU limits.
