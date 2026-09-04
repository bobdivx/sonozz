export const emptyProject = () => ({
  trends: null,
  artist: null,
  /** Second artiste SONOZZ (duo / feat.) — snapshot vocal+style, jamais fusionné au lead. */
  featArtist: null,
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

