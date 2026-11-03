# Sample validation report (synthetic)

Everything in this folder comes from **synthetic exports**: 24 synthetic bodies in a pretend test cohort, with a built-in bias of +12 mm on chest, −3 mm on waist and +4 mm on sleeve, 6 mm of set-to-set noise and 2 mm of tape noise, under a pretend frozen version `1.0-ke-test`. No real person's data is here, and no number in it says anything about people. It exists so the owner can read the tables in the layout of proposal Table 3.2 and the acceptance table of Table 1.1 and ask for changes before real data arrives (M14).

Made with the package's own generator and the CLI:

```sh
uv run python -c "
import json, pathlib
from vt_analysis.synthetic import synthetic_exports
rules = json.load(open('packages/rules/rules-0.1-uncalibrated.json'))
synthetic_exports(pathlib.Path('/tmp/vt-sample'), n=24, seed=9, rules=rules,
                  bias_mm={'chest': 12.0, 'waist': -3.0, 'sleeve': 4.0})
"
uv run vt-analysis run --captures /tmp/vt-sample/captures.csv --reference /tmp/vt-sample/reference.csv \
  --registry /tmp/vt-sample/registry.json --rules 1.0-ke-test \
  --covariates /tmp/vt-sample/paper_covariates.csv --out docs/reports/sample/report --seed 5
```

Expected reading of the sample: chest fails tier 1 (its bias is 12 mm by construction), the other sites pass or fail on the noise alone, and the exploratory sections show the shapes of the strata and decomposition tables. To keep the public repository small, `report/figures/` holds only the chest and hip figures (Bland-Altman, scatter, repeatability and residuals by BMI class, PNG and SVG); a real run writes them for every site.
