/**
 * Modèle multi-clips : shorts (9:16 promo) + fulls (vidéo complète).
 * Compat : `project.clip` reste le miroir du clip actif.
 */

export const CLIP_KIND_SHORT = "short";
export const CLIP_KIND_FULL = "full";

export function createClipId() {
  try {
    return `clip_${crypto.randomUUID().slice(0, 12)}`;
  } catch {
    return `clip_${Date.now().toString(36)}`;
  }
}

/** Clé IndexedDB / session pour un clip donné. */
export function clipBlobKey(projectId, clipId) {
  if (!clipId) return projectId ? String(projectId) : null;
  if (!projectId) return String(clipId);
  return `${projectId}::${clipId}`;
}

export function isClipReady(clip) {
  if (!clip || typeof clip !== "object") return false;
  if (clip.provider === "canvas-fallback") return false;
  return Boolean(
    clip.storedRemote ||
      clip.storedLocally ||
      clip.videoUrl ||
      clip.s3Key ||
      clip.videoBase64 ||
      clip.provider,
  );
}

/** Métadonnées légères sans bytes (Turso / state). */
export function lightClipMeta(clip = {}, extra = {}) {
  if (!clip || typeof clip !== "object") return { storedLocally: true, ...extra };
  const { videoBase64, ...rest } = clip;
  const remote =
    typeof rest.videoUrl === "string" && /^https?:\/\//i.test(rest.videoUrl)
      ? rest.videoUrl
      : undefined;
  return {
    ...rest,
    ...extra,
    videoBase64: undefined,
    videoUrl: remote || extra.videoUrl || undefined,
    storedRemote: Boolean(remote || rest.s3Key || rest.storedRemote || extra.storedRemote),
    storedLocally: Boolean(
      extra.storedLocally ?? (rest.storedLocally && !remote && !rest.s3Key),
    ),
  };
}

/**
 * Normalise un projet legacy (`clip` seul) vers `clips[]` + `activeClipId`.
 */
export function normalizeProjectClips(project = {}) {
  const next = { ...project };
  const hadClipsArray = Array.isArray(next.clips);
  let clips = hadClipsArray ? next.clips.filter(Boolean).map(lightClipMeta) : [];

  // Legacy mono-clip : uniquement si `clips` était absent (pas un [] volontaire après delete)
  if (!hadClipsArray && !clips.length && next.clip && typeof next.clip === "object") {
    const legacy = lightClipMeta(next.clip, {
      id: next.clip.id || createClipId(),
      kind: next.clip.kind === CLIP_KIND_FULL ? CLIP_KIND_FULL : CLIP_KIND_SHORT,
    });
    clips = [legacy];
  }

  clips = clips.map((c) =>
    lightClipMeta(c, {
      id: c.id || createClipId(),
      kind: c.kind === CLIP_KIND_FULL ? CLIP_KIND_FULL : CLIP_KIND_SHORT,
    }),
  );

  let activeClipId = next.activeClipId || null;
  if (activeClipId && !clips.some((c) => c.id === activeClipId)) {
    activeClipId = null;
  }
  if (!activeClipId && clips.length) {
    activeClipId = clips[0].id;
  }

  const active = clips.find((c) => c.id === activeClipId) || null;
  next.clips = clips;
  next.activeClipId = activeClipId;
  next.clip = active;

  return next;
}

export function clipsOfKind(clips = [], kind = CLIP_KIND_SHORT) {
  return (clips || []).filter((c) => (c.kind || CLIP_KIND_SHORT) === kind);
}

export function getActiveClip(project = {}) {
  const normalized = normalizeProjectClips(project);
  return normalized.clips.find((c) => c.id === normalized.activeClipId) || null;
}

/** Upsert un clip et le rend actif. Retourne le projet mis à jour. */
export function upsertProjectClip(project = {}, clipMeta, { activate = true } = {}) {
  const base = normalizeProjectClips(project);
  const light = lightClipMeta(clipMeta, {
    id: clipMeta.id || createClipId(),
    kind: clipMeta.kind === CLIP_KIND_FULL ? CLIP_KIND_FULL : CLIP_KIND_SHORT,
  });
  const idx = base.clips.findIndex((c) => c.id === light.id);
  const clips =
    idx >= 0
      ? base.clips.map((c, i) => (i === idx ? { ...c, ...light } : c))
      : [...base.clips, light];
  const activeClipId = activate ? light.id : base.activeClipId || light.id;
  return normalizeProjectClips({ ...base, clips, activeClipId });
}

export function removeProjectClip(project = {}, clipId) {
  const base = normalizeProjectClips(project);
  const clips = base.clips.filter((c) => c.id !== clipId);
  const activeClipId =
    base.activeClipId === clipId ? clips[0]?.id || null : base.activeClipId;
  const social =
    base.social && base.social.publishedClipId === clipId
      ? { ...base.social, publishedClipId: null }
      : base.social;
  // clip: null explicite — empêche la résurrection legacy si clips devient []
  return normalizeProjectClips({
    ...base,
    clips,
    activeClipId,
    clip: clips.find((c) => c.id === activeClipId) || null,
    social,
  });
}

export function setActiveProjectClip(project = {}, clipId) {
  const base = normalizeProjectClips(project);
  if (!base.clips.some((c) => c.id === clipId)) return base;
  return normalizeProjectClips({ ...base, activeClipId: clipId });
}

/** Strip payloads lourds pour Turso (clip legacy + clips[]). */
export function stripClipsForDb(project = {}) {
  const next = { ...project };
  if (next.clip && typeof next.clip === "object") {
    next.clip = lightClipMeta(next.clip);
  }
  if (Array.isArray(next.clips)) {
    next.clips = next.clips.map((c) => lightClipMeta(c));
  }
  return next;
}
