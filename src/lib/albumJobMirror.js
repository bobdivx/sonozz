/**
 * Miroir multi-appareils : la génération album tourne sur un client,
 * mais la progression est écrite dans project.album (Turso) et réhydratée
 * dans le dock Tâches (localStorage) des autres navigateurs.
 */

import { isAlbumStale } from "./albumTracks.js";
import { artistAlbumHref, studioHref } from "./studio.js";
import { getJob, listJobs, patchJob, removeJobsWhere, upsertJob } from "./jobStore.js";

/** Sans live Turso depuis ce délai, le miroir n’affiche plus « en cours ». */
export const STALE_ALBUM_MIRROR_MS = 3 * 60 * 1000;

/** Annulations locales : évite que le poll 4 s recréé la carte avant le save Turso. */
const dismissedAt = new Map();

export function albumRemoteJobId(albumId) {
  return `album-remote-${albumId || "unknown"}`;
}

export function albumLocalJobId(projectId) {
  return `album-${projectId || "unknown"}`;
}

/**
 * Un seul id par album : celui du runner (`album-${projectId}`).
 * Les vieux `album-remote-*` / jobId d’étape sont des doublons à fusionner.
 */
export function canonicalAlbumJobId(album, projectId) {
  if (projectId) return albumLocalJobId(projectId);
  if (album?.jobId) return String(album.jobId);
  return albumRemoteJobId(album?.id);
}

export function markAlbumMirrorDismissed(albumId, projectId) {
  const now = Date.now();
  if (albumId) dismissedAt.set(`alb:${albumId}`, now);
  if (projectId) dismissedAt.set(`proj:${projectId}`, now);
}

export function isAlbumMirrorDismissed(album, projectId) {
  const updated = Date.parse(album?.updatedAt || "") || 0;
  const keys = [];
  if (album?.id) keys.push(`alb:${album.id}`);
  if (projectId) keys.push(`proj:${projectId}`);
  return keys.some((k) => {
    const at = dismissedAt.get(k);
    return Boolean(at) && updated <= at;
  });
}

export function albumStatusToJob(status) {
  if (status === "done") return "done";
  if (status === "cancelled") return "interrupted";
  if (status === "error") return "error";
  return null;
}

export function isAlbumJobLike(job) {
  return Boolean(
    job &&
      (job.type === "album" ||
        job.remoteAlbum ||
        job.albumId ||
        String(job.id || "").startsWith("album-")),
  );
}

export function removeDuplicateAlbumJobs(canonicalId, { projectId, albumId } = {}) {
  if (!canonicalId) return;
  removeJobsWhere((j) => {
    if (!j || j.id === canonicalId) return false;
    if (!isAlbumJobLike(j)) return false;
    const sameProject = projectId && j.projectId === projectId;
    const sameAlbum = albumId && j.albumId === albumId;
    return Boolean(sameProject || sameAlbum);
  });
}

/**
 * Calcule un résumé live à partir de l’album (fallback si live manquant).
 * @param {object} album
 */
export function albumLiveSummary(album) {
  if (!album) return null;
  const tracks = Array.isArray(album.tracks) ? album.tracks : [];
  const total = album.targetCount || tracks.length || 1;
  const done = tracks.filter((t) => t.status === "done").length;
  const active = tracks.find((t) => t.status === "lyrics" || t.status === "audio");
  const failed = tracks.filter((t) => t.status === "error").length;
  const stale = isAlbumStale(album, STALE_ALBUM_MIRROR_MS);

  if (album.live?.message && !stale) {
    return {
      label: album.live.label || album.title || `Album · ${total} titres`,
      message: album.live.message,
      percent: Math.max(0, Math.min(100, Number(album.live.percent) || 0)),
    };
  }

  let message = `${done}/${total} titres`;
  if (stale && album.status === "running") {
    message = `Plus de progression · ${done}/${total} titres — tu peux arrêter`;
  } else if (active?.status === "lyrics") {
    message = `Paroles ${active.index || "?"}/${total}…`;
  } else if (active?.status === "audio") {
    message = `Audio ${active.index || "?"}/${total}…`;
  } else if (album.status === "done") {
    message = failed ? `Album partiel · ${done} OK` : `Album prêt · ${done} titres`;
  } else if (album.status === "cancelled") {
    message = `Album annulé · ${done} titres gardés`;
  } else if (album.status === "error") {
    message = "Album en erreur";
  }

  const percent =
    album.status === "done" || album.status === "cancelled" || stale
      ? stale && album.status === "running"
        ? Math.max(4, Math.round((done / total) * 90) + (active ? 5 : 0))
        : 100
      : Math.max(4, Math.round((done / total) * 90) + (active ? 5 : 0));

  return {
    label: album.title ? `Album · ${album.title}` : `Album · ${total} titres`,
    message,
    percent,
  };
}

function albumDockHref(projectId, artistSlug, existingHref) {
  const slug = String(artistSlug || "").trim();
  if (slug) return artistAlbumHref(slug, projectId);
  if (existingHref && String(existingHref).includes("/artiste/")) return existingHref;
  return studioHref(projectId, "tracks");
}

function applyMirrorFields(album, projectId, summary, extra = {}) {
  const { artistSlug, ...rest } = extra;
  const href = albumDockHref(projectId, artistSlug, extra.href);
  return {
    id: canonicalAlbumJobId(album, projectId),
    type: extra.type || "album",
    label: summary.label,
    message: summary.message,
    progress: summary.percent,
    projectId: projectId || undefined,
    stepKey: "tracks",
    albumId: album.id,
    ...rest,
    href,
  };
}

/**
 * Crée / met à jour la tâche locale miroir pour un album distant.
 * Sur le client qui génère (job local sans remoteAlbum), on ne flippe pas le flag.
 * @param {object|null} album
 * @param {string|null} projectId
 * @param {string} [artistSlug]
 */
export function mirrorAlbumJob(album, projectId, artistSlug) {
  if (!album?.id) return null;
  const id = canonicalAlbumJobId(album, projectId);
  const summary = albumLiveSummary(album);
  if (!summary) return null;

  const existing = getJob(id);
  const isLocalOwner = Boolean(existing && existing.type === "album" && !existing.remoteAlbum);
  const dismissed = isAlbumMirrorDismissed(album, projectId);
  const stale = album.status === "running" && isAlbumStale(album, STALE_ALBUM_MIRROR_MS);

  removeDuplicateAlbumJobs(id, { projectId, albumId: album.id });

  if (isLocalOwner) {
    if (album.status === "running" && !dismissed) {
      return patchJob(id, {
        progress: summary.percent,
        message: summary.message,
        label: summary.label,
        href: albumDockHref(projectId, artistSlug, existing.href),
        albumId: album.id,
      });
    }
    const status = dismissed
      ? "interrupted"
      : albumStatusToJob(album.status);
    if (!status) return existing;
    return patchJob(id, {
      status,
      phase: status === "done" ? "done" : status,
      progress: summary.percent,
      message: dismissed ? "Album arrêté" : summary.message,
      label: summary.label,
    });
  }

  if (dismissed) {
    const leftover = getJob(id);
    if (!leftover) return null;
    return patchJob(id, {
      status: "interrupted",
      phase: "interrupted",
      message: "Album arrêté",
      remoteAlbum: true,
      albumId: album.id,
    });
  }

  if (album.status === "running" && !stale) {
    return upsertJob(
      applyMirrorFields(album, projectId, summary, {
        type: "album",
        status: "running",
        remoteAlbum: true,
        artistSlug,
      }),
    );
  }

  const status = stale ? "interrupted" : albumStatusToJob(album.status);
  if (!status) return existing || null;

  // Ne pas ressusciter une carte que l’utilisateur a déjà retirée
  if (!getJob(id) && status !== "running") return null;

  return upsertJob(
    applyMirrorFields(album, projectId, summary, {
      type: "album",
      status,
      phase: status === "done" ? "done" : status,
      progress: stale ? summary.percent : 100,
      remoteAlbum: true,
      artistSlug,
    }),
  );
}

/** Fusionne les cartes album dupliquées déjà en localStorage (rechargement). */
export function dedupeStoredAlbumJobs() {
  const groups = new Map();
  for (const job of listJobs()) {
    if (!isAlbumJobLike(job) || !job.projectId) continue;
    const list = groups.get(job.projectId) || [];
    list.push(job);
    groups.set(job.projectId, list);
  }
  for (const [projectId, list] of groups) {
    if (list.length < 2) continue;
    const canonicalId = albumLocalJobId(projectId);
    const owner = list.find((j) => j.id === canonicalId && !j.remoteAlbum);
    const keep = owner || list.find((j) => j.id === canonicalId) || list[0];
    removeDuplicateAlbumJobs(keep.id, { projectId, albumId: keep.albumId });
  }
}
