// The tailor directory (D27). Production stays off until M8's client flow runs on the real API and
// M11's cleanup job exists, so only an explicit VITE_FEATURE_DIRECTORY=true turns it on there. Dev and
// mock builds default to on. vite.config.ts settles this at build time, so an off build drops the code.
export const FEATURE_DIRECTORY = __VT_DIRECTORY__;
