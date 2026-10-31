# Demo seed

`seed.json` is the only demo seed, used by the mock backend and the API. Never edit it by hand. Run `python packages/seed/generate.py` instead.

All data is synthetic. IDs are uuid5 values, so they never change between runs. The password in `demo_password` is public and only for demo accounts. The API refuses to load this seed in production.

Dates are fixed around `anchor_date`. A loader should shift every date by (today minus `anchor_date`), so exactly one order stays overdue.

Every measurement is derived by `vt_measure` from the synthetic numbers stored beside it, and a test recomputes them.
