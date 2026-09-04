/** Langues des paroles / release. */
export const MUSIC_LANGUAGES = [
  { code: "en", label: "Anglais", prompt: "anglais (English)" },
  { code: "fr", label: "Français", prompt: "français" },
  { code: "es", label: "Espagnol", prompt: "espagnol" },
  { code: "zh", label: "Chinois", prompt: "chinois (mandarin)" },
  { code: "ja", label: "Japonais", prompt: "japonais" },
  { code: "pt", label: "Portugais", prompt: "portugais" },
  { code: "it", label: "Italien", prompt: "italien" },
  { code: "de", label: "Allemand", prompt: "allemand" },
  { code: "ar", label: "Arabe", prompt: "arabe" },
];

/**
 * Langues chantées nativement par SongGeneration (LeVo), selon le checkpoint.
 * Large = zh+en. v2 = zh, en, es, ja (+ « etc. » non documenté pour le FR).
 */
export const SONGGEN_LANGS_BY_MODEL = {
  songgeneration_base: ["zh"],
  songgeneration_base_new: ["zh", "en"],
  songgeneration_base_full: ["zh", "en"],
  songgeneration_large: ["zh", "en"],
  songgeneration_v2_large: ["zh", "en", "es", "ja"],
  songgeneration_v2_medium: ["zh", "en", "es", "ja"],
  songgeneration_v2_fast: ["zh", "en", "es", "ja"],
};

export function songGenLanguageCodes(modelId = "") {
  const id = String(modelId || "").toLowerCase().trim();
  if (id && SONGGEN_LANGS_BY_MODEL[id]) return [...SONGGEN_LANGS_BY_MODEL[id]];
  if (id.includes("v2")) return ["zh", "en", "es", "ja"];
  if (id === "songgeneration_base") return ["zh"];
  return ["zh", "en"];
}

export function isSongGenNativeLanguage(code, songGenModel) {
  const lang = String(code || "").toLowerCase().slice(0, 2);
  return songGenLanguageCodes(songGenModel).includes(lang);
}

/**
 * Langues proposées dans l’UI.
 * SongGen : on affiche aussi FR/ES/… (chant via MiniMax si le modèle ne les chante pas).
 */
export function languagesForProvider(musicProvider, songGenModel, { minimaxFallback = true } = {}) {
  const provider = String(musicProvider || "").trim();
  if (provider !== "songgen") return MUSIC_LANGUAGES;
  if (minimaxFallback) return MUSIC_LANGUAGES;
  const allowed = new Set(songGenLanguageCodes(songGenModel));
  return MUSIC_LANGUAGES.filter((l) => allowed.has(l.code));
}

export function isLanguageOkForProvider(code, musicProvider, songGenModel) {
  const provider = String(musicProvider || "").trim();
  if (provider !== "songgen") return true;
  return isSongGenNativeLanguage(code, songGenModel);
}

/** Badge UI : moteur qui chantera vraiment cette langue. */
export function languageEngineLabel(code, musicProvider, songGenModel) {
  const provider = String(musicProvider || "").trim();
  if (provider === "acestep") return "ACE-Step";
  if (provider !== "songgen") return "";
  return isSongGenNativeLanguage(code, songGenModel) ? "SongGen" : "MiniMax";
}

export function songGenLanguageHint(modelId) {
  const id = modelId || "songgeneration_large";
  const native = songGenLanguageCodes(id)
    .map((c) => MUSIC_LANGUAGES.find((l) => l.code === c)?.label || c)
    .join(", ");
  const v2 = String(id).includes("v2");
  if (v2) {
    return `SongGen v2 chante : ${native}. Français : pas documenté — on bascule sur MiniMax.`;
  }
  return `SongGen Large chante : ${native}. Espagnol / japonais = modèle v2 (pas installé). Français et le reste : MiniMax (Réglages → Replicate).`;
}

export function languageLabel(code) {
  return MUSIC_LANGUAGES.find((l) => l.code === code)?.label || code || "Français";
}

export function languagePrompt(code) {
  return MUSIC_LANGUAGES.find((l) => l.code === code)?.prompt || "français";
}
