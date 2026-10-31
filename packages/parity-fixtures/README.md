# Parity fixtures

These cases keep the Python and TypeScript measurement code in agreement. `vt_measure` generates them with `python packages/parity-fixtures/generate.py`. Never edit a case by hand.

`make parity` regenerates the cases, checks them and fails if they differ from what is committed. From M5 it also runs the TypeScript half.

## Format

Each file in `cases/` is one JSON object:

| Field | Contents |
|---|---|
| `name` | The case name, also the file name. Prefixes are `analytic-`, `edge-` and `random-` |
| `input` | The profile numbers: `covariates`, `session`, landmarks, markers and silhouettes |
| `rules` | The complete rules artifact for this case |
| `expected` | The result: `scale_front`, `scale_side`, `scale_stature`, `disagreement_pct` and `sites` |

Each entry in `expected.sites` holds `value_mm`, `raw_mm`, `flag`, `reasons`, `level_fraction`, `a_mm`, `b_mm`, `perimeter_mm` and `correction_factor`.

## Matching rule

An implementation matches when, for every site:

- `raw_mm` is within 0.5 mm. It is null for `view_failed`, `mask_gap` and `crotch_not_found`. A site that fails on `landmark_low` or `out_of_range` still reports it.
- `value_mm` agrees after rounding its own raw value, half to even.
- `flag` is identical.
- `reasons` holds the same set, in the order listed in `REASONS` in `derive.py`.

## Rules the TypeScript code must copy

Most of these exist because the two languages round or add differently.

- **Addition:** add plainly from left to right. Python's `sum()` compensates, so `derive.py` avoids it.
- **Distance:** use `sqrt(dx*dx + dy*dy)`. Don't use `Math.hypot`, which may differ in the last digit.
- **Final rounding:** round half to even. `Math.round` rounds halves up, so it can't be used here.
- **Rounding before a limit:** use `floor(value * 1e6 + 0.5) / 1e6`, not `toFixed`. This applies to marker aspect, scale disagreement and the waist and chest level tolerances. A value exactly on a limit counts as not above it.
- **Sampling:** interpolate linearly at `u * 100`, between `floor` and `ceil`. The result is undefined outside 0 to 100, or if either neighbouring sample is null.
- **Band searches:** `count = floor((high - low) / 0.01 + 0.5)`, then test `low + (high - low) * i / count` for `i` from 0 to `count`. If `count` is 0 or less, test `low` alone. The first best value wins a tie. Null samples are skipped.
- **Side view:** use the right side (12, 24, 26) unless the left (11, 23) has a strictly higher visibility total.
- **Pose limits:** a hip at or above the shoulder fails that view. A knee at or above the hip fails the hip site with `mask_gap`.
- **Plausibility:** `plausible_mm` is inclusive, and is checked before rounding.
