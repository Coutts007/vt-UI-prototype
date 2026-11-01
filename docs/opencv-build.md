# Self-hosted vision files

The app serves these files itself, so measuring needs no third party (D37). After changing any of them, run `node scripts/vision-manifest.mjs`. A unit test fails if the manifest is out of date.

## OpenCV.js custom build

`public/opencv/opencv.js` is OpenCV 4.10.0 compiled to WebAssembly with only ArUco detection bound. It is 3903000 bytes, against about 10 MB for a stock build.

Rebuild it with:

```sh
apps/web/opencv-build/build.sh <empty work dir>
cp <work dir>/build_vt/bin/opencv.js apps/web/public/opencv/opencv.js
node scripts/vision-manifest.mjs
```

The script needs Docker and takes about 10 minutes. It checks the OpenCV source archive against a pinned SHA-256 and compiles inside the pinned toolchain image.

| Item | Value |
| --- | --- |
| Source | OpenCV 4.10.0 (checksum in `build.sh`) |
| Toolchain | `emscripten/emsdk@sha256:af45409f3199d88db4b1b03af0098532c8fb33a375ac257463eeb0a622870d06` (tag 3.1.74) |
| Output SHA-256 | `0629ca44ba84feb8bf75253cc99941aadd04af8e61baa69eb6e49f235693aa14` |
| Bindings | `opencv-build/opencv_js.config.py` |

`Algorithm` must stay in the binding list. `ArucoDetector` inherits from it, and without it the detector throws `UnboundTypeError` when constructed. Mat and its helpers are always bound.

`tests/unit/sheetMarker.test.ts` runs this exact file against the generated measuring sheet, so a stub or a broken build fails the unit tests.

## Pose models and WASM

| File | SHA-256 | Source |
| --- | --- | --- |
| `models/pose_landmarker_lite.task` | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` | MediaPipe model `float16/1` |
| `models/pose_landmarker_full.task` | `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` | MediaPipe model `float16/1` |
| `wasm/vision_wasm_internal.*` | see `public/vision-manifest.json` | `@mediapipe/tasks-vision` 0.10.21 (SIMD build only) |

## Licences

OpenCV, the MediaPipe runtime and the pose models are Apache-2.0. Each folder ships its own `LICENSE`, and `scripts/licences.mjs` lists them in `docs/LICENSES.md`.
