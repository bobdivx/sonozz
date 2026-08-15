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

/**
 * Mappe un genre catalogue (ex. "Alternative", "Hip-Hop") vers une entrée MUSIC_STYLES.
 * @returns {{ value: string, label: string } | null}
 */
export function matchMusicStyleFromGenre(raw) {
  const g = String(raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  if (!g) return null;

  const rules = [
    { re: /gospel|worship|inspirational/, value: "Gospel / Inspirational" },
    { re: /neo-?soul|quiet storm/, value: "Neo-soul / Quiet storm" },
    { re: /r&?b|soul/, value: "R&B / Soul moderne" },
    { re: /drill|rap|hip[\s-]?hop/, value: "Rap / Drill francophone" },
    { re: /trap|cloud/, value: "Trap / Cloud rap" },
    { re: /boom\s*bap|old\s*school/, value: "Hip-hop old school / Boom bap" },
    { re: /amapiano/, value: "Amapiano / Afro-house" },
    { re: /afro|afrobeats/, value: "Afrobeats / Afro-pop" },
    { re: /hyperpop|electro|electronic|synth/, value: "Électro / Hyperpop" },
    { re: /house|dance(?!hall)/, value: "House / Dance" },
    { re: /techno/, value: "Techno / Underground" },
    { re: /edm|festival/, value: "EDM / Festival" },
    { re: /indie|alternative|alt/, value: "Indie / Alternative" },
    { re: /folk|acoustic/, value: "Folk / Acoustique" },
    { re: /chanson|variete/, value: "Variété / Chanson" },
    { re: /reggaeton|latin|salsa/, value: "Latin / Reggaeton" },
    { re: /dancehall|reggae/, value: "Dancehall / Reggae" },
    { re: /metal/, value: "Metal / Hard rock" },
    { re: /punk|garage/, value: "Punk / Garage" },
    { re: /rock/, value: "Rock / Indie rock" },
    { re: /jazz/, value: "Jazz / Nu-jazz" },
    { re: /blues/, value: "Blues / Roots" },
    { re: /funk|disco/, value: "Funk / Disco" },
    { re: /k-?pop|j-?pop/, value: "K-pop / J-pop" },
    { re: /lo-?fi|chill/, value: "Lo-fi / Chill" },
    { re: /synthwave|retrowave/, value: "Synthwave / Retrowave" },
    { re: /country|americana/, value: "Country / Americana" },
    { re: /world|fusion/, value: "World / Fusion" },
    { re: /melodic|urbaine|urban/, value: "Pop urbaine / Melodic" },
    { re: /pop/, value: "Pop contemporaine" },
  ];

  for (const { re, value } of rules) {
    if (re.test(g)) {
      const hit = MUSIC_STYLES.find((s) => s.value === value);
      return hit || { value, label: value };
    }
  }
  return null;
}

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
  lyricsVersions: [],
  activeLyricsId: null,
  track: null,
  trackVersions: [],
  activeTrackId: null,
  album: null,
  musicArrange: null,
  cover: null,
  coverVersions: [],
  activeCoverId: null,
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

/** Audio généré/importé et validé — utilisable pour Cover, ONCE, clips, catalogue. */
export function isTrackAudioFinal(track) {
  if (!track?.audioUrl) return false;
  const st = String(track.status || "");
  if (st === "pending-review" || st === "preview-ready") return false;
  if (track.isPreview) return false;
  return true;
}

/** True si le projet / release a été soumis ou livré via ONCE. */
export function isOncePublished(meta = {}) {
  if (!meta || typeof meta !== "object") return false;
  if (meta.distributed) return true;
  const status = String(meta.status || meta.onceStatus || "").toLowerCase();
  const provider = String(meta.provider || "").toLowerCase();
  const releaseId = String(meta.releaseId || "").trim();
  if (/^(submitted|live|distributed|delivered)/i.test(status)) return true;
  if (/live|distributed|delivered/i.test(status)) return true;
  if (provider === "once" && releaseId) return true;
  return false;
}

/**
 * Message de confirmation suppression projet.
 * @returns {string|null} null = l’utilisateur a annulé
 */
export function confirmDeleteProject(label, onceMeta = {}) {
  const name = label || "ce morceau";
  const once = isOncePublished(onceMeta);
  const releaseId = String(onceMeta.releaseId || "").trim();

  if (once) {
    const ok = confirm(
      `Attention — « ${name} » a déjà été publié / soumis sur ONCE` +
        (releaseId ? ` (release ${releaseId})` : "") +
        `.\n\n` +
        `Supprimer ici n’annule PAS la release ONCE ni les stores (Spotify, etc.).\n` +
        `Tu devras la gérer séparément dans le dashboard ONCE.\n\n` +
        `Continuer et effacer le projet SONOZZ ?`,
    );
    if (!ok) return false;
    return confirm(
      `Dernière confirmation : supprimer définitivement « ${name} » de SONOZZ ?\n` +
        `La release ONCE restera en ligne tant que tu ne l’as pas retirée côté ONCE.`,
    );
  }

  return confirm(
    `Supprimer définitivement « ${name} » ?\n\nLe projet (audio, paroles, album) sera effacé de Turso.`,
  );
}

const GENERIC_AUDIO_STEMS =
  /^(stream|audio|track|untitled|sans[-_ ]?titre|download|file|song)$/i;

/** Titre placeholder (Untitled / vide) — à remplacer à l’import. */
export function isPlaceholderTitle(value) {
  const s = String(value || "").trim();
  return !s || /^untitled$/i.test(s);
}

/** Titre lisible depuis un nom de fichier audio (ignore stream.flac, etc.). */
export function titleFromAudioFileName(fileName) {
  const raw = String(fileName || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop() || "";
  const stem = raw.replace(/\.[a-z0-9]{1,8}$/i, "").trim();
  if (!stem || GENERIC_AUDIO_STEMS.test(stem)) return "";
  return stem.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}
