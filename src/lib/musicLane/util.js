export function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function uniqStrings(list, max = 12) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const s = String(raw || "").trim();
    if (!s) continue;
    const key = norm(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export function isLock(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Retire « not death metal » / « avoid death growl » pour ne pas inverser la lane. */
export function stripNegatedMetal(g) {
  return String(g || "")
    .replace(/\bnot\s+death[- ]?metal\b/g, " ")
    .replace(/\bavoid\s+death(?:[- ]metal)?(?:\s+growl)?\b/g, " ")
    .replace(/\bnever\s+death[- ]?metal\b/g, " ");
}

function blobLooksIndustrial(blob = "") {
  return /industrial|\bebm\b|vocoder/.test(norm(blob));
}

export function artefactGuardsFromBlob(blob = "", lock = null) {
  const g = norm(blob);
  const voice = norm(lock?.vocalStyle || "");
  const harsh = /growl|guttural|scream|harsh/.test(voice || g);
  if (!harsh) return [];
  if (blobLooksIndustrial(g) || blobLooksIndustrial(voice)) return [];
  // Uniquement si growl metal : éviter le glitch vocal industriel non voulu
  return ["clean recorded vocals"];
}
