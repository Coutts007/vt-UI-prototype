# Handover note for the owner

Written at the end of M16 (2026-11-03). What is ready, what waits for the study, what is still yours to decide, and the exact commands for the calibration day.

## 1. Ready for the pilot

- **Client capture app** (rear camera, voice guidance; front camera and the torch cue behind flags), measurement on the phone with the `0.1-uncalibrated` rules, offline save and sync, deletion and withdrawal from the phone.
- **Tailor dashboard:** codes, clients, profiles, conflicts, orders with ease, specification sheets (PDF and PNG) shared by WhatsApp, audit.
- **Admin and study:** approvals guard (A9), accounts, measurers, enrolment with seeded cohort allocation, blind tape entry, exports, retention and deletion with nightly dry-run reports, capture completion per mode.
- **Operations:** the study-site profile on the laptop (`docs/study-site.md`), the production VM profile with firewall, encrypted backups and a tested restore (`docs/runbook.md`), security headers and CSP, fuzzing and load tests in CI.
- **Analysis:** `vt-ml` (calibration, registry, anomaly reference, learned girth) and `vt-analysis` (Table 3.2 statistics, Table 1.1 verdicts, plots, SUS) on synthetic and seed data, with model cards.

## 2. Needs real study data

| What | Why it waits | Where |
|---|---|---|
| Calibrated rules | Needs the calibration cohort's tape readings | `docs/calibration.md` |
| Anomaly reference | Same cohort, written by the calibrate step | `docs/calibration.md` section 2, item 4 |
| Acceptance verdicts (NFR-04) | Test cohort under frozen rules | `docs/analysis.md` |
| Depth correction (D40) | Needs the M6 phone measurements of the bias | `packages/rules` (default 0) |
| Completion rate per mode (NFR-07) | Pilot logs | Admin › Capture modes |

## 3. Still [CONFIRM] or OPEN for you

From `docs/decisions.md` (private): D18 native-speaker audio clips; D19 hosting region (M16 is provider-agnostic; South Africa needs the transfer sentence in the consent text); D23 BodyM research-only use; D24 contact details in the consent and privacy text (placeholders are still in the app; they must be real before the pilot); D28 commercial use of study data (a separate consent box before the IERC submission); D29 data controller for a commercial product; D38 client JS size with the capture engine; D40 depth correction; D44 withdrawal rule (M11 default); D49 items from the M8 review; M12-13 is resolved in M16 (counts in the database, two workers) but the load targets have not been re-measured on a 2 vCPU limit.

Also yours: the Kiswahili review (`docs/i18n-review.md`, every string is `reviewed:false`), the device tests on the four reference phones (`docs/device-test-log.md`, M6, M8, M15 rows empty), the TalkBack and VoiceOver pass on real phones, the restore drill from the VM once it exists (runbook section 11), freezing the rules (golden rule 8), and the public deployment itself.

## 4. The calibration day: exact commands

After the calibration cohort is measured and both measurers' tape readings are in. Person-level files stay on the encrypted laptop under `~/vt-study/`, outside the checkout.

```sh
# 1. Export the calibration bundle (study laptop, stack running; participant codes only)
docker compose -f deploy/docker-compose.yml exec api .venv/bin/vt study export-calibration --out /data/calibration-bundle.json
docker compose -f deploy/docker-compose.yml cp api:/data/calibration-bundle.json ~/vt-study/calibration-bundle.json

# 2. Fit a draft and its model card
uv run vt-ml calibrate \
  --data ~/vt-study/calibration-bundle.json \
  --base packages/rules/rules-0.1-uncalibrated.json \
  --version 1.0-ke-cal25 \
  --out packages/rules/rules-1.0-ke-cal25.json \
  --report ~/vt-study/reports/calibration-1.0/ \
  --card docs/model-card-1.0-ke-cal25.md \
  --label "calibration cohort, exported <date>"

# 3. Parity in both languages must pass before anything is registered
make parity

# 4. Register, freeze (one way, audited, only you), set current: docs/calibration.md section 4
# 5. Copy the served file into packages/rules/frozen/, point the web build at it, deploy

# 6. After the test cohort: re-derive, export, analyse under the frozen rules
uv run vt-analysis run \
  --captures ~/vt-study/captures.csv \
  --reference ~/vt-study/reference.csv \
  --registry ~/vt-study/registry.json \
  --rules 1.0-ke-cal25 \
  --covariates ~/vt-study/paper_covariates.csv \
  --calibration-report ~/vt-study/reports/calibration-1.0/ \
  --out ~/vt-study/report/<date>/
```
The anomaly reference is part of the calibrate step (it lands under `anomaly.per_sex` in the artifact). Both documents were rehearsed on the synthetic sample (`uv run vt-ml synth`, `docs/reports/sample*/`).

## 5. What does not work yet, plainly

- The load targets of backend-spec 16.4 were not met on 2 vCPU in M12 and have not been re-run with two workers.
- Both camera modes, the torch cue and the timings (NFR-01) are unverified on real phones.
- Lighthouse runs on a laptop-class machine in CI, not on a Tecno over 4G; the 3.5 s target is a proxy until the device log says otherwise.
- The TalkBack and VoiceOver pass needs real phones; the automated pass covers axe, headings, skip links, reduced motion and 200% zoom.
- M17 (research workspace) waits for the image-vault decision and M18 (commercial readiness) for scoping with you.
