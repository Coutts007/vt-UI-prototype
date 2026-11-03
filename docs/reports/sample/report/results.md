# Validation results

Rules `1.0-ke-test`, frozen at 2027-05-01T08:00:00Z. Test cohort only: 24 participants, 72 capture sets (the export held test: 24 participants, 72 sets). Seed 5, 2000 bootstrap resamples. 6 exclusions, listed in `tables/exclusions.csv`.

Units are millimetres. Reference value: the mean of four tape readings. System value: every capture set with a value. Bias is the mean of participant means; the limits of agreement come from a mixed model over all sets.

## Acceptance (proposal Table 1.1)

| Site | Tier 1 mean bias | Tier 2 individual differences | Tier 3 limits of agreement | Verdict |
|---|---|---|---|---|
| Shoulder width | PASS: +0.4 mm (target |bias| <= 9 mm) | PASS: 100.0% within 15 mm (target >= 90% within 15 mm) | PASS: outer bounds -12.4 to +12.7 mm (target within +/- 30 mm, confidence bounds included) | **PASS** |
| Sleeve | PASS: +5.9 mm (target |bias| <= 9 mm) | FAIL: 88.7% within 15 mm (target >= 90% within 15 mm) | PASS: outer bounds -10.3 to +21.6 mm (target within +/- 30 mm, confidence bounds included) | **FAIL** |
| Outside leg | PASS: +0.3 mm (target |bias| <= 9 mm) | PASS: 97.2% within 15 mm (target >= 90% within 15 mm) | PASS: outer bounds -14.9 to +15.0 mm (target within +/- 30 mm, confidence bounds included) | **PASS** |
| Inside leg | PASS: +0.7 mm (target |bias| <= 9 mm) | PASS: 98.6% within 15 mm (target >= 90% within 15 mm) | PASS: outer bounds -13.6 to +15.2 mm (target within +/- 30 mm, confidence bounds included) | **PASS** |
| Chest | FAIL: +12.2 mm (target |bias| <= 9 mm) | PASS: 100.0% within 30 mm (target >= 90% within 30 mm) | PASS: outer bounds -1.4 to +25.6 mm (target within +/- 40 mm, confidence bounds included) | **FAIL** |
| Waist | PASS: -3.3 mm (target |bias| <= 9 mm) | PASS: 100.0% within 30 mm (target >= 90% within 30 mm) | PASS: outer bounds -16.3 to +11.0 mm (target within +/- 40 mm, confidence bounds included) | **PASS** |
| Hip | PASS: +0.2 mm (target |bias| <= 9 mm) | PASS: 100.0% within 30 mm (target >= 90% within 30 mm) | PASS: outer bounds -14.7 to +15.1 mm (target within +/- 40 mm, confidence bounds included) | **PASS** |
| Neck | PASS: +0.1 mm (target |bias| <= 9 mm) | PASS: 100.0% within 30 mm (target >= 90% within 30 mm) | PASS: outer bounds -14.9 to +14.4 mm (target within +/- 40 mm, confidence bounds included) | **PASS** |

Sites passing all three tiers: Shoulder width, Outside leg, Inside leg, Waist, Hip, Neck. A FAIL is never rounded into a PASS; the numbers stand next to each verdict.

## Agreement per site (proposal Table 3.2 layout)

Stature is reported but is not in the acceptance tiers.

### Stature

| Statistic | Value | Purpose |
|---|---|---|
| n (participants; pairs) | 24; 72 | Sample |
| Mean bias, 95% CI (mm) | -0.1 (-1.4 to +1.2) | Systematic error; tier 1 after constant-offset correction |
| SD of differences (mm) | 6.0 | Random error (mixed model) |
| 95% limits of agreement with CIs (mm) | -12.0 (-14.5 to -10.1) to +11.7 (+9.8 to +14.3) | Tier 3, outer confidence bounds |
| Moments cross-check of the LoA (mm) | -12.2 to +11.9 | Bland and Altman (1999) method of moments |
| MAE, RMSE, MAPE (pairs) | 5.0, 6.0 mm, 0.3% | Comparison with published studies |
| MAE, RMSE, MAPE (participant means) | 2.8, 3.3 mm, 0.2% | Same, one value per person |
| Share within 10, 15, 20, 30 mm | 92%, 100%, 100%, 100% | Tier 2 |
| Absolute error p50, p75, p90 (mm) | 4.8, 7.2, 9.2 | Typical, poor and bad cases |
| ICC(2,1), 95% CI | 0.999 (0.998 to 1.000) | Reliability, absolute agreement |
| Lin's CCC, 95% CI | 0.999 (0.998 to 1.000) | Agreement penalising bias and scatter |
| Difference on mean: slope, 95% CI | +0.006 (-0.015 to +0.027) | Proportional bias |
| Tape TEM: intra (per measurer), inter, pooled (mm); %TEM; R | intra A 2.05, B 1.35; inter 1.4; pooled 1.82; 0.107%; R 0.9995 | Noise floor of the reference |
| System repeatability: s_w, 2.77 s_w (mm) | 6.2, 17.1 | Across the capture sets |
| Self-capture minus assisted (mm), 95% CI, n | -0.4 (-3.7 to +3.0), n = 24 | Capture mode difference |

### Shoulder width

| Statistic | Value | Purpose |
|---|---|---|
| n (participants; pairs) | 24; 72 | Sample |
| Mean bias, 95% CI (mm) | +0.4 (-0.9 to +1.7) | Systematic error; tier 1 after constant-offset correction |
| SD of differences (mm) | 5.4 | Random error (mixed model) |
| 95% limits of agreement with CIs (mm) | -10.2 (-12.4 to -8.1) to +11.1 (+9.3 to +12.7) | Tier 3, outer confidence bounds |
| Moments cross-check of the LoA (mm) | -10.2 to +11.1 | Bland and Altman (1999) method of moments |
| MAE, RMSE, MAPE (pairs) | 4.4, 5.4 mm, 1.0% | Comparison with published studies |
| MAE, RMSE, MAPE (participant means) | 2.7, 3.1 mm, 0.6% | Same, one value per person |
| Share within 10, 15, 20, 30 mm | 93%, 100%, 100%, 100% | Tier 2 |
| Absolute error p50, p75, p90 (mm) | 4.2, 5.8, 8.7 | Typical, poor and bad cases |
| ICC(2,1), 95% CI | 0.996 (0.990 to 0.998) | Reliability, absolute agreement |
| Lin's CCC, 95% CI | 0.996 (0.990 to 0.998) | Agreement penalising bias and scatter |
| Difference on mean: slope, 95% CI | +0.023 (-0.014 to +0.060) | Proportional bias |
| Tape TEM: intra (per measurer), inter, pooled (mm); %TEM; R | intra A 2.05, B 1.95; inter 1.67; pooled 2.12; 0.505%; R 0.9959 | Noise floor of the reference |
| System repeatability: s_w, 2.77 s_w (mm) | 5.4, 14.9 | Across the capture sets |
| Self-capture minus assisted (mm), 95% CI, n | -1.1 (-3.8 to +1.6), n = 24 | Capture mode difference |

### Chest

| Statistic | Value | Purpose |
|---|---|---|
| n (participants; pairs) | 24; 72 | Sample |
| Mean bias, 95% CI (mm) | +12.2 (+11.0 to +13.3) | Systematic error; tier 1 after constant-offset correction |
| SD of differences (mm) | 5.5 | Random error (mixed model) |
| 95% limits of agreement with CIs (mm) | +1.5 (-1.4 to +3.2) to +22.9 (+20.9 to +25.6) | Tier 3, outer confidence bounds |
| Moments cross-check of the LoA (mm) | +1.1 to +23.2 | Bland and Altman (1999) method of moments |
| MAE, RMSE, MAPE (pairs) | 12.2, 13.3 mm, 1.4% | Comparison with published studies |
| MAE, RMSE, MAPE (participant means) | 12.2, 12.5 mm, 1.4% | Same, one value per person |
| Share within 10, 15, 20, 30 mm | 42%, 72%, 92%, 100% | Tier 2 |
| Absolute error p50, p75, p90 (mm) | 12.5, 15.6, 18.7 | Typical, poor and bad cases |
| ICC(2,1), 95% CI | 0.939 (0.003 to 0.988) | Reliability, absolute agreement |
| Lin's CCC, 95% CI | 0.936 (0.886 to 0.964) | Agreement penalising bias and scatter |
| Difference on mean: slope, 95% CI | +0.014 (-0.017 to +0.045) | Proportional bias |
| Tape TEM: intra (per measurer), inter, pooled (mm); %TEM; R | intra A 1.95, B 2.03; inter 1.61; pooled 2.09; 0.239%; R 0.9962 | Noise floor of the reference |
| System repeatability: s_w, 2.77 s_w (mm) | 5.6, 15.6 | Across the capture sets |
| Self-capture minus assisted (mm), 95% CI, n | +0.2 (-3.0 to +3.4), n = 24 | Capture mode difference |

### Waist

| Statistic | Value | Purpose |
|---|---|---|
| n (participants; pairs) | 24; 72 | Sample |
| Mean bias, 95% CI (mm) | -3.3 (-4.7 to -1.6) | Systematic error; tier 1 after constant-offset correction |
| SD of differences (mm) | 5.6 | Random error (mixed model) |
| 95% limits of agreement with CIs (mm) | -14.1 (-16.3 to -11.8) to +7.6 (+4.9 to +11.0) | Tier 3, outer confidence bounds |
| Moments cross-check of the LoA (mm) | -14.1 to +7.6 | Bland and Altman (1999) method of moments |
| MAE, RMSE, MAPE (pairs) | 5.0, 6.4 mm, 0.7% | Comparison with published studies |
| MAE, RMSE, MAPE (participant means) | 4.2, 4.9 mm, 0.6% | Same, one value per person |
| Share within 10, 15, 20, 30 mm | 86%, 99%, 100%, 100% | Tier 2 |
| Absolute error p50, p75, p90 (mm) | 4.2, 6.8, 11.6 | Typical, poor and bad cases |
| ICC(2,1), 95% CI | 0.989 (0.936 to 0.997) | Reliability, absolute agreement |
| Lin's CCC, 95% CI | 0.989 (0.976 to 0.995) | Agreement penalising bias and scatter |
| Difference on mean: slope, 95% CI | -0.020 (-0.080 to +0.041) | Proportional bias |
| Tape TEM: intra (per measurer), inter, pooled (mm); %TEM; R | intra A 2.29, B 1.89; inter 1.47; pooled 2.09; 0.279%; R 0.9962 | Noise floor of the reference |
| System repeatability: s_w, 2.77 s_w (mm) | 5.0, 13.7 | Across the capture sets |
| Self-capture minus assisted (mm), 95% CI, n | -1.3 (-4.0 to +1.3), n = 24 | Capture mode difference |

### Hip

| Statistic | Value | Purpose |
|---|---|---|
| n (participants; pairs) | 24; 72 | Sample |
| Mean bias, 95% CI (mm) | +0.2 (-1.2 to +1.7) | Systematic error; tier 1 after constant-offset correction |
| SD of differences (mm) | 6.1 | Random error (mixed model) |
| 95% limits of agreement with CIs (mm) | -11.8 (-14.7 to -9.6) to +12.2 (+9.7 to +15.1) | Tier 3, outer confidence bounds |
| Moments cross-check of the LoA (mm) | -11.8 to +12.2 | Bland and Altman (1999) method of moments |
| MAE, RMSE, MAPE (pairs) | 5.0, 6.1 mm, 0.5% | Comparison with published studies |
| MAE, RMSE, MAPE (participant means) | 2.9, 3.6 mm, 0.3% | Same, one value per person |
| Share within 10, 15, 20, 30 mm | 92%, 99%, 100%, 100% | Tier 2 |
| Absolute error p50, p75, p90 (mm) | 4.4, 7.6, 9.7 | Typical, poor and bad cases |
| ICC(2,1), 95% CI | 0.996 (0.990 to 0.998) | Reliability, absolute agreement |
| Lin's CCC, 95% CI | 0.995 (0.989 to 0.998) | Agreement penalising bias and scatter |
| Difference on mean: slope, 95% CI | +0.018 (-0.025 to +0.061) | Proportional bias |
| Tape TEM: intra (per measurer), inter, pooled (mm); %TEM; R | intra A 2.44, B 1.84; inter 1.79; pooled 2.29; 0.246%; R 0.9962 | Noise floor of the reference |
| System repeatability: s_w, 2.77 s_w (mm) | 6.0, 16.7 | Across the capture sets |
| Self-capture minus assisted (mm), 95% CI, n | +0.7 (-2.4 to +3.7), n = 24 | Capture mode difference |

### Sleeve

| Statistic | Value | Purpose |
|---|---|---|
| n (participants; pairs) | 24; 71 | Sample |
| Mean bias, 95% CI (mm) | +5.9 (+4.5 to +7.4) | Systematic error; tier 1 after constant-offset correction |
| SD of differences (mm) | 6.7 | Random error (mixed model) |
| 95% limits of agreement with CIs (mm) | -7.3 (-10.3 to -5.0) to +19.0 (+17.0 to +21.6) | Tier 3, outer confidence bounds |
| Moments cross-check of the LoA (mm) | -7.7 to +19.4 | Bland and Altman (1999) method of moments |
| MAE, RMSE, MAPE (pairs) | 7.3, 8.9 mm, 1.2% | Comparison with published studies |
| MAE, RMSE, MAPE (participant means) | 5.9, 6.9 mm, 1.0% | Same, one value per person |
| Share within 10, 15, 20, 30 mm | 76%, 89%, 100%, 100% | Tier 2 |
| Absolute error p50, p75, p90 (mm) | 7.5, 9.5, 15.2 | Typical, poor and bad cases |
| ICC(2,1), 95% CI | 0.983 (0.513 to 0.996) | Reliability, absolute agreement |
| Lin's CCC, 95% CI | 0.982 (0.963 to 0.991) | Agreement penalising bias and scatter |
| Difference on mean: slope, 95% CI | +0.013 (-0.028 to +0.055) | Proportional bias |
| Tape TEM: intra (per measurer), inter, pooled (mm); %TEM; R | intra A 2.02, B 2.08; inter 1.34; pooled 2.0; 0.332%; R 0.997 | Noise floor of the reference |
| System repeatability: s_w, 2.77 s_w (mm) | 6.9, 19.1 | Across the capture sets |
| Self-capture minus assisted (mm), 95% CI, n | -2.4 (-5.9 to +1.2), n = 24 | Capture mode difference |

### Outside leg

| Statistic | Value | Purpose |
|---|---|---|
| n (participants; pairs) | 24; 72 | Sample |
| Mean bias, 95% CI (mm) | +0.3 (-1.3 to +1.7) | Systematic error; tier 1 after constant-offset correction |
| SD of differences (mm) | 6.2 | Random error (mixed model) |
| 95% limits of agreement with CIs (mm) | -11.9 (-14.9 to -9.1) to +12.5 (+10.2 to +15.0) | Tier 3, outer confidence bounds |
| Moments cross-check of the LoA (mm) | -11.9 to +12.5 | Bland and Altman (1999) method of moments |
| MAE, RMSE, MAPE (pairs) | 4.9, 6.2 mm, 0.5% | Comparison with published studies |
| MAE, RMSE, MAPE (participant means) | 2.7, 3.9 mm, 0.3% | Same, one value per person |
| Share within 10, 15, 20, 30 mm | 89%, 97%, 100%, 100% | Tier 2 |
| Absolute error p50, p75, p90 (mm) | 4.0, 6.6, 10.2 | Typical, poor and bad cases |
| ICC(2,1), 95% CI | 0.997 (0.994 to 0.999) | Reliability, absolute agreement |
| Lin's CCC, 95% CI | 0.997 (0.993 to 0.999) | Agreement penalising bias and scatter |
| Difference on mean: slope, 95% CI | +0.001 (-0.032 to +0.034) | Proportional bias |
| Tape TEM: intra (per measurer), inter, pooled (mm); %TEM; R | intra A 2.23, B 1.76; inter 1.25; pooled 1.93; 0.185%; R 0.9985 | Noise floor of the reference |
| System repeatability: s_w, 2.77 s_w (mm) | 5.9, 16.4 | Across the capture sets |
| Self-capture minus assisted (mm), 95% CI, n | +0.9 (-2.5 to +4.2), n = 24 | Capture mode difference |

### Inside leg

| Statistic | Value | Purpose |
|---|---|---|
| n (participants; pairs) | 24; 71 | Sample |
| Mean bias, 95% CI (mm) | +0.7 (-0.7 to +2.2) | Systematic error; tier 1 after constant-offset correction |
| SD of differences (mm) | 6.1 | Random error (mixed model) |
| 95% limits of agreement with CIs (mm) | -11.2 (-13.6 to -8.7) to +12.6 (+9.8 to +15.2) | Tier 3, outer confidence bounds |
| Moments cross-check of the LoA (mm) | -11.2 to +12.6 | Bland and Altman (1999) method of moments |
| MAE, RMSE, MAPE (pairs) | 4.7, 6.1 mm, 0.6% | Comparison with published studies |
| MAE, RMSE, MAPE (participant means) | 3.1, 3.9 mm, 0.4% | Same, one value per person |
| Share within 10, 15, 20, 30 mm | 89%, 99%, 100%, 100% | Tier 2 |
| Absolute error p50, p75, p90 (mm) | 3.8, 6.9, 10.2 | Typical, poor and bad cases |
| ICC(2,1), 95% CI | 0.995 (0.989 to 0.998) | Reliability, absolute agreement |
| Lin's CCC, 95% CI | 0.995 (0.988 to 0.998) | Agreement penalising bias and scatter |
| Difference on mean: slope, 95% CI | +0.022 (-0.018 to +0.061) | Proportional bias |
| Tape TEM: intra (per measurer), inter, pooled (mm); %TEM; R | intra A 1.66, B 2.06; inter 1.58; pooled 2.0; 0.251%; R 0.9973 | Noise floor of the reference |
| System repeatability: s_w, 2.77 s_w (mm) | 5.7, 15.9 | Across the capture sets |
| Self-capture minus assisted (mm), 95% CI, n | -2.5 (-5.1 to +0.1), n = 24 | Capture mode difference |

### Neck

| Statistic | Value | Purpose |
|---|---|---|
| n (participants; pairs) | 24; 68 | Sample |
| Mean bias, 95% CI (mm) | +0.1 (-1.5 to +1.6) | Systematic error; tier 1 after constant-offset correction |
| SD of differences (mm) | 6.2 | Random error (mixed model) |
| 95% limits of agreement with CIs (mm) | -12.1 (-14.9 to -9.3) to +12.1 (+9.6 to +14.4) | Tier 3, outer confidence bounds |
| Moments cross-check of the LoA (mm) | -12.2 to +12.1 | Bland and Altman (1999) method of moments |
| MAE, RMSE, MAPE (pairs) | 5.0, 6.1 mm, 1.4% | Comparison with published studies |
| MAE, RMSE, MAPE (participant means) | 3.2, 3.9 mm, 0.9% | Same, one value per person |
| Share within 10, 15, 20, 30 mm | 90%, 100%, 100%, 100% | Tier 2 |
| Absolute error p50, p75, p90 (mm) | 4.4, 7.5, 9.7 | Typical, poor and bad cases |
| ICC(2,1), 95% CI | 0.959 (0.908 to 0.982) | Reliability, absolute agreement |
| Lin's CCC, 95% CI | 0.958 (0.905 to 0.981) | Agreement penalising bias and scatter |
| Difference on mean: slope, 95% CI | +0.050 (-0.071 to +0.170) | Proportional bias |
| Tape TEM: intra (per measurer), inter, pooled (mm); %TEM; R | intra A 1.89, B 2.25; inter 1.08; pooled 1.91; 0.526%; R 0.9803 | Noise floor of the reference |
| System repeatability: s_w, 2.77 s_w (mm) | 5.9, 16.3 | Across the capture sets |
| Self-capture minus assisted (mm), 95% CI, n | +4.0 (+1.1 to +6.9), n = 21 | Capture mode difference |

## Exploratory analyses

Labelled exploratory: subgroups are small and nothing here was used for acceptance.

### Strata

See `tables/strata.csv`: bias with a cluster-bootstrap interval and moments limits of agreement by sex, BMI class, clothing fit, lighting, camera facing, phone model and capture mode, for every level with at least three participants.

### Error decomposition (girths)

| Site | n pairs | MAE before | Scale term: mean abs change, share | Level term | Oracle factor | Cross-section term: mean abs change, share | Remainder RMSE, share |
|---|---|---|---|---|---|---|---|
| Chest | 72 | 12.17 | 2.61, -0.027 | not estimated: needs capture profiles, not in the CSV export | 0.9862 | 12.28, 0.85 | 5.61, 0.177 |
| Waist | 72 | 4.99 | 2.21, -0.349 | not estimated: needs capture profiles, not in the CSV export | 1.0043 | 3.19, 0.25 | 6.7, 1.099 |
| Hip | 72 | 5.02 | 2.75, -0.232 | not estimated: needs capture profiles, not in the CSV export | 0.9997 | 0.32, 0.003 | 6.75, 1.229 |
| Neck | 68 | 4.95 | 1.07, -0.091 | not estimated: needs capture profiles, not in the CSV export | 0.9997 | 0.09, 0.0 | 6.41, 1.09 |

The oracle factor was fitted on the test cohort itself and is diagnostic only; it was never used for acceptance. The level term needs the capture profiles, which the CSV export does not carry. Shares are of the squared error before any substitution and sum to one; a share below zero or above one means that substitution added error.

### Lighting

- Stature: 72 sets with lux; no lux level with more failures; lowess curve in `tables/lighting.json`.
- Shoulder width: 72 sets with lux; no lux level with more failures; lowess curve in `tables/lighting.json`.
- Chest: 72 sets with lux; no lux level with more failures; lowess curve in `tables/lighting.json`.
- Waist: 72 sets with lux; no lux level with more failures; lowess curve in `tables/lighting.json`.
- Hip: 72 sets with lux; no lux level with more failures; lowess curve in `tables/lighting.json`.
- Sleeve: 71 sets with lux; no lux level with more failures; lowess curve in `tables/lighting.json`.
- Outside leg: 72 sets with lux; no lux level with more failures; lowess curve in `tables/lighting.json`.
- Inside leg: 71 sets with lux; no lux level with more failures; lowess curve in `tables/lighting.json`.
- Neck: 68 sets with lux; flags rise below 470.0 lux; lowess curve in `tables/lighting.json`.

## Method notes

- Bias: mean of participant-mean differences (system minus tape); 95% CI by cluster bootstrap over participants.
- Limits of agreement: linear mixed model d_ij = mu + u_i + e_ij (REML), LoA = mu +/- 1.96 sqrt(sigma_u^2 + sigma_e^2); cluster-bootstrap CIs from the Bland-Altman (1999) moments estimate on each resample; the moments point estimate is printed as a cross-check.
- ICC(2,1): two-way random effects, absolute agreement, on participant means, F-based CI (McGraw and Wong, 1996).
- Lin's CCC with a Fisher-z interval. Proportional bias: OLS of difference on mean with cluster-robust SEs and t quantiles on the number of participants minus one.
- Tape reliability: intra-observer TEM sqrt(sum d^2 / 2n) per measurer, inter-observer TEM on measurer means, pooled multi-reading TEM, %TEM against the mean, R = 1 - TEM^2 / SD^2 with the SD of all readings (Ulijaszek and Kerr, 1999).
- System repeatability: within-participant SD across sets and the repeatability coefficient 2.77 s_w.
- Figures in `figures/`: Bland-Altman and scatter per site, residuals by BMI class where covariates exist, set 1 against set 3, and the calibration level curves when a fit report is given.
