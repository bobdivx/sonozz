/**
 * Versions créatives : paroles / audio / jaquettes.
 * Compat : `project.lyrics|track|cover` reste le miroir de la version active.
 */

export const VERSION_KINDS = ["lyrics", "track", "cover"];

export const MAX_VERSIONS_PER_KIND = 12;

const KIND_CONFIG = {
  lyrics: {
    versionsKey: "lyricsVersions",
    activeKey: "activeLyricsId",
    mirrorKey: "lyrics",
    idPrefix: "lyr",
  },
  track: {
    versionsKey: "trackVersions",
    activeKey: "activeTrackId",
    mirrorKey: "track",
    idPrefix: "trk",
  },
  cover: {
    versionsKey: "coverVersions",
    activeKey: "activeCoverId",
    mirrorKey: "cover",
    idPrefix: "cvr",
  },
};

export function createVersionId(prefix = "ver") {
  try {
    return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
  } catch {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }
}

function configFor(kind) {
  const cfg = KIND_CONFIG[kind];
  if (!cfg) throw new Error(`Kind de version inconnu: ${kind}`);
  return cfg;
}

function ensureEntryId(entry, idPrefix) {
  if (!entry || typeof entry !== "object") return null;
  return {
    ...entry,
    id: entry.id || createVersionId(idPrefix),
    createdAt: entry.createdAt || new Date().toISOString(),
  };
}

/**
 * Normalise un kind : migre le miroir legacy, assure ids, resync miroir actif.
 */
function normalizeKind(project, kind) {
  const cfg = configFor(kind);
  const next = { ...project };
  const hadArray = Array.isArray(next[cfg.versionsKey]);
  let versions = hadArray
    ? next[cfg.versionsKey].filter(Boolean).map((e) => ensureEntryId(e, cfg.idPrefix)).filter(Boolean)
    : [];

  // Legacy mono : uniquement si le tableau était absent (pas un [] volontaire après delete)
  const mirror = next[cfg.mirrorKey];
  if (!hadArray && !versions.length && mirror && typeof mirror === "object") {
    versions = [
      ensureEntryId(
        {
          ...mirror,
          id: mirror.id || createVersionId(cfg.idPrefix),
          createdAt: mirror.createdAt || new Date().toISOString(),
        },
        cfg.idPrefix,
      ),
    ];
  }

  let activeId = next[cfg.activeKey] || null;
  if (activeId && !versions.some((v) => v.id === activeId)) {
    activeId = null;
  }
  if (!activeId && versions.length) {
    // Préférer le miroir s’il a un id présent, sinon la plus récente
    const mirrorId = mirror?.id;
    if (mirrorId && versions.some((v) => v.id === mirrorId)) {
      activeId = mirrorId;
    } else {
      activeId = versions[versions.length - 1].id;
    }
  }

  const active = versions.find((v) => v.id === activeId) || null;
  next[cfg.versionsKey] = versions;
  next[cfg.activeKey] = activeId;
  next[cfg.mirrorKey] = active;

  return next;
}

/** Normalise paroles + audio + jaquettes. */
export function normalizeProjectVersions(project = {}) {
  let next = { ...project };
  for (const kind of VERSION_KINDS) {
    next = normalizeKind(next, kind);
  }
  return next;
}

export function getVersions(project, kind) {
  const cfg = configFor(kind);
  const normalized = normalizeKind(project, kind);
  return normalized[cfg.versionsKey] || [];
}

export function getActiveVersion(project, kind) {
  const cfg = configFor(kind);
  const normalized = normalizeKind(project, kind);
  return normalized[cfg.mirrorKey] || null;
}

/**
 * Ajoute une version et la rend active.
 * @throws si soft cap atteint
 */
export function appendVersion(project = {}, kind, payload) {
  const cfg = configFor(kind);
  const base = normalizeKind(project, kind);
  const versions = base[cfg.versionsKey] || [];

  if (versions.length >= MAX_VERSIONS_PER_KIND) {
    throw new Error(
      `Maximum ${MAX_VERSIONS_PER_KIND} versions atteint — supprime-en une avant d’en générer une nouvelle.`,
    );
  }

  const entry = ensureEntryId(
    {
      ...(payload && typeof payload === "object" ? payload : {}),
      id: payload?.id || createVersionId(cfg.idPrefix),
      createdAt: new Date().toISOString(),
    },
    cfg.idPrefix,
  );

  return normalizeKind(
    {
      ...base,
      [cfg.versionsKey]: [...versions, entry],
      [cfg.activeKey]: entry.id,
    },
    kind,
  );
}

export function selectVersion(project = {}, kind, id) {
  const cfg = configFor(kind);
  const base = normalizeKind(project, kind);
  if (!base[cfg.versionsKey].some((v) => v.id === id)) return base;
  return normalizeKind({ ...base, [cfg.activeKey]: id }, kind);
}

/**
 * Supprime une version. Si c’était l’active, bascule sur la plus récente restante.
 * Retourne { project, removed } — removed utile pour cleanup S3.
 */
export function deleteVersion(project = {}, kind, id) {
  const cfg = configFor(kind);
  const base = normalizeKind(project, kind);
  const removed = base[cfg.versionsKey].find((v) => v.id === id) || null;
  const versions = base[cfg.versionsKey].filter((v) => v.id !== id);

  let activeId = base[cfg.activeKey];
  if (activeId === id) {
    activeId = versions.length ? versions[versions.length - 1].id : null;
  }

  const next = normalizeKind(
    {
      ...base,
      [cfg.versionsKey]: versions,
      [cfg.activeKey]: activeId,
      // null explicite empêche la résurrection legacy si le tableau est vide
      [cfg.mirrorKey]: versions.find((v) => v.id === activeId) || null,
    },
    kind,
  );

  return { project: next, removed };
}

/** Met à jour le payload d’une version existante (ex. après persist S3). */
export function updateVersion(project = {}, kind, id, patch) {
  const cfg = configFor(kind);
  const base = normalizeKind(project, kind);
  const versions = base[cfg.versionsKey].map((v) =>
    v.id === id ? { ...v, ...patch, id: v.id, createdAt: v.createdAt } : v,
  );
  if (!versions.some((v) => v.id === id)) return base;
  return normalizeKind({ ...base, [cfg.versionsKey]: versions }, kind);
}
