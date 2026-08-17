import { json, error, readBody } from "../../server/http.js";
import {
  searchStyleTrackCandidates,
  resolveStyleTrackReference,
  listArtistTopTrackCandidates,
} from "../../server/styleReference.js";

function lightStyleLock(styleLock) {
  if (!styleLock) return null;
  return {
    query: styleLock.query,
    matchedName: styleLock.matchedName,
    source: styleLock.source,
    sourceId: styleLock.sourceId,
    confidence: styleLock.confidence,
    url: styleLock.url,
    image: styleLock.image,
    genres: styleLock.genres,
    genreSummary: styleLock.genreSummary,
    mood: styleLock.mood,
    energy: styleLock.energy,
    tempoFeel: styleLock.tempoFeel,
    bpm: styleLock.bpm,
    production: styleLock.production,
    vocalStyle: styleLock.vocalStyle,
    vocalRegister: styleLock.vocalRegister,
    timbre: styleLock.timbre,
    rhythmFeel: styleLock.rhythmFeel,
    instruments: styleLock.instruments,
    sonicKeywords: styleLock.sonicKeywords,
    writingStyle: styleLock.writingStyle,
    visualVibe: styleLock.visualVibe,
    doNot: styleLock.doNot,
    musicPrompt: styleLock.musicPrompt,
    topTracks: styleLock.topTracks,
    audioListened: Boolean(styleLock.audioListened),
    seedTrack: styleLock.seedTrack || undefined,
  };
}

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const action = String(body?.action || "search").trim();
    const keys = body.keys || {};

    if (action === "resolve") {
      const pick = body.pick || body.styleTrackPick;
      if (!pick?.source || !pick?.id) {
        return error("Choisis et valide un titre dans les résultats.", 400);
      }
      const styleLock = await resolveStyleTrackReference(keys, pick);
      return json({ ok: true, styleLock: lightStyleLock(styleLock) });
    }

    if (action === "top-for-artist") {
      const artistPick = body.artistPick || body.pick;
      if (!artistPick?.id && String(artistPick?.name || "").trim().length < 2) {
        return error("Artiste de référence manquant.", 400);
      }
      const data = await listArtistTopTrackCandidates(keys, artistPick);
      return json(data);
    }

    const query = String(body.query || body.q || body.styleTrack || "").trim();
    if (query.length < 2) {
      return error("Saisis au moins 2 caractères pour chercher un titre.", 400);
    }
    const data = await searchStyleTrackCandidates(keys, query);
    return json(data);
  } catch (e) {
    return error(e.message || "Recherche titre impossible", 500);
  }
}

export const prerender = false;
