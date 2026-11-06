# Virtual Tailor

A phone measures nine tailoring sites from two views, inside the browser. Photos never leave the phone and only numbers reach the server. A tailor dashboard turns profiles into orders and WhatsApp specification sheets.

## Quick start

You need Git, Node 22, [uv](https://docs.astral.sh/uv/), Docker and Make.

```bash
make setup
make lint && make typecheck && make test && make build
```

Run the app and API while developing:

```bash
make dev-web   # http://localhost:5173
make dev-api   # http://localhost:8000/api/v1/health
```

### Run on a phone against the real API

Without `VITE_API_MODE=mock`, `make dev-web` proxies `/api` to `localhost:8000`. These steps run the API with its database on Docker and open the app on an Android phone over ADB. Use a separate terminal for each step.

1. Start the backend (Postgres, migrations, API on `localhost:8000`):

   ```bash
   docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.dev-api.yml up -d --build --wait db migrate api
   curl localhost:8000/api/v1/health   # {"status":"ok"}
   ```

   If the tailor directory is empty, load the demo data:

   ```bash
   docker compose -f deploy/docker-compose.yml exec api .venv/bin/vt seed demo
   ```

   The directory also needs `DIRECTORY_ENABLED=true` in `deploy/.env`.

2. Start the web app (Ctrl+C stops it). Choose one:

   ```bash
   make phone-web   # real body detection: production build on http://localhost:5174
   make dev-web     # simulated vision on http://localhost:5173 (screens only, no real measuring)
   ```

   `make dev-web` cannot run the real MediaPipe and OpenCV workers, so its capture uses simulated vision and completes by itself whether or not anyone stands in front of the camera. Measure with `make phone-web`. Run it again after a code change, since it serves a build.

3. Connect the phone with USB debugging or wireless debugging, then forward the port:

   ```bash
   adb devices                     # the phone shows as "device"
   adb reverse tcp:5174 tcp:5174   # make phone-web (use 5173 for make dev-web)
   ```

   Open `http://localhost:5174/` (or `:5173`) in Chrome on the phone. Use `localhost`, not the laptop's network address: Chrome only allows the camera on `localhost` or HTTPS. Run `adb reverse` again after the phone reconnects.

4. Stop everything: Ctrl+C in the `make dev-web` terminal, then:

   ```bash
   docker compose -f deploy/docker-compose.yml down
   ```

Run the whole stack (Postgres, API, Caddy):

```bash
make up
curl -k https://vt.localhost/api/v1/health
make down
```

If ports 80 or 443 are taken, choose others:

```bash
VT_HTTP_PORT=8080 VT_HTTPS_PORT=8443 make up
curl -k https://vt.localhost:8443/api/v1/health
```

## Commands

| Target                                                   | What it does                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `make setup`                                             | Installs Node and Python dependencies and the git hooks                                             |
| `make dev-web`, `make dev-api`, `make phone-web`         | The web app on 5173 (proxies `/api` to 8000; mock with `VITE_API_MODE=mock`) and the API on 8000    |
| `make up`, `make down`, `make seed`                      | The whole stack on Docker Compose with the demo seed                                                |
| `make lint`, `make typecheck`, `make test`               | Checks; `test-web` and `test-api` run one side                                                      |
| `make parity`                                            | Regenerates the parity fixtures from `vt_measure` and runs them in Python and TypeScript            |
| `make contract`                                          | Validates `packages/contracts/openapi.yaml`, regenerates the types and the seed, fails on drift     |
| `make e2e`, `make e2e-real-api`, `make stack-check`      | Playwright on the mock, on the real API through Caddy, and on the production build with rate limits |
| `make fuzz`, `make load`                                 | Schemathesis on every endpoint; the Locust load test on a 2 vCPU limit                              |
| `make licences`, `make build`, `node scripts/budget.mjs` | Licence gate, production web build, bundle budgets                                                  |
| `make lighthouse`                                        | Lighthouse CI on the built app (accessibility, time to interactive, weight)                         |
| `make study-*`                                           | The study laptop profile (`docs/study-site.md`)                                                     |
| `make prod-*`                                            | The production VM profile (`docs/runbook.md`)                                                       |

## Configuration

Copy `.env.example` to `.env` for local settings. Never commit `.env`. Every setting is documented there; the important ones:

| Variable                                                                                    | Meaning                                                                                                                                             |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENV`                                                                                       | `development`, `staging` or `production`. Production refuses default secrets, the demo seed and `RATE_LIMITS_OFF`, and keeps the approvals guard on |
| `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `RETENTION_DATABASE_URL`                          | The API connects as `vt_app`, migrations as the owner, the nightly job as `vt_retention`                                                            |
| `JWT_SECRET`, `IP_PEPPER`, `SIGNED_URL_SECRET`                                              | Tokens, address hashing, sheet links. At least 32 characters in production                                                                          |
| `VT_APP_DB_PASSWORD`, `VT_RETENTION_DB_PASSWORD`, `POSTGRES_PASSWORD`                       | Role passwords, set by the migration                                                                                                                |
| `TRUSTED_PROXIES`                                                                           | Networks whose `X-Forwarded-For` is believed (Caddy's)                                                                                              |
| `DIRECTORY_ENABLED`, `DIRECTORY_CODES_*`                                                    | The tailor directory and its daily code limits                                                                                                      |
| `VITE_API_MODE`, `VITE_API_BASE_URL`                                                        | `mock` or `http`; the API prefix                                                                                                                    |
| `VITE_FEATURE_FRONT_CAMERA`, `VITE_FEATURE_TORCH_CUE`, `VITE_FEATURE_DIRECTORY`             | Flags, off in production builds                                                                                                                     |
| `VT_SITE_ADDRESS`, `VT_ACME_EMAIL`, `VT_DATA_DIR`, `BACKUP_AGE_RECIPIENT`, `VT_API_WORKERS` | Production only, in `deploy/prod.env`                                                                                                               |

## Deploy

- **Study site (no cloud):** `docs/study-site.md`. The whole stack on the encrypted study laptop and a local router.
- **Production VM:** `docs/runbook.md`. One VM, Docker Compose, Caddy with a public certificate, firewall, nightly `age`-encrypted backups with a restore drill, two API workers.

## Calibrate, freeze, analyse

- `docs/calibration.md`: export the calibration bundle, fit a draft with `vt-ml`, review the model card, register and freeze through the admin API (only the owner freezes), bundle the frozen file.
- `docs/analysis.md`: `vt-analysis` on the test-cohort export under the frozen rules; deterministic tables, plots and `results.md`.
- `docs/handover.md`: what is ready, what waits for study data, and the calibration-day commands.

## Documents

`docs/api-contract.md`, `docs/architecture.md` (private), `docs/data-inventory.md`, `docs/dpia-technical-annex.md`, `docs/retention-schedule.md`, `docs/incident-response.md`, `docs/integration-report.md`, `docs/LICENSES.md`, `docs/PROGRESS.md`, `docs/reports/` (synthetic samples and model cards).
