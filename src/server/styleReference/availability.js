import { inferLanguageFromStyleRef } from "../../lib/studio.js";
import { norm, nameMatchScore, mergeArtistCandidatesByName, titleCaseGenre } from "./util.js";
import {
  listSpotifyCandidates,
  listItunesCandidates,
  listDeezerCandidates,
  listMusicBrainzCandidates,
  resolveMusicBrainzViaItunes,
  hydrateSpotifyCatalog,
  hydrateItunesCatalog,
  hydrateDeezerCatalog,
} from "./providers.js";
import { getSpotifyAccess } from "../spotify.js";

export function classifyArtistNameAvailability(query, candidates = []) {
  const q = String(query || "").trim();
  const collisions = [];
  const warnings = [];
  const seen = new Set();

  for (const c of candidates) {
    if (!c?.name) continue;
    const pure = nameMatchScore(c.name, q);
    const key = `${c.source || "?"}:${c.id != null ? c.id : norm(c.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const entry = {
      source: c.source || null,
      id: c.id != null ? String(c.id) : null,
      name: c.name,
      url: c.url || null,
      image: c.image || null,
      followers: c.followers ?? null,
      matchScore: Math.round(pure),
    };

    if (pure >= 1000) collisions.push(entry);
    else if (pure >= 800) warnings.push(entry);
  }

  collisions.sort((a, b) => (b.followers || 0) - (a.followers || 0));
  warnings.sort((a, b) => b.matchScore - a.matchScore);

  return {
    query: q,
    available: collisions.length === 0,
    collisions: collisions.slice(0, 8),
    warnings: warnings.slice(0, 6),
  };
}

/**
 * Vérifie si un nom de scène est déjà pris sur Spotify / Apple (iTunes) / Deezer / MusicBrainz.
 */
export async function checkArtistNameAvailability(keys, artistName) {
  const query = String(artistName || "")
    .trim()
    .slice(0, 80);
  if (query.length < 2) {
    return { query, available: true, collisions: [], warnings: [], sources: {} };
  }

  const { candidates, sources } = await searchStyleArtistCandidates(keys, query);
  return {
    ...classifyArtistNameAvailability(query, candidates),
    sources,
  };
}

/**
 * Liste des candidats pour validation utilisateur (Spotify + iTunes + Deezer + MusicBrainz).
 */
export async function searchStyleArtistCandidates(keys, artistName) {
  const query = String(artistName || "").trim().slice(0, 120);
  if (query.length < 2) return { query, candidates: [] };

  const [spotify, itunes, deezer, musicbrainz] = await Promise.all([
    listSpotifyCandidates(keys, query).catch(() => []),
    listItunesCandidates(query).catch(() => []),
    listDeezerCandidates(query).catch(() => []),
    listMusicBrainzCandidates(query).catch(() => []),
  ]);

  const mbResolved = await resolveMusicBrainzViaItunes(musicbrainz, query).catch(() => musicbrainz);

  const ranked = mergeArtistCandidatesByName([
    ...spotify,
    ...itunes,
    ...deezer,
    ...mbResolved,
    ...musicbrainz,
  ]).sort((a, b) => b.matchScore - a.matchScore);
  const best = ranked[0]?.matchScore || 0;
  const candidates = ranked
    .filter((c) => {
      // Garder les bons matchs ; si on a un exact, dropper le bruit faible
      if (best >= 900) return c.matchScore >= 250;
      if (best >= 500) return c.matchScore >= 150;
      return c.matchScore >= 80;
    })
    .slice(0, 10)
    .map(({ matchScore, ...rest }) => ({
      ...rest,
      matchScore: Math.round(matchScore),
      language:
        rest.language ||
        inferLanguageFromStyleRef({
          country: rest.country,
          genres: rest.genres,
        }) ||
        undefined,
      gender: rest.gender || undefined,
    }));

  return {
    query,
    candidates,
    sources: {
      spotify: spotify.length > 0,
      itunes: itunes.length > 0,
      deezer: deezer.length > 0,
      musicbrainz: musicbrainz.length > 0,
    },
  };
}

/**
 * Charge la fiche complète d'un candidat validé par l'utilisateur.
 */
export async function loadStyleArtistCatalog(keys, pick) {
  if (!pick?.source || !pick?.id) {
    throw new Error("Sélection artiste invalide — valide un résultat de recherche.");
  }
  if (pick.source === "spotify") {
    const access = await getSpotifyAccess(keys);
    if (!access?.token) {
      throw new Error("Spotify non configuré — impossible de charger cet artiste.");
    }
    return hydrateSpotifyCatalog(access.token, pick, 1000);
  }
  if (pick.source === "itunes") {
    return hydrateItunesCatalog(pick, 1000);
  }
  if (pick.source === "deezer") {
    return hydrateDeezerCatalog(pick, 1000);
  }
  if (pick.source === "musicbrainz") {
    // Essayer de résoudre via iTunes pour titres / artwork
    try {
      const itunes = await listItunesCandidates(pick.name);
      const exact =
        itunes.find((c) => norm(c.name) === norm(pick.name)) || itunes[0];
      if (exact && nameMatchScore(exact.name, pick.name) >= 600) {
        return hydrateItunesCatalog(exact, 1000);
      }
    } catch {
      /* ignore */
    }
    return {
      source: "musicbrainz",
      id: String(pick.id),
      name: pick.name,
      genres: (pick.genres || []).map(titleCaseGenre),
      inferredGenres: (pick.genres || []).map(titleCaseGenre),
      popularity: null,
      followers: null,
      topTracks: [],
      albums: [],
      related: [],
      relatedGenres: [],
      url: pick.url || `https://musicbrainz.org/artist/${pick.id}`,
      image: pick.image || null,
      matchScore: 1000,
    };
  }
  throw new Error(`Source inconnue : ${pick.source}`);
}
