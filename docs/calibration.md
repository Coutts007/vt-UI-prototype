# Calibration: from tape readings to a frozen rules version

This is the researcher's runbook for backend-spec 11.3 and 11.7 (M13). It runs on the study laptop, never on a phone, and reads the calibration cohort only. **Freezing a rules version is the owner's decision.** Nothing here freezes anything by itself.

## 1. Export the calibration bundle

On the study laptop, with the stack running:

```sh
docker compose -f deploy/docker-compose.yml exec api .venv/bin/vt study export-calibration --out /data/calibration-bundle.json
```

Keep the bundle, the fit's report folder and anything else person-level on the encrypted disk and **outside the repository checkout** (the examples below use `~/vt-study/`). The bundle is written owner-readable only. `.gitignore` also refuses `*calibration-bundle*.json`, `/reports/` and `docs/reports/calibration-*/`, so a stray `git add` cannot publish them (D30); the only committed report is the synthetic sample.

The bundle holds, for calibration participants only: participant code, cohort, sex, the numbers each capture set sent (landmarks, marker corners, silhouette profiles) and the tape readings with corrections applied. No names, phone numbers, emails or client codes. Pilot and test participants never leave the database through this command, and `vt_ml` filters the cohort again when it reads the file.

## 2. Fit a draft

```sh
uv run vt-ml calibrate \
  --data ~/vt-study/calibration-bundle.json \
  --base packages/rules/rules-0.1-uncalibrated.json \
  --version 1.0-ke-cal25 \
  --out packages/rules/rules-1.0-ke-cal25.json \
  --report ~/vt-study/reports/calibration-1.0/ \
  --card docs/model-card-1.0-ke-cal25.md \
  --label "calibration cohort, exported <date>"
```

What it does, in order:

1. **Torso girths** (chest, waist, hip band, neck): a grid search over the anatomical band in steps of 0.01; at each level the ellipse perimeter `P` and a correction factor fitted by least squares through the origin (`CF = ΣP·T / ΣP²`); each level scored by leave-one-participant-out MAE with the factor refitted in every fold. The prior level stays unless a new one is at least 2 mm better. Chest is fitted per sex when each sex has 8 or more participants. An affine variant `a·P + c` is adopted only if it gains 3 mm or more and the bootstrap interval of the gain excludes zero; it then appears as `girth_model.intercepts_mm`.
2. **Widths and lengths** (shoulder, sleeve, outside leg, inside leg): one constant offset each, the mean of tape minus system, with outside leg fitted after the waist level is fixed.
3. **Uncertainty:** a participant-level bootstrap (2,000 resamples, seed 20270301) for every parameter and for LOO MAE, stored under `fit.bootstrap_ci`.
4. **Anomaly reference:** per sex, the median and MAD of `log(site / stature)` and `log(waist / hip)`, and a Ledoit-Wolf covariance of the log-measurements, stored under `anomaly.per_sex` for the server's checks.
5. **Learned girth experiment:** ridge regression on profile features with nested leave-one-out, compared with ellipse × factor, and the promotion rule of 11.4 applied. The result goes into the report and the model card; the model is never written into the artifact (the phone needs F11 first).

Outputs: the draft artifact (`status: draft`, with a `fit` block and checksum; it holds aggregates only and is meant to be committed), a report folder (`summary.json`, `before_after.csv`, `level_curves.csv`, `perimeter_vs_tape.csv`, `residuals.csv`, `exclusions.csv`, `learned_girth.json`, `anomaly_evaluation.json`; the residual and scatter tables are per participant code, so the folder stays outside the checkout) and the model card (aggregates only; committed as `docs/model-card-<version>.md`).

Options: `--seed`, `--resamples` (fewer for a quick look), `--min-readings` (below the 4-reading protocol; the card says so), `--created-at`.

A synthetic cohort with known answers exists for rehearsal: `uv run vt-ml synth --base packages/rules/rules-0.1-uncalibrated.json --out /tmp/bundle.json --n 25`. The recovery test in `packages/py/vt_ml/tests` checks that the fit finds the true levels within 0.01, factors within 1% and offsets within 1.5 mm.

## 3. Review

Read the model card. For each fitted number, can you explain it to an examiner? Check the exclusions list, the before/after table and the level curves. The LOO columns are the honest ones; the in-sample columns flatter the fit.

Then run parity on the new file in both languages: `make parity` (the fixtures include a case fitted on a synthetic cohort, so the TypeScript port is already exercised on calibrated shapes).

## 4. Register, freeze, set current

Sign in as the administrator and use the API (the development docs page at `/docs`, or curl):

```sh
# register the draft
curl -X POST https://<host>/api/v1/admin/rules -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" --data @packages/rules/rules-1.0-ke-cal25.json
# the owner freezes it: one way, audited
curl -X POST https://<host>/api/v1/admin/rules/1.0-ke-cal25/freeze -H "Authorization: Bearer $TOKEN"
# make it the version phones download
curl -X PUT https://<host>/api/v1/admin/settings -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" --data '{"current_rules_version": "1.0-ke-cal25"}'
```

Registration checks the file against `packages/rules/schema.json`, its checksum, that it is a draft, that the version is new and that its parent is known. A registered version can be set current only once frozen. The database refuses every change to a frozen row except retiring it, and the server refuses to compute with any artifact whose checksum does not match.

After freezing, copy the file as served (`GET /rules/1.0-ke-cal25`, which carries `status: frozen` and the same checksum) into `packages/rules/frozen/`, and point `apps/web/src/measure/rules.ts` and `src/capture/compute.ts` at the new file so the next web build bundles it. The pre-commit hook and CI refuse any later change to a frozen file.

## 5. Re-derive and analyse

```sh
curl -X POST "https://<host>/api/v1/admin/rederive?rules_version=1.0-ke-cal25&cohort=test" -H "Authorization: Bearer $TOKEN"
```

Re-derivation needs a frozen version and writes into `measurement_derivation`; the originals never change. `GET /study/export/captures.csv?rules_version=1.0-ke-cal25` then exports the test cohort's values under that version for `vt_analysis` (M14).

## What is not done here

- BodyM is not used (D23, M13-2).
- There is no admin screen for the registry yet (M13-6).
- Nothing in this document has run on real data: real participant data waits for the approvals (A9).
