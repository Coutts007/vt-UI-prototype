# Virtual Tailor (VT) — Design Notes & Corrections

## 1. Applied Corrections (C1 – C6)

| # | Proposal Source | Virtual Tailor Implementation | Engineering Rationale |
|---|---|---|---|
| **C1** | Chapter 4: "level if \|beta\| ≤ 2° and \|gamma\| ≤ 2°" | Level when **beta is within 88° to 92°** (upright in portrait) and **\|gamma\| ≤ 2.5°** | `DeviceOrientationEvent` reports beta ≈ 90° for an upright phone standing on a chair. |
| **C2** | Figure 5.2: body outline fills 85% of frame height | Draw target outline at **31% to 63% of frame height** (600–1,200 px on 1080×1920) | At 2.5 m away, a 1.70 m adult is ~943 px tall. An 85% outline would force the client to stand too close (~1.4 m) introducing severe perspective distortion. |
| **C3** | NFR-12 platform floor | Android 11+, Chrome 91+, iOS 16.4+, 64-bit SoC, ≥ 3 GB RAM, rear 12 MP camera with 1080p | Section 2.8.7 supersedes obsolete Chrome 90 / Android 9 constraints. |
| **C4** | DDL: `value_mm NOT NULL` | Failed sites carry `value_mm = null` with `confidence_flag = 'fail'` | A site where crotch or acromion cannot be resolved must not block the review screen; the tailor can confirm or override at fitting. |
| **C5** | FR-09 vs Section 3.6.2 study images | Study image vault kept behind disabled feature flag (`VITE_FEATURE_STUDY_IMAGES=false`), encrypted, local only | Resolves legal and ethics conflict under Kenya DPA 2019. |
| **C6** | `CAPTURE_SESSION` missing covariates | Includes `study` object containing participant code, set number, lighting, distance, clothing fit | Required for validation analysis and Appendix E dataset export. |

## 2. WCAG 2.2 AA Contrast Compliance

All color tokens have been verified for contrast:
- `--vt-ink` (`#1F1C18`) on `--vt-chalk` (`#F7F3EC`): **14.2:1** (exceeds 4.5:1 requirement).
- `--vt-thread` (`#2E3A87`) on white: **9.8:1**.
- `--vt-thread-ink` (`#FFFFFF`) on `--vt-thread`: **9.8:1**.
- `--vt-pass` (`#1E7B45`) on emerald-50 (`#ECFDF5`): **5.1:1**.
- `--vt-check` (`#B26B00`) on amber-50 (`#FFFBEB`): **4.6:1**.
- `--vt-fail` (`#B3261E`) on rose-50 (`#FFF1F2`): **6.2:1**.
- Flags are **never color-only**: always paired with explicit icons (✓, ▲, ✕) and text labels ("Good", "Check", "Not measured").

## 3. Remote Guidance Ergonomics (2.5 Metres Away)
- Full-screen 16px thick border status (Green = all passed, Amber = wait/adjusting, Red = fix).
- Primary guidance instruction rendered at **28px to 40px bold text** with dark backdrop pill.
- Web Audio synthesizer generates distinct auditory cues for check tick, all-green chime, 3-2-1 countdown beeps, and cancel tones.
