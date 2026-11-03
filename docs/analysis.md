# Validation analysis: from the exports to the results chapter

The researcher's runbook for backend-spec 12 (M14). It runs offline on the study laptop, reads the API's CSV exports and writes the tables, figures and `results.md` of the results chapter. **It analyses the test cohort only, under a frozen rules version**, and stops otherwise.

## 1. Inputs

From the admin screens or the API, signed in as the administrator:

| File | Where from | Notes |
|---|---|---|
| `captures.csv` | `GET /study/export/captures.csv?rules_version=<frozen version>` | One row per capture set; values re-derived under that version (`rederived_rules_version`) |
| `reference.csv` | `GET /study/export/reference.csv` | Tape readings, corrections applied |
| `registry.json` | `GET /admin/rules` | The registry listing; the version must be `frozen` with a `frozen_at` time |
| `paper_covariates.csv` | Written by hand on the laptop, never uploaded | `participant_code, weight_kg, measured_stature_cm, age_band, notes` and, if wanted for stratification, `sex` |

Keep all four outside the repository checkout (for example `~/vt-study/`); `.gitignore` also refuses `/reports/`, `/data/` and every folder under `docs/reports/` except the two synthetic samples. The report folder is written outside the checkout too. It holds pseudonymous participant codes (in `exclusions.csv`, `strata.csv` and `metadata.json`) and no names, so it is study data: keep it on the encrypted laptop and delete it with the exports at the end of the retention period in `docs/retention-schedule.md`. The analysis reads only the covariate columns it uses (weight and stature for the BMI class, and sex); `age_band` and `notes` stay on paper.

## 2. Run

```sh
uv run vt-analysis run \
  --captures ~/vt-study/captures.csv \
  --reference ~/vt-study/reference.csv \
  --registry ~/vt-study/registry.json \
  --rules 1.0-ke-cal25 \
  --covariates ~/vt-study/paper_covariates.csv \
  --calibration-report ~/vt-study/reports/calibration-1.0/ \
  --out ~/vt-study/report/2027-05-20/
```

The run refuses with exit code 2 and `rules_not_frozen` if the version is not frozen in the registry listing, and with `cohort mismatch` if no test-cohort capture set under that version remains. Rows of other cohorts are left out and counted in `metadata.json`; rows of other rules versions, sets where a site failed and participants missing a tape reading for a site are listed in `tables/exclusions.csv` with their reasons.

Outputs in the report folder:

- `results.md`: the acceptance table (proposal Table 1.1), one table per site in the layout of proposal Table 3.2, the exploratory analyses and the method notes.
- `tables/agreement.csv`, `acceptance.csv`, `strata.csv`, `decomposition.csv`, `exclusions.csv`, `lighting.json`.
- `figures/`: Bland-Altman and system-against-tape plots per site, residuals by BMI class (when covariates are given), set 1 against set 3, and the calibration level curves (when the fit report is given). 300 dpi PNG and SVG.
- `metadata.json`: rules version and freeze time, cohort counts, exclusions, seed, resamples, package versions.

A run is deterministic: the same inputs and seed give byte-identical tables, metadata and figures (`--seed`, default 20270520; `--resamples`, default 2,000).

## 3. What the statistics are

All values are millimetres; the reference is the mean of the four tape readings; the system value is every capture set with a value.

- **Bias:** mean of the participant-mean differences (system minus tape), 95% interval by cluster bootstrap over participants.
- **Limits of agreement:** mixed model `d_ij = mu + u_i + e_ij` by REML; `LoA = mu ± 1.96 √(σ_u² + σ_e²)`; bootstrap intervals on each limit from the Bland and Altman (1999) moments estimate; the moments point estimate is printed beside it as a cross-check.
- **MAE, RMSE, MAPE** on all pairs and on participant means; **share within** 10, 15, 20 and 30 mm; **percentiles** of absolute error.
- **ICC(2,1)** absolute agreement on participant means with the F-based interval of McGraw and Wong (1996); **Lin's CCC** with a Fisher-z interval; **proportional bias** by OLS of the difference on the mean with cluster-robust standard errors.
- **System repeatability:** within-participant SD across sets and the repeatability coefficient 2.77 s_w; self-capture against assisted on participants who did both.
- **Tape reliability:** intra-observer TEM per measurer, inter-observer TEM on measurer means, pooled multi-reading TEM, %TEM and R.
- **Verdicts:** tier 1 |bias| ≤ 9 mm; tier 2 at least 90% of pairs within 15 mm (widths and lengths) or 30 mm (girths); tier 3 both outer confidence bounds of the limits inside ±30 or ±40 mm. A FAIL is never rounded into a PASS. Stature is reported, not tiered. Neck is tiered unless the owner decides otherwise after the pilot.

Each statistic is written out in `packages/py/vt_analysis/src/vt_analysis/stats.py` and tested against a worked example (Shrout and Fleiss for the ICC, hand calculations for the others).

## 4. Exploratory analyses

Labelled exploratory in every table. Strata: sex (from the covariates file), BMI class (WHO cut-offs from weight and measured stature), observed clothing fit, lighting, camera facing, phone model and capture mode. The girth error decomposition estimates the scale term (system girth rescaled by tape stature over system stature) and the cross-section term (an oracle per-site factor fitted on the test cohort itself) from the exports; the level term needs the capture profiles, which the CSV does not carry, and is reported as not estimated. Oracle terms are diagnostic and were never used for acceptance. Lighting: absolute error against lux by lowess and the lux band below which failed sites rise.

## 5. Usability

```sh
uv run vt-analysis sus --input ~/vt-study/sus_tam.csv --out ~/vt-study/report/usability/
```

`sus_tam.csv` has one row per tailor with `q1` to `q10` (1 to 5) and `tam11` to `tam15`. SUS: odd items score − 1, even items 5 − score, sum × 2.5; mean with a t-based interval, the adjective grade and the NFR-05 target of 68. TAM: medians and interquartile ranges. Everything is labelled "formative, n = 10".

## 6. Rehearsal

A synthetic set of exports exists so the pipeline can be run before any study data: see `docs/reports/sample/README.md`. Nothing in it is a finding about people.
