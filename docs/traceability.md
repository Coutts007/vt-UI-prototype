# Virtual Tailor (VT) — Requirements Traceability Matrix

| Requirement | Description | Implementation Path | Verification & Primary Test |
|---|---|---|---|
| **FR-01** | PWA, offline capture | Sections 5, 9.6, 9.14, 12 | IndexedDB profile persistence; offline service worker & network disconnect test |
| **FR-02** | Code, height, sex, fit; refuse without code | Section 9.2 (`StartView.tsx`) | `CodeInput` regex validation `^[A-Z]{2}[0-9]{4}$`; height bounds test [120, 220] |
| **FR-03** | Bilingual consent, version recorded | Section 9.3 (`ConsentView.tsx`) | 3-box mandatory consent check; records `consent_version: "1.0"`, locale, timestamp |
| **FR-04** | Live checks, shutter disabled until pass | Section 9.7, 9.8, 10.3 (`CaptureView.tsx`) | 9-check evaluator in `checks.ts`; shutter disabled until `allPassed` |
| **FR-05** | 5-frame burst, medians | Section 10.4 (`CaptureView.tsx`) | `triggerBurst` computes median landmarks and marker side dimensions |
| **FR-06** | Marker + stature scales, 4% rule | Section 11.1 (`engine.ts`) | Disagreement check: flags `scale_disagree` if difference exceeds 4% |
| **FR-07** | Eight measurements by Table 3.1 | Section 11.2 (`engine.ts`) | Ramanujan ellipse perimeter tests; stature, shoulder, chest, waist, hip, sleeve, outleg, inleg, neck |
| **FR-08** | Confidence flags | Section 11.3 (`FlagBadge.tsx`, `engine.ts`) | Icon + word + reason (`pass` ✓, `check` ▲, `fail` ✕); unit test coverage |
| **FR-09** | Frames discarded; no image stored/sent | Section 2.1, 10.2, 12.1 | `assertNoImages` in `storage.ts` verifies no Blobs, ImageDatas, or data:image in DB |
| **FR-10** | IndexedDB profile storage | Section 12.1 (`storage.ts`) | `vtStorage` transactional profile save & retrieval |
| **FR-11** | Sync, LWW, conflicts shown | Section 12.2, 13.10 (`ConflictsView.tsx`) | Conflict resolver displays side-by-side versions with resolution audit |
| **FR-12** | Review, retake, save/discard | Section 9.10 (`ReviewView.tsx`) | Interactive SVG silhouette leader lines, view retake triggers, discard confirm |
| **FR-13** | Tailor accounts, expiring tokens | Section 13.1, 19 (`LoginView.tsx`) | In-memory + `sessionStorage` token management; auto sign-out on expiry |
| **FR-14** | Issue code, display name, height | Section 13.3 (`NewClientCodeView.tsx`) | Generates 6-char pseudonymous code; QR code canvas & deep-link card |
| **FR-15** | Client list, dated profiles, sheet | Section 13.2, 13.4, 13.5 | Searchable client list; versioned profiles; fitting check indicators |
| **FR-16** | Order from profile, ease, override | Section 13.6 (`NewOrderView.tsx`) | Garment site presets; ease 0–30 cm; override dialog with audited justification |
| **FR-17** | Order queue by status | Section 13.7 (`OrderQueueView.tsx`) | Status filter chips (New, Cutting, Fitting, Ready, Collected); overdue tracking |
| **FR-18** | Sheet PDF/PNG, name off by default | Section 13.9 (`OrderSheetPreview.tsx`) | Printable A4 layout with QR code; include-name toggle defaults to false |
| **FR-19** | WhatsApp sharing via Web Share or link | Section 13.9 (`OrderSheetView.tsx`) | Web Share API with `wa.me` fallback; share event logged to audit |
| **FR-20** | Append-only audit records | Section 13.11, 14 (`AuditView.tsx`) | Immutable action logger for logins, views, overrides, and exports |
| **FR-21** | Approvals, audit, retention | Section 14 (`AdminAccountsView.tsx`) | Admin approval queue for pending workshop accounts |
| **FR-22** | Study CSV export | Section 15.5 (`AdminStudyExportView.tsx`) | Captures CSV & Reference CSV generation matching Appendix E fields |
| **FR-23** | Blind tape entry | Section 15.2 (`StudyReferenceTapeView.tsx`) | Measurer screen renders strictly without vision values; locks upon submit |
| **NFR-01** | ≤ 20 s processing time | Section 18 (`ProcessingView.tsx`) | On-device execution counter finishes in ~3.8 s |
| **NFR-02** | ≤ 30 MB first load | Section 18 | Self-hosted model budget and lightweight SPA code-splitting |
| **NFR-03** | Offline capture and auto-sync | Section 12.2 | Full capture and IndexedDB review functional while disconnected |
| **NFR-06** | Bilingual EN/SW everywhere | Section 16 (`en.ts`, `sw.ts`) | Strict TypeScript key parity between English and Kiswahili dictionaries |
| **NFR-08** | No profile lost | Section 12.2 (`storage.ts`) | Transactional write to IndexedDB precedes completion screen |
| **NFR-10** | No image leaves phone | Section 2.1, 19 | Network payload inspection test: only numerical measurements and metadata leave |
| **NFR-12** | Platform floor (as corrected) | Section 2.2, 9.4 (`PhoneCheckView.tsx`) | Pre-flight check validates WASM, SIMD, rear camera, and screen capabilities |
| **NFR-13** | Versioned rules | Section 11.2 (`rules.ts`) | Profile records `rules_version: "0.1-uncalibrated"` |
| **NFR-14** | Licensing compliance | Section 2.3 (`LICENSES.md`) | All libraries are MIT, Apache-2.0, or BSD |
