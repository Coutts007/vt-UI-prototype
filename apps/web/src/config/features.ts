// The tailor directory (D27). Production stays off until M8's client flow runs on the real API, so
// only an explicit VITE_FEATURE_DIRECTORY=true turns it on there. Dev and mock builds default to on.
const flag = import.meta.env.VITE_FEATURE_DIRECTORY;
const notProduction = import.meta.env.DEV || import.meta.env.MODE === 'mock';
export const FEATURE_DIRECTORY = flag === 'true' || (notProduction && flag !== 'false');
