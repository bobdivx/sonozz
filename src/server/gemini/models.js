/** Modèles free-tier courants (1.5 / 2.0 retirés par Google). */
export const GEMINI_TEXT_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-flash-lite-latest",
  "gemini-flash-latest",
];

/** Anciens IDs encore éventuellement en localStorage / params. */
const RETIRED_TEXT_MODELS = new Set([
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash-latest",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-lite-001",
]);

export const DEFAULT_GEMINI_TEXT_MODEL = "gemini-2.5-flash-lite";

/** Modèles image actuels (Nano Banana / Flash Image) — plus de 2.0-flash-exp. */
export const GEMINI_IMAGE_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-3.1-flash-lite-image",
];

export function resolveGeminiTextModel(preferred) {
  const p = preferred?.trim();
  if (!p || RETIRED_TEXT_MODELS.has(p)) return DEFAULT_GEMINI_TEXT_MODEL;
  return p;
}

export function modelQueue(preferred) {
  const list = [...GEMINI_TEXT_MODELS];
  const p = resolveGeminiTextModel(preferred);
  return [p, ...list.filter((m) => m !== p)];
}
