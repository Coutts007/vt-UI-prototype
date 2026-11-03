// The tailor directory (D27). Production stays off until M8's client flow runs on the real API and
// M11's cleanup job exists, so only an explicit VITE_FEATURE_DIRECTORY=true turns it on there. Dev and
// mock builds default to on. vite.config.ts settles this at build time, so an off build drops the code.
export const FEATURE_DIRECTORY = __VT_DIRECTORY__;
// Front-camera self-capture (A4): the client sees the screen, so guidance is visual. Off in production
// until the pilot says otherwise; dev and mock builds default to on so it can be tried.
export const FEATURE_FRONT_CAMERA = __VT_FRONT_CAMERA__;
// The torch cue experiment (A3 item 5, D25): the flash blinks at the client while they cannot see the
// screen. An experiment for the device log, off in production.
export const FEATURE_TORCH_CUE = __VT_TORCH_CUE__;
