import { norm, uniqStrings, isLock, stripNegatedMetal } from "./util.js";

/**
 * Blob de genres + DNA style (lock, artiste, extras).
 * Sert à décider Metal vs Rock iTunes générique.
 */
export function styleLockGenreBlob(lock, extras = []) {
  const extraList = Array.isArray(extras) ? extras : [extras];
  return [
    ...(Array.isArray(lock?.genres) ? lock.genres : []),
    lock?.genreSummary,
    lock?.musicPrompt,
    ...(Array.isArray(lock?.sonicKeywords) ? lock.sonicKeywords : []),
    lock?.vocalStyle,
    lock?.production,
    lock?.rhythmFeel,
    lock?.matchedName,
    lock?.query,
    lock?.seedTrack?.title,
    lock?.seedTrack?.artistName,
    ...extraList,
  ]
    .filter(Boolean)
    .join(" ");
}

/** iTunes « Rock » vs sous-genre metal : on lit les mots du DNA, pas une liste de groupes. */
export function isThrashLane(blob = "") {
  const g = stripNegatedMetal(norm(blob));
  if (!g.trim()) return false;
  return /\b(thrash|speed metal|crossover thrash)\b/.test(g);
}

export function isMetalLane(blob = "") {
  const g = norm(blob);
  if (!g.trim()) return false;
  if (isThrashLane(g)) return true;
  return (
    /death\s*metal|black\s*metal|grindcore|metalcore|deathcore|doom\s*metal|speed\s*metal|heavy\s*metal|power\s*metal|groove\s*metal|nu[- ]?metal|\bmetal\b|screamo/.test(
      g,
    ) ||
    /blast beat|guttural|death growl|down-?tun(?:ed|ing)|tremolo pick|palm[- ]mute/.test(g)
  );
}

/** Retire « not death metal » / « avoid death growl » pour ne pas inverser la lane. */

export function isExtremeMetalLane(blob = "") {
  const g = stripNegatedMetal(norm(blob));
  if (!g.trim()) return false;
  if (isThrashLane(g) && !/death\s*metal|black\s*metal|grind|guttural|brutal death|deathcore/.test(g)) {
    return false;
  }
  return (
    /death\s*metal|black\s*metal|grindcore|deathcore|brutal death|goregrind|slam metal/.test(g) ||
    (/metal/.test(g) && /brutal|guttural|blast beat/.test(g))
  );
}

/** iTunes range le death metal en « Rock » — on droppe l’ombrelle si un sous-genre existe. */
export function coalesceGenres(list = []) {
  const uniq = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : [list]) {
    const g = String(raw || "").trim();
    if (!g) continue;
    const key = norm(g);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(g);
  }
  const blob = uniq.join(" ");
  let out = uniq;
  if (isMetalLane(blob)) {
    const filtered = uniq.filter((g) => {
      const n = norm(g);
      if (/^(rock|pop)$/.test(n)) return false;
      if (/rock\s*\/\s*indie|indie rock|pop contemporaine|pop urbaine/.test(n)) return false;
      return true;
    });
    if (filtered.length) out = filtered;
  }
  return sortGenresSpecificFirst(out).slice(0, 6);
}

export function sortGenresSpecificFirst(list = []) {
  const score = (g) => {
    const n = norm(g);
    if (/death\s*metal|black\s*metal|grindcore|deathcore/.test(n)) return 0;
    if (/metal|hardcore|screamo|thrash/.test(n)) return 1;
    if (/punk|hard rock/.test(n)) return 2;
    if (/^rock$|indie rock|rock \//.test(n)) return 8;
    if (/^pop$|pop contemporaine/.test(n)) return 9;
    return 5;
  };
  return [...list].sort((a, b) => score(a) - score(b));
}
