# Progress log

The newest entry comes first. Every change or improvement adds a line in the same commit.

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
