/** @type {Map<string, Promise<void>>} */
export const inflight = new Map();
export const memVideo = new Map();
export const EXTEND_COUNT = 1;
export const VEO_MAX_POLLS = 60;
export const SEEDANCE_MAX_POLLS = 90;
export const WAN2GP_MAX_POLLS = 1350;
export const HTTP_BOUND_TYPES = new Set(["pipeline", "step", "publish"]);
export const albumAborts = new Map();
export const trackAborts = new Map();
let booted = false;
export function isBooted() {
  return booted;
}
export function setBooted(v) {
  booted = v;
}
