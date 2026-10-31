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

- `raw_mm` is within 0.5 mm.
- `value_mm` agrees after rounding its own raw value, half to even.
- `flag` is identical.
- `reasons` holds the same set, in the order listed in `REASONS` in `derive.py`.

## Rules the TypeScript code must copy

- **Sampling:** interpolate linearly at `u × 100`. The result is undefined outside 0 to 100, or if either neighbouring sample is null.
- **Band searches:** test each band at steps of 0.01, using `low + (high − low) × i / count`. The first best value wins a tie. Null samples are skipped.
- **Scale disagreement:** round the percentage to 6 decimals before comparing it with a limit. A value exactly on a limit counts as not above it.
- **Limits:** `plausible_mm` and `max_corner_aspect` are inclusive. A value is checked for plausibility before rounding.
