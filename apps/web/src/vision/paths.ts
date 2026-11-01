// Where the self-hosted vision files live. Same origin only (golden rule 3).
export const MODEL_URLS = {
  lite: '/models/pose_landmarker_lite.task',
  full: '/models/pose_landmarker_full.task',
} as const;
export const WASM_LOADER_URL = '/wasm/vision_wasm_internal.js';
export const WASM_BINARY_URL = '/wasm/vision_wasm_internal.wasm';
export const OPENCV_URL = '/opencv/opencv.js';
export const MANIFEST_URL = '/vision-manifest.json';
