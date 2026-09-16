/**
 * Cache catalogue /play — localStorage + mémoire + prefetch partagé.
 * Évite d’attendre Turso pour peindre la page après la 1re visite.
 */

export const LIBRARY_CACHE_KEY = "sonozz-play-library-v1";
export const LIBRARY_CACHE_TTL_MS = 10 * 60 * 1000;
const MEMORY_TTL_MS = 90 * 1000;

/** @type {{ ts: number, tracks: any[], artists: any[] } | null} */
let memory = null;
/** @type {Promise<{ tracks: any[], artists: any[] }> | null} */
let inflight = null;

export function readLibraryCache() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LIBRARY_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.tracks) || !data.tracks.length) return null;
    if (Date.now() - (data.ts || 0) > LIBRARY_CACHE_TTL_MS) return null;
    return {
      ts: data.ts || 0,
      tracks: data.tracks,
      artists: Array.isArray(data.artists) ? data.artists : [],
    };
  } catch {
    return null;
  }
}

export function writeLibraryCache(tracks, artists) {
  const payload = {
    ts: Date.now(),
    tracks: Array.isArray(tracks) ? tracks : [],
    artists: Array.isArray(artists) ? artists : [],
  };
  memory = payload;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(payload));
    }
  } catch {
    /* quota */
  }
  return payload;
}

export function peekMemoryLibrary() {
  if (memory?.tracks?.length && Date.now() - memory.ts < MEMORY_TTL_MS) {
    return memory;
  }
  return null;
}

/**
 * Prefetch / réutilise la promesse en cours (hover nav → ouverture Play).
 */
export function prefetchLibrary() {
  const mem = peekMemoryLibrary();
  if (mem) return Promise.resolve({ tracks: mem.tracks, artists: mem.artists });
  if (inflight) return inflight;

  inflight = fetch("/api/library")
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Impossible de charger la bibliothèque");
      const tracks = data.tracks || [];
      const artists = data.artists || [];
      if (tracks.length) writeLibraryCache(tracks, artists);
      return { tracks, artists };
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Bootstrap sync pour peindre immédiatement (mémoire → localStorage). */
export function bootstrapLibraryFromCache() {
  const mem = peekMemoryLibrary();
  if (mem?.tracks?.length) {
    return { tracks: mem.tracks, artists: mem.artists, fromCache: true };
  }
  const cached = readLibraryCache();
  if (cached?.tracks?.length) {
    memory = cached;
    return { tracks: cached.tracks, artists: cached.artists, fromCache: true };
  }
  return { tracks: [], artists: [], fromCache: false };
}
