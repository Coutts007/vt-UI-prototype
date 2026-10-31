# Progress log

The newest entry comes first. Every change or improvement adds a line in the same commit.

## 2026-10-31: M2 Python measurement core

- Added `vt_measure`, which turns profile numbers into nine measurements and flags. It handles the one-handed sheet pose (A14), using the free arm for the sleeve, and warns when that arm is unknown.
- Added a synthetic body with known answers. The code recovers each known value to within 0.1 mm.
- Added 68 parity cases in `packages/parity-fixtures`, for the TypeScript version to match later. `make parity` now runs the Python half, and the CI parity job runs it with a 95% coverage limit.
- After an independent review: added two-view test cases worked out by hand, because the first tests could not tell the front and side views apart. Removed calculations that differ between Python and JavaScript, and made bad pose data (a hip above the shoulder) fail instead of giving a value.
- Rebuilt the demo seed from `vt_measure`, so every stored measurement recomputes from the numbers beside it.
- Added the `free_arm_unknown` flag reason to the contract. Added `nominal_distance_mm` and `free_arm_min_distance_ratio` to the draft rules. The depth correction stays at 0.

## 2026-10-31: M1 shared contract, seed and rules

- Added the API contract: 60 endpoints in OpenAPI 3.1, with generated TypeScript types.
- Added 26 stable error codes, including `approvals_missing`.
- Added the rules schema and the `0.1-uncalibrated` artifact, with a checksum. It is a draft built from literature values, and nothing is frozen.
- Added a deterministic seed with synthetic accounts, 11 clients, 12 profiles, 10 orders, 40 audit rows and 5 study participants.
- Added tests for the contract, rules and seed. Tests confirm that no upload is possible and that the seed matches the contract.
- `make contract` now validates, regenerates and fails if the generated files drifted from what is committed. The CI contract job now runs it.
- Added `docs/api-contract.md`, a plain-language guide to every endpoint.
- After an independent review: conflict replies now always carry `server_version` and `conflict_id`, and rate-limit replies carry `Retry-After`.
- Bounded every string in the contract, plus every number and list a phone sends, and limited free-form fields in rules files, to close routes for hidden content.
- Corrected the seed: audit retention is 24 months, order numbers restart per tailor, and the conflict pair follows the ingest rule.

## 2026-10-31: M0 monorepo foundation

- Moved the prototype to `apps/web` and added the API and Python package skeletons.
- Added the Makefile, CI, Docker Compose stack and licence check.
- Kept planning documents out of the public repository.
