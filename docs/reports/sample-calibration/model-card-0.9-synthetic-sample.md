# Model card: rules 0.9-synthetic-sample (draft)

Written by `vt_ml.calibrate 0.1.0` on 2026-11-03T00:00:00Z. Parent: `0.1-uncalibrated`. Checksum `sha256:dbeb5a79852caaaef9ccb9cc3ea2b5468d2f9d32f02719203c0290f7b54b8ec7`.

**Status: draft.** Only the owner freezes a rules version. A draft must not be used for test-cohort agreement (backend-spec 2.3).

## Data

- Source: SYNTHETIC cohort of 25 from vt-ml synth (seed 7), never real people.
- Calibration cohort only: 25 participants, 75 capture sets. Cohort hash `acffad87c5271a0847a65233db9504cb6950883c4148bcf1cf314af994489402`.
- Tape target: the mean of at least 4 readings per site (protocol: 2 measurers x 2 readings).
- 0 exclusions, listed in `exclusions.csv`.
- BodyM: not used. Its licence is CC BY-NC 4.0 and the product is meant to be sold (decision M13-2); the prior is the literature defaults.

## Intended use

Turning a phone capture of a fitted-clothing adult into tailor tape measurements, as a starting point the tailor confirms at the fitting.

## Out of scope

Medical or health use; children; loose clothing; people or phones unlike the calibration cohort.

## Method

Torso girths: level grid search over the anatomical band in steps of 0.01, ellipse perimeter times a factor fitted by least squares through the origin, scored by leave-one-participant-out MAE with the factor refitted in every fold. The prior level stays unless a new level is at least 2 mm better. The affine variant a*P + c is adopted only if it is at least 3 mm better and its bootstrap interval of the gain excludes zero. Widths and lengths: one constant offset each, the mean of tape minus system. Uncertainty: participant bootstrap, 2000 resamples, seed 20270301.

## Fitted girths

| Site | n | Level | Best level | Factor (95% CI) | LOO MAE mm (95% CI) | Prior LOO MAE | Affine |
|---|---|---|---|---|---|---|---|
| Chest | 25 | 0.3 | 0.3 | 1.0301 (1.0199 to 1.0326) | 0.8 (0.6351 to 8.0661) | 3.29 | not adopted (0.85 mm) |
| Waist | 25 | 0.55 | 0.55 | 0.9801 (0.9796 to 0.9968) | 0.81 (0.5812 to 2.6858) | 3.75 | not adopted (0.81 mm) |
| Hip | 25 | 0.25 | 0.12 | 1.0197 (1.0192 to 1.0201) | 0.79 (0.5068 to 1.2018) | 0.79 | not adopted (0.83 mm) |
| Neck | 25 | 0.15 | 0.15 | 1.0496 (1.0488 to 1.0505) | 0.71 (0.5125 to 0.9507) | 7.33 | not adopted (0.72 mm) |

## Fitted offsets

| Site | n | Offset mm (95% CI) | Prior MAE | LOO MAE |
|---|---|---|---|---|
| Shoulder width | 25 | 11.6 (11.1195 to 12.1215) | 11.61 | 1.01 |
| Sleeve | 25 | -8.0 (-8.3038 to -7.5941) | 7.95 | 0.73 |
| Outside leg | 25 | 15.0 (14.6063 to 15.4233) | 15.01 | 0.9 |
| Inside leg | 25 | -10.1 (-10.4708 to -9.6887) | 10.08 | 0.89 |

## Before and after, in sample

| Site | n | Bias before | MAE before | Bias after | MAE after |
|---|---|---|---|---|---|
| Stature | 25 | 0.04 | 0.71 | 0.04 | 0.71 |
| Shoulder width | 25 | -11.61 | 11.61 | -0.01 | 0.97 |
| Chest | 25 | -13.35 | 13.35 | 0.02 | 0.77 |
| Waist | 25 | 1.9 | 4.15 | -0.04 | 0.77 |
| Hip | 25 | -18.47 | 18.47 | 0.02 | 0.75 |
| Sleeve | 25 | 7.95 | 7.95 | -0.05 | 0.71 |
| Outside leg | 25 | -44.38 | 44.38 | -0.01 | 0.86 |
| Inside leg | 25 | 10.08 | 10.08 | -0.02 | 0.85 |
| Neck | 25 | -39.1 | 39.1 | -0.02 | 0.68 |

In-sample figures flatter the fit; the LOO columns above are the honest ones.

## Learned girth experiment (11.4)

Promotion rule not met: ellipse x factor stays. A neutral or negative result.

| Site | n | Ridge LOO MAE | Ellipse LOO MAE | Gain mm (95% CI) |
|---|---|---|---|---|
| Chest | 25 | 0.94 | 0.8 | -0.14 (-0.43 to 0.14) |
| Waist | 25 | 1.01 | 0.81 | -0.2 (-0.52 to 0.08) |
| Hip | 25 | 1.1 | 0.79 | -0.32 (-0.61 to -0.03) |
| Neck | 25 | 0.87 | 0.71 | -0.16 (-0.33 to -0.0) |

## Anomaly reference (11.5)

Built from 25 complete calibration profiles. Genuine profiles flagged: 0.04 (target 0.05 or less; in-sample, so optimistic). Corrupted profiles caught: scale x1.1 1.0, waist level swapped 0.84, waist +50 mm 0.04.

## Known limitations

- Population: the calibration cohort only; nothing here generalises beyond it.
- BMI range, clothing, phones and camera facing: as recorded for the cohort; not yet summarised here.
- A cohort of about 25 is a small sample. Treat every interval as wide and every level as provisional.
- Acceptance status (backend-spec 12): not known until the test cohort is analysed under a frozen version.

## Licences

Fitted with numpy, scipy and scikit-learn (BSD-3-Clause). No dataset outside the study was used.
