/**
 * Miroir multi-appareils : la génération album tourne sur un client,
 * mais la progression est écrite dans project.album (Turso) et réhydratée
 * dans le dock Tâches (localStorage) des autres navigateurs.
 */

import { getJob, patchJob, upsertJob } from "./jobStore.js";

export function albumRemoteJobId(albumId) {
  return `album-remote-${albumId || "unknown"}`;
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

  if (album.live?.message) {
    return {
      label: album.live.label || album.title || `Album · ${total} titres`,
      message: album.live.message,
      percent: Math.max(0, Math.min(100, Number(album.live.percent) || 0)),
    };
  }

  let message = `${done}/${total} titres`;
  if (active?.status === "lyrics") {
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
    album.status === "done" || album.status === "cancelled"
      ? 100
      : Math.max(4, Math.round((done / total) * 90) + (active ? 5 : 0));

  return {
    label: album.title ? `Album · ${album.title}` : `Album · ${total} titres`,
    message,
    percent,
  };
}

/**
 * Crée / met à jour la tâche locale miroir pour un album distant.
 * Sur le client qui génère (job local sans remoteAlbum), on ne flippe pas le flag.
 * @param {object|null} album
 * @param {string|null} projectId
 */
export function mirrorAlbumJob(album, projectId) {
  if (!album?.id) return null;
  const id = album.jobId || albumRemoteJobId(album.id);
  const href = projectId ? `/?project=${projectId}&step=4` : "/?step=4";
  const summary = albumLiveSummary(album);
  if (!summary) return null;

  const existing = getJob(id);
  const isLocalOwner = Boolean(existing && !existing.remoteAlbum);

  // Client qui lance la gen : laisse trackStepJob / finishStepJob gérer le statut
  if (isLocalOwner) {
    if (album.status === "running") {
      return patchJob(id, {
        progress: summary.percent,
        message: summary.message,
        label: summary.label,
        href,
      });
    }
    return existing;
  }

  if (album.status === "running") {
    return upsertJob({
      id,
      type: "step",
      status: "running",
      label: summary.label,
      message: summary.message,
      progress: summary.percent,
      projectId: projectId || undefined,
      stepKey: "4",
      href,
      remoteAlbum: true,
      albumId: album.id,
    });
  }

  const status =
    album.status === "done"
      ? "done"
      : album.status === "cancelled"
        ? "interrupted"
        : album.status === "error"
          ? "error"
          : null;

  if (!status) return existing;

  return upsertJob({
    id,
    type: "step",
    status,
    label: summary.label,
    message: summary.message,
    progress: 100,
    projectId: projectId || undefined,
    stepKey: "4",
    href,
    remoteAlbum: true,
    albumId: album.id,
  });
}
