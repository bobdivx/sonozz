export const MUSIC_PROVIDERS = ["acestep", "replicate", "songgen"];

export const STUDIO_ENABLE_KEYS = {
  acestep: "aceStepEnabled",
  songgen: "songGenEnabled",
  replicate: "replicateEnabled",
};

export function isFlagOn(value, defaultOn = true) {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return defaultOn;
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

export function isStudioEnabled(keys, id) {
  const field = STUDIO_ENABLE_KEYS[id];
  if (!field) return false;
  return isFlagOn(keys?.[field], true);
}

export function enabledStudios(keys) {
  return MUSIC_PROVIDERS.filter((id) => isStudioEnabled(keys, id));
}

/** Recalcule le moteur actif après un toggle on/off. */
export function keysAfterStudioToggle(keys, id, enabled) {
  const field = STUDIO_ENABLE_KEYS[id];
  const next = { ...keys, [field]: enabled ? "1" : "0" };
  const current = String(next.musicProvider || "").trim();
  const on = enabledStudios(next);
  if (enabled) {
    if (!on.includes(current)) next.musicProvider = id;
  } else if (current === id && on[0]) {
    next.musicProvider = on[0];
  }
  return next;
}
