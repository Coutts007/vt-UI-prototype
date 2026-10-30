# Virtual Tailor (VT) — Architectural Decisions

This document records the foundational decisions agreed upon for the client-side implementation of Virtual Tailor (VT).

## 1. Study Image Export (C5)
- **Decision:** Build UI and encryption behind `VITE_FEATURE_STUDY_IMAGES=false`, disabled by default.
- **Rationale:** Strict adherence to Kenya Data Protection Act 2019 privacy invariants. Images never leave the device unless explicitly activated for approved ethical research protocol (MKU IERC).

## 2. Offline Code Check
- **Decision:** Accept client codes matching `^[A-Z]{2}[0-9]{4}$` while offline, mark profile as `unverified`, verify at first sync.
- **Rationale:** Uninterrupted offline capture in remote or connectivity-constrained Kenyan locations. If the code is rejected upon sync, a plain language explanation guides the client to contact their fundi.

## 3. Client Deletion Requests
- **Decision:** Devices authenticate deletion requests by demonstrating possession of the local profile IDs (unguessable UUIDv4).
- **Rationale:** Clients have no password-based accounts; unguessable token/UUID possession is proof of ownership. Data is wiped locally immediately and queued for server-side purge.

## 4. Auth Token Transport
- **Decision:** `Authorization: Bearer <token>` in-memory with session mirroring in `sessionStorage` (purged upon tab close).
- **Rationale:** Protects against persistent local storage leaks while allowing tab refresh during workshop management.

## 5. Garment-to-Site Mapping
- **Decision:** Follow standard bespoke tailoring requirements:
  - **Shirt:** shoulder, chest, waist, sleeve, neck
  - **Dress:** shoulder, chest (bust), waist, hip, sleeve
  - **Trousers:** waist, hip, outleg, inleg
  - **Suit jacket:** shoulder, chest, waist, hip, sleeve, neck
  - **Skirt:** waist, hip, outleg
  - **Other / Full Body:** all eight sites
- **Rationale:** Matches Fundi workshop cutting patterns with option to toggle "Show all measurements".

## 6. Display Unit Preference
- **Decision:** Centimetres (cm) by default with a per-tailor toggle for Inches (in).
- **Rationale:** Kenyan fundis frequently use inches for tailoring patterns. All wire and database storage remains strictly integer millimetres (mm) for zero rounding loss.

## 7. Hosting & Base URL
- **Decision:** Single origin SPA with configurable `VITE_API_BASE_URL` pointing to `/api/v1`.
- **Rationale:** Simplifies CORS and reverse-proxy deployment with FastAPI / Cloud Run.

## 8. ArUco Marker Specification
- **Decision:** ArUco `DICT_4X4_50`, id 0, printed at exactly 150 mm × 150 mm, centred on A4 with a 10 cm calibration line and bank card (85.6 × 54.0 mm) outline for print scale check.
- **Rationale:** Ensures millimeter-accurate spatial scale recovery at 2.0–2.5 m distance.

## 9. Neck Girth
- **Decision:** Included and flagged with Ramanujan ellipse calculation.
- **Rationale:** Essential for collared shirts and jackets; flagged with caution if boundary contrast is low.

## 10. Kiswahili Copy & Parity
- **Decision:** Complete initial bilingual dictionary created (`en.ts` and `sw.ts`) with identical keys enforced by TypeScript.
- **Rationale:** Instant switching between English and Kiswahili across all user-facing screens for accessibility in Nairobi and peri-urban workshops.
