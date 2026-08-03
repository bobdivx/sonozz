export const STEPS = [
  { id: 1, key: "trends", label: "Tendances", short: "Marché" },
  { id: 2, key: "artist", label: "Artiste", short: "Profil" },
  { id: 3, key: "lyrics", label: "Paroles", short: "Texte" },
  { id: 4, key: "tracks", label: "Morceaux", short: "Audio" },
  { id: 5, key: "covers", label: "Jaquettes", short: "Visuel" },
  { id: 6, key: "distrokid", label: "ONCE", short: "Release" },
  { id: 7, key: "clip", label: "Clips", short: "Vidéo" },
  { id: 8, key: "social", label: "Réseaux", short: "Pub" },
];

/** Styles musicaux proposés à la création d'artiste (valeur = hint IA). */
export const MUSIC_STYLES = [
  { value: "", label: "Au choix de l'IA" },
  { value: "Pop contemporaine", label: "Pop" },
  { value: "Rap / Drill francophone", label: "Rap / Drill" },
  { value: "R&B / Soul moderne", label: "R&B / Soul" },
  { value: "Électro / Hyperpop", label: "Électro" },
  { value: "Afrobeats / Afro-pop", label: "Afro" },
  { value: "Indie / Alternative", label: "Indie" },
  { value: "Variété / Chanson", label: "Chanson" },
  { value: "Latin / Reggaeton", label: "Latin" },
  { value: "Rock / Indie rock", label: "Rock" },
];

/** Normalise genres (tableau ou string legacy) → string[]. */
export function parseGenres(genreOrGenres) {
  if (Array.isArray(genreOrGenres)) {
    return genreOrGenres.map((g) => String(g || "").trim()).filter(Boolean);
  }
  const raw = String(genreOrGenres || "").trim();
  if (!raw) return [];
  return raw
    .split(/\s*[×xX|/]\s*|\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Affiche / prompt IA : "Rap × Électro". */
export function formatGenres(genreOrGenres) {
  return parseGenres(genreOrGenres).join(" × ");
}
/** Langues des paroles / release. */
export const MUSIC_LANGUAGES = [
  { code: "fr", label: "Français", prompt: "français" },
  { code: "en", label: "Anglais", prompt: "anglais (English)" },
  { code: "es", label: "Espagnol", prompt: "espagnol" },
  { code: "pt", label: "Portugais", prompt: "portugais" },
  { code: "it", label: "Italien", prompt: "italien" },
  { code: "de", label: "Allemand", prompt: "allemand" },
  { code: "ar", label: "Arabe", prompt: "arabe" },
];

export function languageLabel(code) {
  return MUSIC_LANGUAGES.find((l) => l.code === code)?.label || code || "Français";
}

export function languagePrompt(code) {
  return MUSIC_LANGUAGES.find((l) => l.code === code)?.prompt || "français";
}

export const emptyProject = () => ({
  trends: null,
  artist: null,
  lyrics: null,
  track: null,
  cover: null,
  distrokid: null,
  social: null,
  clip: null,
  clips: [],
  activeClipId: null,
});
