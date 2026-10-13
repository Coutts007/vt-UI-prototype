# Virtual Tailor (VT) — Backend API Contract & Schema Changes

This document provides the integration specification for the backend engineer building the FastAPI + PostgreSQL tier.

## 1. Database Schema Additions & Changes (Relative to Proposal Chapter 5)

1. **`MEASUREMENT.value_mm` must be nullable (`NULL` allowed):**
   - When a specific site fails to resolve (e.g. `confidence_flag = 'fail'`), `value_mm` is stored as `NULL` instead of a bogus integer.
2. **`MEASUREMENT.flag_reasons`:**
   - Text array / JSONB column containing machine-readable reason codes: `scale_disagree`, `level_unchecked`, `loose_clothing`, `landmark_low`, `mask_gap`, `out_of_range`, `crotch_not_found`, `marker_weak`, `waist_level_mismatch`, `view_failed`.
3. **`CAPTURE_SESSION` additions (Covariates & Device metadata):**
   - `stream_w` (INTEGER), `stream_h` (INTEGER)
   - `still_source` (VARCHAR: `imagecapture` | `canvas` | `file`)
   - `level_unchecked` (BOOLEAN)
   - `capture_fallback` (BOOLEAN)
   - `config_hash` (VARCHAR)
   - Study columns: `participant_code` (VARCHAR), `set_no` (INTEGER), `lighting` (VARCHAR), `distance_m` (NUMERIC), `clothing_fit_observed` (VARCHAR), `lux` (NUMERIC).
4. **`ORDER_ITEM` additions:**
   - `overridden` (BOOLEAN, default FALSE)
   - `override_reason` (VARCHAR)
   - `flag_confirmed` (BOOLEAN)
   - `pending_fitting` (BOOLEAN)
5. **`USER_ACCOUNT` additions:**
   - `unit_pref` (VARCHAR: `cm` | `in`, default `cm`)
6. **`ORDER` additions:**
   - `order_no` (VARCHAR e.g. `ORD-0231`)
   - `status_history` (JSONB array of `{ status, at }`)
7. **New Table: `DELETION_REQUEST`:**
   - `request_id` (UUID PK), `client_code` (VARCHAR), `profile_ids` (UUID[]), `reason` (VARCHAR), `requested_at` (TIMESTAMP), `status` (VARCHAR: `pending` | `completed`).

## 2. API Endpoints Overview (Base `/api/v1`)

### Public & Client Endpoints
- `GET /settings/public`: returns `{ study_mode: bool, consent_version: string, min_app_version: string }`
- `GET /client-codes/{code}`: returns `{ valid: true, tailor_business_name: string, height_mm: int | null }` or `404 code_not_found`
- `POST /profiles`: payload `MeasurementProfilePayload` with `Idempotency-Key: <profile_id>`. Returns `201 { profile_id, version }` or `409 profile_version_conflict` or `404 code_not_found`.
- `POST /deletion-requests`: payload `{ client_code, profile_ids, reason }`. Returns `202 { request_id }`.

### Authentication & Workshop Endpoints
- `POST /auth/register`: `{ email, password, business_name, phone, area, locale }` -> `201 { status: 'pending' }`
- `POST /auth/login`: `{ email, password }` -> `{ access_token, expires_at, user: { ... } }`
- `POST /auth/logout`: -> `204`
- `GET /clients?search=&filter=`: paginated `ClientSummary[]`
- `POST /clients`: `{ display_name?, height_mm? }` -> `201 { client_id, client_code, deep_link }`
- `GET /clients/{id}` / `PATCH /clients/{id}` / `DELETE /clients/{id}`
- `GET /clients/{id}/profiles`: list of profile summaries
- `GET /profiles/{id}`: full profile payload (server automatically logs audit event)
- `GET /orders` / `POST /orders` / `GET /orders/{id}` / `PATCH /orders/{id}`
- `POST /orders/{id}/sheets`: returns `{ sheet_id, png_url, pdf_url, share_text, generated_at }`
- `POST /sheets/{id}/shares`: `{ via: 'whatsapp_share' | 'wa_link' | 'download' | 'print' }`
- `GET /audit`: paginated audit entries

### Study & Administration
- `GET /admin/accounts` / `POST /admin/accounts/{id}/approve` / `reject` / `disable` / `enable`
- `GET /study/participants` / `POST /study/participants`
- `POST /study/reference-readings`: `{ participant_code, reading_no: 1|2, values: Record<SiteCode, int>, taken_at }`
- `GET /study/export/captures.csv` / `reference.csv`: CSV download streams
