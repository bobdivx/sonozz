/** Nombre max de noms vérifiés sur les stores avant d'abandonner (Auto A→Z inclus). */
export const FREE_NAME_MAX_CHECKS = 12;
export const FREE_NAME_PER_ROUND = 4;

export function formatNameCollisions(collisions = []) {
  return collisions
    .slice(0, 3)
    .map((c) => {
      const fans =
        c.followers != null && Number.isFinite(Number(c.followers))
          ? ` · ${Number(c.followers).toLocaleString("fr-FR")} fans`
          : "";
      return `${c.name} (${c.source || "?"}${fans})`;
    })
    .join(", ");
}

export function normalizeArtistStageName(value) {
  return String(value || "")
    .trim()
    .slice(0, 80);
}

export function artistNameKey(value) {
  return normalizeArtistStageName(value)
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Extraie des candidats nom de scène depuis une réponse LLM, en sautant les déjà refusés.
 */
export function collectAlternateStageNames(payload, blockedKeys = new Set()) {
  const raw = [];
  if (payload && typeof payload === "object") {
    raw.push(payload.name, payload.aka);
    if (Array.isArray(payload.names)) raw.push(...payload.names);
  }
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const name = normalizeArtistStageName(item);
    const key = artistNameKey(name);
    if (!name || name.length < 2 || seen.has(key) || blockedKeys.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Cherche un nom libre en enchaînant les essais (le pipeline A→Z ne s'arrête plus au 2e refus).
 * `checkAvailability` et `proposeNames` sont injectés pour les tests.
 */
export async function resolveFreeGeneratedStageName({
  initialName,
  checkAvailability,
  proposeNames,
  onStatus,
  maxChecks = FREE_NAME_MAX_CHECKS,
}) {
  const blocked = [];
  const blockedKeys = new Set();
  let queue = collectAlternateStageNames({ name: initialName });
  let lastName = normalizeArtistStageName(initialName);
  let lastCollisions = [];

  while (blocked.length < maxChecks) {
    if (!queue.length) {
      const proposed = await proposeNames({
        blocked: [...blocked],
        lastName,
        lastCollisions,
      });
      queue = collectAlternateStageNames(proposed, blockedKeys);
      if (!queue.length) break;
    }

    const candidate = queue.shift();
    const key = artistNameKey(candidate);
    if (!candidate || blockedKeys.has(key)) continue;

    if (blocked.length > 0) {
      onStatus?.(`Vérification du nom « ${candidate} » (${blocked.length + 1}/${maxChecks})…`);
    }

    const availability = await checkAvailability(candidate);
    lastName = candidate;
    lastCollisions = availability?.collisions || [];

    if (availability?.available) {
      return { name: candidate, tried: blocked };
    }

    blocked.push(candidate);
    blockedKeys.add(key);
    const taken = formatNameCollisions(lastCollisions);
    onStatus?.(
      `« ${candidate} » déjà pris${taken ? ` : ${taken}` : ""}. Recherche d’un autre nom (${blocked.length}/${maxChecks})…`,
    );
  }

  const taken = formatNameCollisions(lastCollisions);
  throw new Error(
    `Impossible de trouver un nom libre après ${Math.max(blocked.length, 1)} essai${
      blocked.length > 1 ? "s" : ""
    } (dernier « ${lastName || "?"} »${taken ? ` déjà pris : ${taken}` : ""}). Saisis un nom de scène manuellement.`,
  );
}
