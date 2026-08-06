export const STEPS = [
  { id: 1, key: "stats", label: "Stats", short: "Analytics" },
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
  { value: "Pop urbaine / Melodic", label: "Pop urbaine" },
  { value: "Rap / Drill francophone", label: "Rap / Drill" },
  { value: "Trap / Cloud rap", label: "Trap" },
  { value: "Hip-hop old school / Boom bap", label: "Boom bap" },
  { value: "R&B / Soul moderne", label: "R&B / Soul" },
  { value: "Neo-soul / Quiet storm", label: "Neo-soul" },
  { value: "Électro / Hyperpop", label: "Électro" },
  { value: "House / Dance", label: "House" },
  { value: "Techno / Underground", label: "Techno" },
  { value: "EDM / Festival", label: "EDM" },
  { value: "Afrobeats / Afro-pop", label: "Afro" },
  { value: "Amapiano / Afro-house", label: "Amapiano" },
  { value: "Indie / Alternative", label: "Indie" },
  { value: "Variété / Chanson", label: "Chanson" },
  { value: "Folk / Acoustique", label: "Folk" },
  { value: "Latin / Reggaeton", label: "Latin" },
  { value: "Dancehall / Reggae", label: "Dancehall" },
  { value: "Rock / Indie rock", label: "Rock" },
  { value: "Metal / Hard rock", label: "Metal" },
  { value: "Punk / Garage", label: "Punk" },
  { value: "Jazz / Nu-jazz", label: "Jazz" },
  { value: "Blues / Roots", label: "Blues" },
  { value: "Funk / Disco", label: "Funk" },
  { value: "Gospel / Inspirational", label: "Gospel" },
  { value: "K-pop / J-pop", label: "K-pop" },
  { value: "Lo-fi / Chill", label: "Lo-fi" },
  { value: "Synthwave / Retrowave", label: "Synthwave" },
  { value: "Country / Americana", label: "Country" },
  { value: "World / Fusion", label: "World" },
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
  album: null,
  musicArrange: null,
  cover: null,
  distrokid: null,
  social: null,
  clip: null,
  clips: [],
  activeClipId: null,
});

/** Tailles d’album proposées (lead inclus). */
export const ALBUM_SIZES = [
  { value: 5, label: "EP · 5 titres" },
  { value: 8, label: "Album · 8 titres" },
  { value: 10, label: "Album · 10 titres" },
  { value: 12, label: "Album · 12 titres" },
];

export function createAlbumId() {
  return `alb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createAlbumTrackId() {
  return `at_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
