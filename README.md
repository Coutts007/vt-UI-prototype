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

`make setup` · `dev-web` · `dev-api` · `up` · `down` · `seed` · `lint` · `typecheck` · `test` · `test-web` · `test-api` · `parity` · `contract` · `e2e` · `licences` · `build`

`seed`, `parity` and `contract` are placeholders until M4, M2 and M1.

## Configuration

Copy `.env.example` to `.env` for local settings. Never commit `.env`.
