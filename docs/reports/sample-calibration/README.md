# Sample calibration output (synthetic)

Everything in this folder was fitted on a **synthetic cohort of 25 bodies with known answers**, made by `vt-ml synth --n 25 --seed 7`. No real person's data is here, and nothing in it is a finding about people. It exists so the owner can read a model card and a report folder in the shape the real calibration will produce (backend-spec 11.3.5 and 11.7), and ask for changes before real data arrives.

The known truth was: chest level 0.30, waist 0.55, hip band 0.20, neck 0.15; factors chest 1.03, waist 0.98, hip 1.02, neck 1.05; offsets shoulder +12, sleeve −8, outside leg +15, inside leg −10 mm; tape noise 2 mm. Compare those with the fitted table in the card. The hip band stays at the prior because the synthetic hip is a plateau, so every band that reaches it gives the same perimeter; the rule keeps the prior when nothing is gained.

Made with:

```sh
uv run vt-ml synth --base packages/rules/rules-0.1-uncalibrated.json --out bundle.json --n 25 --seed 7
uv run vt-ml calibrate --data bundle.json --base packages/rules/rules-0.1-uncalibrated.json \
  --version 0.9-synthetic-sample --out rules-0.9-synthetic-sample.json \
  --report docs/reports/sample-calibration/report \
  --card docs/reports/sample-calibration/model-card-0.9-synthetic-sample.md \
  --created-at 2026-11-03T00:00:00Z --label "SYNTHETIC cohort of 25 from vt-ml synth (seed 7), never real people"
```

The fitted artifact itself is not kept in `packages/rules/`, so it can never be mistaken for a candidate version.
