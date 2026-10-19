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
  const catalog = await loadStyleArtistCatalogRaw(keys, pick);
  return fillThinCatalog(catalog, pick);
}

/** Fiche « maigre » = le LLM n'aurait que le nom pour deviner le son. */
export function isThinCatalog(c) {
  if (!c) return true;
  const tracks = Array.isArray(c.topTracks) ? c.topTracks.length : 0;
  const genres = Array.isArray(c.genres) ? c.genres.length : 0;
  const previews = Array.isArray(c.previewUrls) ? c.previewUrls.length : 0;
  return tracks < 3 || genres === 0 || previews === 0;
}

/** Fusionne une 2e source (même nom exact) dans une fiche maigre. */
export function mergeCatalogs(base, extra) {
  if (!base) return extra || null;
  if (!extra) return base;
  const uniq = (arr, max) =>
    arr
      .filter(Boolean)
      .filter((v, i, a) => a.findIndex((x) => norm(x) === norm(v)) === i)
      .slice(0, max);
  const sources = uniq([base.source, ...(base.extraSources || []), extra.source], 4);
  return {
    ...base,
    genres: uniq([...(base.genres || []), ...(extra.genres || [])], 6),
    inferredGenres: uniq([...(base.inferredGenres || []), ...(extra.inferredGenres || [])], 6),
    topTracks: uniq([...(base.topTracks || []), ...(extra.topTracks || [])], 10),
    previewUrls: [...new Set([...(base.previewUrls || []), ...(extra.previewUrls || [])])].slice(0, 5),
    albums: uniq([...(base.albums || []), ...(extra.albums || [])], 8),
    related: uniq([...(base.related || []), ...(extra.related || [])], 8),
    image: base.image || extra.image || null,
    extraSources: sources.filter((s) => s !== base.source),
  };
}

async function fillThinCatalog(catalog, pick) {
  if (!catalog || !isThinCatalog(catalog)) return catalog;
  const name = catalog.name || pick?.name;
  if (!name) return catalog;
  let out = { ...catalog, genres: catalog.genres?.length ? catalog.genres : (pick?.genres || []).map(titleCaseGenre) };
  const tries = [];
  if (catalog.source !== "itunes") {
    tries.push(async () => {
      const list = await listItunesCandidates(name);
      const hit = list.find((c) => norm(c.name) === norm(name));
      return hit ? hydrateItunesCatalog(hit, 1000) : null;
    });
  }
  if (catalog.source !== "deezer") {
    tries.push(async () => {
      const list = await listDeezerCandidates(name);
      const hit = list.find((c) => norm(c.name) === norm(name));
      return hit ? hydrateDeezerCatalog(hit, 1000) : null;
    });
  }
  for (const t of tries) {
    if (!isThinCatalog(out)) break;
    try {
      out = mergeCatalogs(out, await t());
    } catch {
      /* source indisponible */
    }
  }
  out.thin = isThinCatalog(out);
  return out;
}

async function loadStyleArtistCatalogRaw(keys, pick) {
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
