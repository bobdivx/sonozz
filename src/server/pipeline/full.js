import { resolveArtistProfileForRelease } from "../artists.js";
import { withResolvedArtistGender } from "../../lib/artistGender.js";
import { runTrends } from "./trends.js";
import { runLyrics } from "./lyricsStep.js";
import { runTrack } from "./trackStep.js";
import { runCover } from "./coverStep.js";

/** Étapes du pipeline A→Z (artiste déjà créé ; s'arrête à ONCE). */
export const PIPELINE_STEPS = [
  { key: "trends", label: "Tendances", message: "Analyse Deezer + Gemini…" },
  { key: "lyrics", label: "Paroles", message: "Écriture des paroles…" },
  { key: "track", label: "Morceau", message: "Création morceau / brief audio…" },
  { key: "cover", label: "Jaquette", message: "Génération jaquette…" },
  { key: "distrokid", label: "ONCE", message: "En attente de ta validation…" },
  { key: "done", label: "Terminé", message: "Prêt à publier sur ONCE" },
];

export async function runFullPipeline({
  keys,
  theme,
  market,
  language,
  artistSlug,
  onProgress,
}) {
  const log = [];
  const total = PIPELINE_STEPS.length;
  let trends = null;
  let artist = null;
  let lyrics = null;
  let track = null;
  let cover = null;

  const slug = String(artistSlug || "").trim();
  if (!slug) {
    throw new Error("Choisis un artiste existant. Crée le profil sur /artiste/nouveau.");
  }

  const emitSnapshot = (step) => {
    onProgress?.({
      type: "snapshot",
      step,
      at: new Date().toISOString(),
      snapshot: { trends, artist, lyrics, track, cover, distrokid: null, social: null },
    });
  };

  const push = (step, message) => {
    const entry = { step, message, at: new Date().toISOString() };
    log.push(entry);
    const index = Math.max(
      0,
      PIPELINE_STEPS.findIndex((s) => s.key === step),
    );
    onProgress?.({ ...entry, index, total });
  };

  const profile = await resolveArtistProfileForRelease(slug);
  if (!profile?.name) {
    throw new Error("Artiste introuvable — crée-le d’abord depuis Artistes.");
  }
  artist = withResolvedArtistGender({ ...profile, slug });

  push("trends", "Analyse Deezer + Gemini…");
  trends = await runTrends({ keys, market, artist, artistSlug: slug });
  emitSnapshot("trends");

  push("lyrics", "Écriture des paroles…");
  lyrics = await runLyrics({ keys, theme, artist, trends, language: language || artist.language });
  emitSnapshot("lyrics");

  push("track", "Création morceau / brief audio…");
  track = await runTrack({ keys, lyrics, artist });
  emitSnapshot("track");

  push("cover", "Génération jaquette…");
  cover = await runCover({ keys, artist, track });
  emitSnapshot("cover");

  push("distrokid", "En attente de ta validation ONCE…");
  push("done", "Prêt à publier sur ONCE — vérifie puis clique Publier");

  return {
    trends,
    artist,
    lyrics,
    track,
    cover,
    distrokid: null,
    social: null,
    awaitingOnce: true,
    log,
  };
}
