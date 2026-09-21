/** Respecte prefers-reduced-motion (checklist UI/UX Pro Max). */
export function prefersReducedMotion() {
  if (typeof window === "undefined") return true;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Courbe type « music product » — 220–320 ms ressenti premium. */
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1];
export const EASE_OUT_SOFT = [0.22, 1, 0.36, 1];
