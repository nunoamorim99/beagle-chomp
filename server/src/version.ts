// OWNER: backend
//
// The API's build version, reported by GET /health.
//
// Used by the client-side version handshake: an installed PWA can be running a
// service-worker-precached shell that is older than the deployed API, so the
// client compares this value against its own build version and prompts a reload
// on mismatch rather than failing in confusing ways.
//
// Bump this when shipping a change the client must not talk to with a stale
// shell (an API contract change), not on every deploy.
export const APP_VERSION = "0.1.0";
