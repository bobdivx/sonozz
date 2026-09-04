/**
 * Runner d’arrière-plan : reprend les polls Veo/Seedance/Wan2GP / album / morceau
 * après navigation. Ne stocke PAS les bytes vidéo dans localStorage (trop gros)
 * — mémoire session + IDB.
 */

import { api } from "./apiClient.js";
import {
  createJobId,
  getJob,
  listActiveJobs,
  patchJob,
  removeJob,
  subscribeJobs,
  upsertJob,
} from "./jobStore.js";
import {
  clipMetaOnly,
  deleteClipBlob,
  ensureClipStorageKey,
  loadClipBlob,
  saveClipBlob,
} from "./clipStore.js";
import {
  CLIP_KIND_SHORT,
  createClipId,
  upsertProjectClip,
  normalizeProjectClips,
  stripClipsForDb,
} from "./clipsModel.js";
import { assemblePromoShort, PROMO_SHORT_SECONDS } from "./assemblePromoShort.js";
import { detectBeatsFromUrl, pickCutPoints } from "./beatDetect.js";
import { resolveVideoBlobUrl, resolveVideoBlobUrls } from "./videoResolve.js";
import { extractTrackExcerpt } from "./audioExcerpt.js";
import { persistAudioRemote } from "./audioResolve.js";
import { emptyProject, studioHref } from "./studio.js";
import { runAlbumJob } from "./runAlbumJob.js";
import { appendVersion, normalizeProjectVersions } from "./versionsModel.js";
import { cancelledAlbumState } from "./albumTracks.js";
import {
  applySonicVariation,
  artistWithSonicVariation,
} from "./sonicVariation.js";
import {
  canonicalAlbumJobId,
  dedupeStoredAlbumJobs,
  markAlbumMirrorDismissed,
  removeDuplicateAlbumJobs,
} from "./albumJobMirror.js";

/** @type {Map<string, Promise<void>>} */
const inflight = new Map();
/** Buffers vidéo en RAM (perdus au reload — d’où reprise via operationName). */
const memVideo = new Map();

const EXTEND_COUNT = 1;
const VEO_MAX_POLLS = 60;
const SEEDANCE_MAX_POLLS = 90;
const WAN2GP_MAX_POLLS = 1350; // ~3 h @ 8s — gen locale GPU (chargement modèle + 2 plans)

const HTTP_BOUND_TYPES = new Set(["pipeline", "step", "publish"]);
/** Aborts album in-flight (même onglet). */
const albumAborts = new Map();
/** Aborts morceau unique in-flight. */
const trackAborts = new Map();

function slimContext(ctx = {}) {
  return {
    projectId: ctx.projectId || null,
    clipId: ctx.clipId || createClipId(),
    artist: ctx.artist
      ? {
          name: ctx.artist.name,
          imageUrl: ctx.artist.imageUrl,
          mood: ctx.artist.mood,
          genre: ctx.artist.genre,
        }
      : null,
    track: ctx.track
      ? {
          title: ctx.track.title,
          audioUrl: ctx.track.audioUrl,
          bpm: ctx.track.bpm,
          mood: ctx.track.mood,
          style: ctx.track.style,
        }
      : null,
    cover: ctx.cover?.imageUrl ? { imageUrl: ctx.cover.imageUrl } : null,
    social: ctx.social
      ? {
          caption: ctx.social.caption,
          hashtags: ctx.social.hashtags,
          scenes: ctx.social.scenes,
          audioBrief: ctx.social.audioBrief,
          veo: ctx.social.veo,
        }
      : null,
    lyrics: ctx.lyrics
      ? { text: String(ctx.lyrics.text || ctx.lyrics || "").slice(0, 4000) }
      : null,
  };
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {number} startFrom index déjà atteint (reprise après navigation)
 * @param {boolean} resumeImmediate poll tout de suite si on reprend en cours
 */
async function pollVeo(operationName, { onTick, startFrom = 0 } = {}) {
  const from = Math.max(0, Math.min(VEO_MAX_POLLS - 1, Number(startFrom) || 0));
  for (let i = from; i < VEO_MAX_POLLS; i++) {
    // Reprise : 1er check immédiat ; sinon attendre entre les polls
    if (!(from > 0 && i === from)) await sleep(10_000);
    onTick?.(i);
    const poll = await api.veoShortPoll(operationName);
    if (poll?.done) return poll;
  }
  throw new Error("Timeout Veo (~10 min)");
}

async function pollSeedance(predictionId, { onTick, startFrom = 0 } = {}) {
  const from = Math.max(0, Math.min(SEEDANCE_MAX_POLLS - 1, Number(startFrom) || 0));
  for (let i = from; i < SEEDANCE_MAX_POLLS; i++) {
    if (!(from > 0 && i === from)) await sleep(8_000);
    onTick?.(i);
    const poll = await api.seedancePoll(predictionId);
    if (poll?.done && poll.videoUrl) return poll;
  }
  throw new Error("Timeout Seedance (~12 min)");
}

async function pollWan2gp(predictionId, { onTick, startFrom = 0 } = {}) {
  const from = Math.max(0, Math.min(WAN2GP_MAX_POLLS - 1, Number(startFrom) || 0));
  for (let i = from; i < WAN2GP_MAX_POLLS; i++) {
    if (!(from > 0 && i === from)) await sleep(8_000);
    onTick?.(i);
    const poll = await api.wan2gpPoll(predictionId);
    if (poll?.done && poll.videoUrl) return poll;
    if (poll?.status === "failed") {
      throw new Error(poll.error || "Wan2GP a échoué");
    }
  }
  throw new Error("Timeout Wan2GP (~3 h) — gen locale trop longue ou GPU bloqué sur Demeter.");
}

async function blobFromVeoResult(finished) {
  const src = finished.videoBase64 || finished.videoUrl;
  if (!src) throw new Error("Vidéo Veo vide");
  const res = await fetch(src);
  const raw = await res.blob();
  if (!raw?.size || raw.size < 10_000) throw new Error("Fichier Veo trop petit");
  return new Blob([raw], {
    type: raw.type?.startsWith("video/") ? raw.type : "video/mp4",
  });
}

async function muxWithTrack(veoBlob, track, social) {
  if (!track?.audioUrl) return { blob: veoBlob, muxed: false };
  const objectUrl = URL.createObjectURL(veoBlob);
  let revokeResolved = () => {};
  try {
    let beats = [];
    let cutPoints = [0];
    let bpmEstimate = track?.bpm || 100;
    try {
      const analysis = await detectBeatsFromUrl(track.audioUrl, PROMO_SHORT_SECONDS);
      beats = analysis.beats || [];
      cutPoints = pickCutPoints(beats, {
        durationSec: PROMO_SHORT_SECONDS,
        minGap: 2.4,
        maxCuts: 6,
      });
      bpmEstimate = analysis.bpmEstimate || bpmEstimate;
    } catch {
      /* ignore */
    }
    const resolved = await resolveVideoBlobUrls([objectUrl]);
    revokeResolved = resolved.revokeAll;
    const finalBlob = await assemblePromoShort({
      veoVideoUrls: resolved.urls,
      track,
      social,
      durationSec: PROMO_SHORT_SECONDS,
      beats,
      cutPoints,
      cinematic: true,
    });
    return { blob: finalBlob, muxed: true, bpmEstimate };
  } finally {
    URL.revokeObjectURL(objectUrl);
    try {
      revokeResolved();
    } catch {
      /* ignore */
    }
  }
}

async function persistClipToProject({ projectId, clipId, blob, meta }) {
  const storageKey = ensureClipStorageKey(projectId, clipId);
  let light = clipMetaOnly(meta, { id: clipId, kind: CLIP_KIND_SHORT });
  await saveClipBlob(storageKey, blob, light);

  try {
    const remote = await api.uploadClip({
      videoBlob: blob,
      projectId: storageKey,
      mimeType: light.mimeType || blob.type || "video/mp4",
    });
    light = clipMetaOnly(light, {
      videoUrl: remote.videoUrl,
      s3Key: remote.s3Key,
      storedRemote: true,
      storedLocally: true,
      byteLength: remote.byteLength,
    });
    await saveClipBlob(storageKey, blob, light);
  } catch (e) {
    light = clipMetaOnly(light, {
      warning: `${light.warning || "Clip"} · local (${e.message})`,
      storedLocally: true,
    });
  }

  if (projectId) {
    try {
      const row = await api.getProject(projectId);
      const saved = row.project || row;
      const project = normalizeProjectClips(saved.project || saved);
      const brief = light.audioBrief || project.social?.audioBrief || null;
      const next = upsertProjectClip(
        {
          ...project,
          social: project.social
            ? {
                ...project.social,
                ...(brief ? { audioBrief: brief } : {}),
                veo: {
                  ...(project.social.veo || {}),
                  provider: light.provider,
                  clipId: light.id,
                  at: light.at,
                  ...(brief ? { audioBrief: brief } : {}),
                },
              }
            : project.social,
        },
        light,
        { activate: true },
      );
      await api.saveProject({
        id: projectId,
        project: next,
        event: {
          eventType: "clip",
          stepKey: "clip",
          message: "Short généré (arrière-plan)",
        },
      });
    } catch (e) {
      console.warn("[jobRunner] save project:", e.message);
    }
  }

  return { meta: light, storageKey };
}

async function persistShotBlob(jobId, shotIndex, videoUrl) {
  const resolved = await resolveVideoBlobUrl(videoUrl);
  try {
    const res = await fetch(resolved.url);
    const blob = await res.blob();
    if (!blob?.size || blob.size < 1000) throw new Error("Plan vidéo vide");
    const storageKey = `job-shot::${jobId}::${shotIndex}`;
    await saveClipBlob(storageKey, blob, { tempShot: true, jobId, shotIndex });
    return storageKey;
  } finally {
    if (resolved.revoke) {
      try {
        URL.revokeObjectURL(resolved.url);
      } catch {
        /* ignore */
      }
    }
  }
}

async function loadShotObjectUrls(shotStorageKeys = [], videoUrls = []) {
  const objectUrls = [];
  const revokable = [];

  if (shotStorageKeys.length) {
    for (const key of shotStorageKeys) {
      const row = await loadClipBlob(key);
      if (!row?.blob) throw new Error("Plan temporaire perdu — relance le short");
      const url = URL.createObjectURL(row.blob);
      objectUrls.push(url);
      revokable.push(url);
    }
    return {
      urls: objectUrls,
      revokeAll: () => revokable.forEach((u) => URL.revokeObjectURL(u)),
    };
  }

  return resolveVideoBlobUrls(videoUrls);
}

async function cleanupShotBlobs(shotStorageKeys = []) {
  for (const key of shotStorageKeys) {
    try {
      await deleteClipBlob(key);
    } catch {
      /* ignore */
    }
  }
}

async function muxMultiShot({
  shotStorageKeys,
  videoUrls,
  track,
  social,
  shotSec,
}) {
  const resolved = await loadShotObjectUrls(shotStorageKeys, videoUrls);
  try {
    let beats = [];
    try {
      if (track?.audioUrl) {
        const analysis = await detectBeatsFromUrl(track.audioUrl, PROMO_SHORT_SECONDS);
        beats = analysis.beats || [];
      }
    } catch {
      /* ignore */
    }
    const cutPoints = (resolved.urls || []).map((_, i) => i * (shotSec || 5));
    const blob = await assemblePromoShort({
      veoVideoUrls: resolved.urls,
      track,
      social,
      durationSec: PROMO_SHORT_SECONDS,
      beats,
      cutPoints,
      cinematic: true,
    });
    return blob;
  } finally {
    resolved.revokeAll();
  }
}

/**
 * Attend la fin d’un job (sidebar / navigation OK pendant ce temps).
 */
export function waitForJob(jobId, { onUpdate } = {}) {
  return new Promise((resolve, reject) => {
    const unsub = subscribeJobs((jobs) => {
      const j = jobs.find((x) => x.id === jobId) || getJob(jobId);
      if (!j) return;
      onUpdate?.(j);
      if (j.status === "done") {
        unsub();
        resolve(j);
      } else if (j.status === "error" || j.status === "interrupted") {
        unsub();
        reject(new Error(j.message || "Job échoué"));
      }
    });
  });
}

/**
 * Après veoShortStart réussi : enregistre le job et lance le poll en fond.
 */
export function continueVeoAfterStart({
  jobId,
  started,
  context,
  label,
} = {}) {
  const id = jobId || createJobId("veo");
  const ctx = slimContext(context);
  upsertJob({
    id,
    type: "veo",
    status: "running",
    phase: "polling",
    progress: 10,
    message: started?.warning || "Veo en cours…",
    label: label || `Short Veo${ctx.track?.title ? ` · ${ctx.track.title}` : ""}`,
    projectId: ctx.projectId,
    clipId: ctx.clipId,
    href: studioHref(ctx.projectId, "clip"),
    operationName: started.operationName,
    model: started.model,
    mode: started.mode,
    prompt: started.prompt,
    usedPortrait: started.usedPortrait,
    usedCover: started.usedCover,
    audioBrief: started.audioBrief || null,
    videoUri: null,
    extendIndex: 0,
    context: ctx,
  });
  ensureRunning(id);
  return id;
}

/**
 * Orchestration multi-plans Seedance en fond (start + poll + mux).
 */
export function startSeedanceJob({
  jobId,
  context,
  audioBrief,
  shotPlan = [],
  shotSec = 5,
  shotTotal = 2,
  label,
} = {}) {
  const id = jobId || createJobId("seed");
  const ctx = slimContext(context);
  upsertJob({
    id,
    type: "seedance",
    status: "running",
    phase: "starting",
    progress: 8,
    message: "Seedance démarré — tu peux naviguer",
    label: label || `Seedance${ctx.track?.title ? ` · ${ctx.track.title}` : ""}`,
    projectId: ctx.projectId,
    clipId: ctx.clipId,
    href: studioHref(ctx.projectId, "clip"),
    predictionId: null,
    shotIndex: 0,
    shotTotal,
    shotSec,
    shotPlan,
    audioBrief: audioBrief || null,
    videoUrls: [],
    shotStorageKeys: [],
    context: ctx,
  });
  ensureRunning(id);
  return id;
}

/** @deprecated alias — préférer startSeedanceJob */
export function continueSeedanceShot(opts = {}) {
  return startSeedanceJob(opts);
}

/**
 * Orchestration multi-plans Wan2GP en fond.
 */
export function startWan2gpJob({
  jobId,
  context,
  audioBrief,
  shotPlan = [],
  shotSec = 5,
  shotTotal = 2,
  label,
} = {}) {
  const id = jobId || createJobId("wan");
  const ctx = slimContext(context);
  upsertJob({
    id,
    type: "wan2gp",
    status: "running",
    phase: "starting",
    progress: 8,
    message: "Wan2GP démarré — tu peux naviguer",
    label: label || `Wan2GP${ctx.track?.title ? ` · ${ctx.track.title}` : ""}`,
    projectId: ctx.projectId,
    clipId: ctx.clipId,
    href: studioHref(ctx.projectId, "clip"),
    predictionId: null,
    shotIndex: 0,
    shotTotal,
    shotSec,
    shotPlan,
    audioBrief: audioBrief || null,
    videoUrls: [],
    shotStorageKeys: [],
    context: ctx,
  });
  ensureRunning(id);
  return id;
}

export function trackPipelineJob({ jobId, label, projectId, message, progress } = {}) {
  const id = jobId || createJobId("pipe");
  upsertJob({
    id,
    type: "pipeline",
    status: "running",
    phase: "streaming",
    progress: progress ?? 5,
    message: message || "Pipeline A→Z…",
    label: label || "Pipeline auto",
    projectId: projectId || null,
    href: projectId ? `/?project=${projectId}` : "/",
  });
  return id;
}

/**
 * Tâche HTTP liée à la page (étape Studio, publish) — visible sidebar,
 * interrompue si navigation / reload (pas de worker serveur).
 */
export function trackStepJob({
  jobId,
  type = "step",
  label,
  projectId,
  stepKey,
  message,
  progress,
  href,
} = {}) {
  const id = jobId || createJobId(type === "publish" ? "pub" : "step");
  const stepHref =
    href ||
    (projectId && stepKey
      ? `/?project=${projectId}&step=${stepKey}`
      : projectId
        ? `/?project=${projectId}`
        : "/");
  upsertJob({
    id,
    type: type === "publish" ? "publish" : "step",
    status: "running",
    phase: "running",
    progress: progress ?? 8,
    message: message || "En cours…",
    label: label || "Tâche",
    projectId: projectId || null,
    stepKey: stepKey || null,
    href: stepHref,
  });
  return id;
}

export function finishStepJob(jobId, { ok, message, progress } = {}) {
  if (!jobId) return;
  patchJob(jobId, {
    status: ok ? "done" : "error",
    phase: ok ? "done" : "error",
    progress: ok ? (progress ?? 100) : undefined,
    message: message || (ok ? "Terminé" : "Échec"),
  });
}

export function interruptHttpBoundJob(jobId, message) {
  if (!jobId) return;
  const job = getJob(jobId);
  if (!job || job.status !== "running" || !HTTP_BOUND_TYPES.has(job.type)) return;
  // Miroir multi-appareils : ne pas couper (la gen tourne ailleurs)
  if (job.remoteAlbum) return;
  patchJob(jobId, {
    status: "interrupted",
    phase: "interrupted",
    message:
      message ||
      (job.type === "pipeline"
        ? "Pipeline interrompu (navigation). Relance Auto A→Z depuis le Studio."
        : "Tâche interrompue par la navigation — relance depuis le Studio."),
  });
}

export function finishPipelineJob(jobId, { ok, message, projectId } = {}) {
  if (!jobId) return;
  patchJob(jobId, {
    status: ok ? "done" : "error",
    phase: ok ? "done" : "error",
    progress: ok ? 100 : undefined,
    message: message || (ok ? "Pipeline terminé" : "Pipeline en erreur"),
    ...(projectId ? { projectId, href: `/?project=${projectId}` } : {}),
  });
}

export function interruptPipelineJob(jobId, message) {
  interruptHttpBoundJob(
    jobId,
    message ||
      "Pipeline interrompu (navigation). Relance Auto A→Z depuis le Studio — les tokens déjà utilisés ne sont pas récupérés.",
  );
}

export function albumJobId(projectId) {
  return `album-${projectId || "unknown"}`;
}

function interruptAlbumJobs(projectId, message = "Album arrêté") {
  if (!projectId) return;
  const canonicalId = albumJobId(projectId);
  const abort = albumAborts.get(canonicalId);
  if (abort) abort.aborted = true;

  for (const job of listActiveJobs()) {
    if (job.projectId !== projectId) continue;
    if (job.type !== "album" && !job.remoteAlbum) continue;
    const inflightAbort = albumAborts.get(job.id);
    if (inflightAbort) inflightAbort.aborted = true;
    if (job.status === "running") {
      patchJob(job.id, {
        status: "interrupted",
        phase: "interrupted",
        message,
      });
    }
  }
}

/**
 * Lance (ou reprend) la génération album en arrière-plan.
 * Survivt à la navigation MPA via localStorage + Turso.
 */
export function startAlbumJob({
  projectId,
  totalCount = 8,
  resume = false,
  href,
  label,
} = {}) {
  if (!projectId) throw new Error("projectId manquant pour l’album");
  const id = albumJobId(projectId);
  upsertJob({
    id,
    type: "album",
    status: "running",
    phase: "running",
    label: label || `Album · ${totalCount} titres`,
    message: resume ? "Reprise album…" : "Démarrage album…",
    progress: resume ? 8 : 4,
    projectId,
    totalCount,
    resume: Boolean(resume),
    href: href || studioHref(projectId, "tracks"),
    remoteAlbum: false,
  });
  ensureRunning(id);
  return id;
}

export function cancelAlbumJob(projectId) {
  interruptAlbumJobs(projectId);
}

/**
 * Arrête une tâche (y compris « running ») et la retire du dock.
 * Pour un album, persiste l’annulation Turso sinon le poll 4 s la recrée.
 */
export async function dismissJob(jobId) {
  const job = getJob(jobId);
  if (!job) return;

  if (job.type === "album" || job.remoteAlbum) {
    markAlbumMirrorDismissed(job.albumId, job.projectId);
    interruptAlbumJobs(job.projectId || null, "Album arrêté");
    if (job.projectId) {
      try {
        const { project: saved } = await api.getProject(job.projectId);
        const data = saved?.project || saved;
        const album = data?.album;
        if (album?.status === "running") {
          markAlbumMirrorDismissed(album.id, saved.id || job.projectId);
          await api.saveProject({
            id: saved.id || job.projectId,
            project: { ...data, album: cancelledAlbumState(album) },
            seed: saved.seed,
            event: {
              stepKey: "album",
              eventType: "album",
              message: "Album arrêté",
            },
          });
        }
      } catch {
        /* réseau : la carte locale part quand même */
      }
    }
    const canonical = job.projectId
      ? canonicalAlbumJobId({ id: job.albumId, jobId: job.id }, job.projectId)
      : job.id;
    removeDuplicateAlbumJobs(canonical, {
      projectId: job.projectId,
      albumId: job.albumId,
    });
    removeJob(job.id);
    if (canonical !== job.id) removeJob(canonical);
    return;
  }

  if (job.type === "track") {
    cancelMusicTrackJob(job.projectId);
    if (job.status === "running") {
      patchJob(job.id, {
        status: "interrupted",
        phase: "interrupted",
        message: "Génération audio arrêtée",
      });
    }
    removeJob(job.id);
    return;
  }

  if (job.status === "running" && HTTP_BOUND_TYPES.has(job.type) && !job.remoteAlbum) {
    interruptHttpBoundJob(job.id, "Tâche arrêtée");
  } else if (job.status === "running") {
    patchJob(job.id, {
      status: "interrupted",
      phase: "interrupted",
      message: "Tâche retirée",
    });
  }
  removeJob(jobId);
}

async function runAlbumBackgroundJob(job) {
  const id = job.id;
  const projectId = job.projectId;
  if (!projectId) throw new Error("Album sans projectId");

  const abortState = { aborted: false };
  albumAborts.set(id, abortState);

  const { project: saved } = await api.getProject(projectId);
  if (!saved?.id) throw new Error("Projet album introuvable");
  if (abortState.aborted) return;

  const project = { ...emptyProject(), ...(saved.project || {}) };
  const seed = saved.seed || {};
  const workingRef = { current: project };
  if (abortState.aborted || project.album?.status === "cancelled") {
    if (getJob(id)) {
      patchJob(id, {
        status: "interrupted",
        phase: "interrupted",
        message: "Album arrêté",
      });
    }
    return;
  }
  const resume =
    Boolean(job.resume) ||
    (project.album?.status === "running" && (project.album.tracks || []).length > 0);

  patchJob(id, {
    message: resume ? "Reprise album…" : "Album en arrière-plan…",
  });

  try {
    const result = await runAlbumJob({
      project,
      projectId,
      seed,
      totalCount: job.totalCount || project.album?.targetCount || 8,
      resume,
      abortState,
      persist: async (next, event) => {
        if (abortState.aborted) return;
        workingRef.current = next;
        await api.saveProject({
          id: projectId,
          project: next,
          seed,
          event,
        });
      },
      syncWorking: (next) => {
        workingRef.current = next;
      },
      getWorking: () => workingRef.current,
      jobId: id,
      onProgress: ({ percent, message, label }) => {
        if (abortState.aborted || !getJob(id)) return;
        patchJob(id, {
          progress: percent,
          message,
          ...(label ? { label } : {}),
        });
      },
    });
    if (getJob(id)) {
      patchJob(id, {
        status: result?.ok ? "done" : result?.providerDown ? "error" : "done",
        phase: result?.ok ? "done" : "error",
        progress: 100,
        message: result?.message || "Album terminé",
      });
    }
  } catch (e) {
    const wasAbort = e?.name === "AbortError" || abortState.aborted;
    if (getJob(id)) {
      patchJob(id, {
        status: wasAbort ? "interrupted" : "error",
        phase: wasAbort ? "interrupted" : "error",
        message: wasAbort ? "Album annulé" : e?.message || "Album en erreur",
      });
    }
    if (!wasAbort) throw e;
  } finally {
    albumAborts.delete(id);
  }
}

export function musicTrackJobId(projectId) {
  return `track-${projectId || "unknown"}`;
}

/** Évite de saturer localStorage avec le draft ACE/SongGen. */
function slimTrackDraft(draft) {
  if (!draft || typeof draft !== "object") return null;
  const { waveform: _w, audioUrl: _a, audioS3Key: _k, ...rest } = draft;
  try {
    const json = JSON.stringify(rest);
    if (json.length > 80_000) {
      return {
        isPreview: Boolean(rest.isPreview),
        status: rest.status,
        provider: rest.provider,
        bpm: rest.bpm,
        note: rest.note,
        title: rest.title,
        voiceGender: rest.voiceGender,
      };
    }
    return JSON.parse(json);
  } catch {
    return { isPreview: Boolean(draft.isPreview), status: draft.status };
  }
}

/**
 * Lance (ou reprend) un morceau unique / extrait en arrière-plan.
 * Survivt à la navigation MPA via localStorage + poll ACE/SongGen/Replicate.
 */
export function startMusicTrackJob({
  projectId,
  preview = false,
  href,
  label,
} = {}) {
  if (!projectId) throw new Error("projectId manquant pour le morceau");
  const id = musicTrackJobId(projectId);
  const existing = getJob(id);
  if (existing?.status === "running") {
    throw new Error("Une génération de morceau est déjà en cours — suis-la dans Tâches.");
  }
  upsertJob({
    id,
    type: "track",
    status: "running",
    phase: "running",
    label: label || (preview ? "Extrait audio" : "Morceau"),
    message: preview ? "Démarrage extrait…" : "Démarrage génération audio…",
    progress: 4,
    projectId,
    preview: Boolean(preview),
    generationId: null,
    musicKind: null,
    draft: null,
    href: href || studioHref(projectId, "tracks"),
  });
  ensureRunning(id);
  return id;
}

export function cancelMusicTrackJob(projectId) {
  if (!projectId) return;
  const id = musicTrackJobId(projectId);
  const abort = trackAborts.get(id);
  if (abort) abort.aborted = true;
  const job = getJob(id);
  if (job?.status === "running") {
    patchJob(id, {
      status: "interrupted",
      phase: "interrupted",
      message: "Génération audio arrêtée",
    });
  }
}

async function runTrackBackgroundJob(job) {
  const id = job.id;
  const projectId = job.projectId;
  if (!projectId) throw new Error("Morceau sans projectId");

  const abortState = { aborted: false };
  trackAborts.set(id, abortState);

  const { project: saved } = await api.getProject(projectId);
  if (!saved?.id) throw new Error("Projet introuvable pour le morceau");
  if (abortState.aborted) return;

  let project = { ...emptyProject(), ...(saved.project || {}) };
  const seed = saved.seed || {};
  const preview = Boolean(job.preview);
  const live = getJob(id) || job;

  patchJob(id, {
    message: live.generationId
      ? preview
        ? "Reprise extrait…"
        : "Reprise génération audio…"
      : preview
        ? "Extrait en arrière-plan…"
        : "Morceau en arrière-plan…",
  });

  try {
    const variation = applySonicVariation({
      musicArrange: project.musicArrange,
      styleLock: project.artist?.styleLock,
      role:
        project.sonicRole ||
        project.albumMeta?.trackRole ||
        (project.albumMeta?.index === 1 ? "single" : undefined),
      title: project.lyrics?.title || project.track?.title || "",
      artistKey: project.artist?.slug || project.artist?.name || "",
      trackIndex: project.albumMeta?.index ?? null,
      trackTotal: null,
    });
    // Fige l’arrangement / rôle sur le projet pour les régénérations cohérentes.
    project = {
      ...project,
      musicArrange: variation.musicArrange,
      sonicRole: variation.sonicRole,
    };

    let result = await api.track(
      {
        preview,
        lyrics: project.lyrics,
        artist: artistWithSonicVariation(
          {
            ...project.artist,
            featArtist: project.featArtist || null,
          },
          variation,
        ),
      },
      (p) => {
        if (!p || abortState.aborted || !getJob(id)) return;
        patchJob(id, {
          progress: Math.max(8, Math.min(96, Number(p.percent) || 12)),
          message: p.message || (preview ? "Extrait…" : "Génération audio…"),
          phase: p.phase || "running",
          model: p.model || p.modelLabel || undefined,
          modelLabel: p.modelLabel || undefined,
          gpu: p.gpu || undefined,
        });
      },
      {
        signal: abortState,
        onStarted: (started) => {
          if (!started?.generationId) return;
          try {
            patchJob(id, {
              generationId: started.generationId,
              musicKind: started.musicKind || null,
              draft: slimTrackDraft(started.draft),
              model: started.model || started.draft?.aceStepModel || undefined,
              modelLabel: started.quality || undefined,
              gpu: started.gpu || undefined,
              phase: "generating",
            });
          } catch {
            patchJob(id, {
              generationId: started.generationId,
              musicKind: started.musicKind || null,
              draft: null,
            });
          }
        },
        generationId: live.generationId || undefined,
        musicKind: live.musicKind || undefined,
        draft: live.draft || undefined,
      },
    );

    if (abortState.aborted) {
      if (getJob(id)) {
        patchJob(id, {
          status: "interrupted",
          phase: "interrupted",
          message: "Génération audio annulée",
        });
      }
      return;
    }

    if (result?.audioUrl) {
      patchJob(id, { progress: 88, message: "Persistance audio S3…" });
      try {
        const persisted = await persistAudioRemote(result.audioUrl, projectId);
        if (persisted?.audioUrl) {
          result = {
            ...result,
            audioUrl: persisted.audioUrl,
            audioS3Key: persisted.s3Key,
            audioEphemeral: false,
            warning: persisted.persisted ? undefined : result.warning,
            note: persisted.persisted
              ? `${result.note || "Audio OK"} · sauvé sur S3`
              : result.note,
          };
        }
      } catch (persistErr) {
        result = {
          ...result,
          audioEphemeral: true,
          warning:
            persistErr.message ||
            "Audio non persisté (expire ~1 h) — configure S3 ou réimporte bientôt.",
        };
      }
    }

    if (result?.isPreview || result?.status === "preview-ready") {
      result = { ...result, status: "preview-ready", isPreview: true };
    } else if (result?.audioUrl) {
      result = { ...result, status: "audio-ready", isPreview: false };
    }

    const next = stripClipsForDb(
      normalizeProjectVersions(normalizeProjectClips(appendVersion(project, "track", result))),
    );
    await api.saveProject({
      id: projectId,
      project: next,
      seed,
      event: {
        stepKey: "track",
        eventType: "step",
        message:
          result?.isPreview || result?.status === "preview-ready"
            ? "Extrait prêt — écoute le brouillon"
            : "Étape Morceau générée",
      },
    });

    // Fige le timbre depuis le nouveau morceau si le profil n’en a pas encore.
    if (
      result?.audioUrl &&
      !result?.isPreview &&
      result?.status !== "preview-ready" &&
      next?.artist?.slug
    ) {
      try {
        await api.ensureArtistTimbre(next.artist.slug, {
          force: false,
          audioUrl: result.audioUrl,
          profile: next.artist,
        });
      } catch (e) {
        console.warn("[timbre] post-track:", e?.message || e);
      }
    }

    if (abortState.aborted || !getJob(id)) return;

    if (getJob(id)) {
      patchJob(id, {
        status: "done",
        phase: "done",
        progress: 100,
        message:
          result?.isPreview || result?.status === "preview-ready"
            ? "Extrait prêt — écoute le brouillon"
            : "Morceau terminé",
        generationId: null,
        draft: null,
      });
    }
  } catch (e) {
    const wasAbort = e?.name === "AbortError" || abortState.aborted;
    if (getJob(id)) {
      patchJob(id, {
        status: wasAbort ? "interrupted" : "error",
        phase: wasAbort ? "interrupted" : "error",
        message: wasAbort ? "Génération audio annulée" : e?.message || "Morceau en erreur",
      });
    }
    if (!wasAbort) throw e;
  } finally {
    trackAborts.delete(id);
  }
}

function ensureRunning(jobId) {
  if (!jobId || inflight.has(jobId)) return;
  const p = runJob(jobId).finally(() => inflight.delete(jobId));
  inflight.set(jobId, p);
}

async function runJob(jobId) {
  const job = getJob(jobId);
  if (!job || job.status !== "running") return;

  try {
    if (job.type === "veo") await runVeoJob(job);
    else if (job.type === "seedance") await runSeedanceJob(job);
    else if (job.type === "wan2gp") await runWan2gpJob(job);
    else if (job.type === "album") await runAlbumBackgroundJob(job);
    else if (job.type === "track") await runTrackBackgroundJob(job);
  } catch (e) {
    if (!getJob(jobId)) return;
    patchJob(jobId, {
      status: "error",
      phase: "error",
      message: e?.message || "Échec du job",
    });
    memVideo.delete(jobId);
    try {
      await cleanupShotBlobs(job.shotStorageKeys || getJob(jobId)?.shotStorageKeys || []);
    } catch {
      /* ignore */
    }
  }
}

async function runVeoJob(job) {
  const id = job.id;
  let operationName = job.operationName;
  let videoUri = job.videoUri || null;
  let model = job.model || "veo-3.1-generate-preview";
  let extendsDone = job.extendsDone || 0;
  let finished = memVideo.get(id)?.finished || null;
  const wasExtending = job.phase === "extending";

  if (!operationName) throw new Error("operationName manquant — relance le short");

  const veoPollFrom = Math.max(0, Number(job.pollCount) || 0);
  patchJob(id, {
    phase: wasExtending ? "extending" : "polling",
    message:
      veoPollFrom > 0
        ? `Reprise Veo (poll ${veoPollFrom}/${VEO_MAX_POLLS})…`
        : "Attente Veo (arrière-plan)…",
  });

  finished = await pollVeo(operationName, {
    startFrom: veoPollFrom,
    onTick: (i) => {
      patchJob(id, {
        pollCount: i + 1,
        progress: Math.min(55, 12 + Math.round(((i + 1) / VEO_MAX_POLLS) * 40)),
        message: `Veo… poll ${i + 1}/${VEO_MAX_POLLS}`,
      });
    },
  });
  videoUri = finished.videoUri || videoUri;
  memVideo.set(id, { finished, videoUri });

  if (wasExtending) {
    extendsDone = Math.max(extendsDone + 1, 1);
    patchJob(id, { extendsDone, videoUri });
  }

  while (extendsDone < EXTEND_COUNT) {
    try {
      patchJob(id, {
        phase: "extending",
        progress: 58 + extendsDone * 10,
        message: `Extension Veo ${extendsDone + 1}/${EXTEND_COUNT}…`,
        videoUri,
      });
      const ctx = job.context || {};
      const ext = await api.veoShortExtend({
        videoUri,
        videoBase64: videoUri ? undefined : finished.videoBase64 || finished.videoUrl,
        model,
        social: ctx.social,
      });
      patchJob(id, { operationName: ext.operationName, phase: "extending", pollCount: 0 });
      finished = await pollVeo(ext.operationName, {
        startFrom: 0,
        onTick: (i) => {
          patchJob(id, {
            pollCount: i + 1,
            progress: Math.min(75, 60 + Math.round(((i + 1) / VEO_MAX_POLLS) * 12)),
            message: `Extension ${extendsDone + 1}… poll ${i + 1}/${VEO_MAX_POLLS}`,
          });
        },
      });
      videoUri = finished.videoUri || videoUri;
      extendsDone += 1;
      memVideo.set(id, { finished, videoUri });
      patchJob(id, { extendsDone, videoUri, operationName: ext.operationName, pollCount: 0 });
    } catch (extErr) {
      console.warn("[jobRunner] extend skip:", extErr.message);
      break;
    }
  }

  patchJob(id, { phase: "muxing", progress: 78, message: "Montage audio…" });
  const veoBlob = await blobFromVeoResult(finished);
  const ctx = job.context || {};
  const { blob, muxed, bpmEstimate } = await muxWithTrack(veoBlob, ctx.track, ctx.social);

  patchJob(id, { phase: "saving", progress: 92, message: "Sauvegarde clip…" });
  const provider =
    job.mode === "i2v" || job.mode === "refs"
      ? `${model}+mux`
      : `${model}-${job.mode || "gen"}+mux`;
  const meta = {
    id: job.clipId || createClipId(),
    kind: CLIP_KIND_SHORT,
    provider: muxed ? provider : `${model}+direct`,
    usedPortrait: job.usedPortrait,
    usedCover: job.usedCover,
    warning: muxed
      ? `1080×1920 · mux${bpmEstimate ? ` · ~${bpmEstimate} BPM` : ""} · fond`
      : "MP4 Veo (sans mux)",
    isVeo: true,
    durationSec: PROMO_SHORT_SECONDS,
    mimeType: blob.type || "video/mp4",
    publishMimeType: /mp4/i.test(blob.type || "") ? "video/mp4" : blob.type,
    muxed,
    prompt: job.prompt,
    mode: job.mode,
    audioBrief: job.audioBrief || null,
    at: new Date().toISOString(),
    storedLocally: true,
  };

  await persistClipToProject({
    projectId: job.projectId,
    clipId: meta.id,
    blob,
    meta,
  });

  memVideo.delete(id);
  patchJob(id, {
    status: "done",
    phase: "done",
    progress: 100,
    message: "Short prêt — ouvre Clips pour le voir",
    operationName: null,
  });
}

async function runMultiShotProviderJob(job, { provider, startShot, pollShot, maxPolls, providerLabel }) {
  const id = job.id;
  const ctx = job.context || {};
  const shotTotal = job.shotTotal || 2;
  const shotSec = job.shotSec || 5;
  let shotIndex = job.shotIndex || 0;
  let predictionId = job.predictionId || null;
  let videoUrls = [...(job.videoUrls || [])];
  let shotStorageKeys = [...(job.shotStorageKeys || [])];
  let audioBrief = job.audioBrief || null;

  while (shotIndex < shotTotal) {
    // Reprise : si le plan est déjà en IDB, passer au suivant
    if (!predictionId && shotStorageKeys[shotIndex]) {
      shotIndex += 1;
      patchJob(id, { shotIndex, predictionId: null, pollCount: 0 });
      continue;
    }

    if (!predictionId) {
      patchJob(id, {
        phase: "starting_shot",
        message: `${provider} plan ${shotIndex + 1}/${shotTotal}… démarrage`,
        progress: 10 + shotIndex * Math.floor(70 / shotTotal),
        pollCount: 0,
      });
      const started = await startShot({
        shotIndex,
        shotSec,
        audioBrief,
        shotBrief: job.shotPlan?.[shotIndex] || null,
        ctx,
      });
      if (started?.audioBrief) {
        audioBrief = started.audioBrief;
        patchJob(id, { audioBrief });
      }
      if (!started?.predictionId) throw new Error(`${provider} sans predictionId`);
      predictionId = started.predictionId;
      patchJob(id, { predictionId, phase: "polling", shotIndex, pollCount: 0 });
    }

    // Reprise navigation : continuer le compteur (pas repartir à 1/1350)
    const live = getJob(id);
    const startFrom = Math.max(0, Number(live?.pollCount) || 0);
    if (startFrom > 0) {
      patchJob(id, {
        phase: "polling",
        message: `${provider} reprise · poll ${startFrom}/${maxPolls}`,
      });
    }

    const done = await pollShot(predictionId, {
      startFrom,
      onTick: (i) => {
        const span = Math.floor(70 / shotTotal);
        const base = 10 + shotIndex * span;
        patchJob(id, {
          pollCount: i + 1,
          progress: Math.min(base + span - 2, base + Math.round(((i + 1) / maxPolls) * (span - 2))),
          message: `${provider} plan ${shotIndex + 1}/${shotTotal} · poll ${i + 1}/${maxPolls}`,
        });
      },
    });
    if (!done?.videoUrl) throw new Error(`Plan ${shotIndex + 1} sans URL vidéo`);

    patchJob(id, {
      phase: "saving_shot",
      message: `Sauvegarde plan ${shotIndex + 1}/${shotTotal}…`,
      pollCount: 0,
    });
    const storageKey = await persistShotBlob(id, shotIndex, done.videoUrl);
    shotStorageKeys = [...shotStorageKeys.slice(0, shotIndex), storageKey];
    videoUrls = [...videoUrls.slice(0, shotIndex), done.videoUrl];
    shotIndex += 1;
    predictionId = null;
    patchJob(id, {
      shotIndex,
      predictionId: null,
      videoUrls,
      shotStorageKeys,
      pollCount: 0,
      progress: 10 + shotIndex * Math.floor(70 / shotTotal),
      message:
        shotIndex < shotTotal
          ? `Plan ${shotIndex}/${shotTotal} OK`
          : "Plans OK — montage…",
    });
  }

  patchJob(id, { phase: "muxing", progress: 85, message: `Montage ${provider}…` });
  const blob = await muxMultiShot({
    shotStorageKeys,
    videoUrls,
    track: ctx.track,
    social: ctx.social,
    shotSec,
  });

  patchJob(id, { phase: "saving", progress: 92, message: "Sauvegarde clip…" });
  const meta = {
    id: job.clipId || createClipId(),
    kind: CLIP_KIND_SHORT,
    provider: providerLabel,
    warning: `${provider} · job fond · ${shotTotal} plans`,
    durationSec: PROMO_SHORT_SECONDS,
    mimeType: blob.type || "video/mp4",
    publishMimeType: /mp4/i.test(blob.type || "") ? "video/mp4" : blob.type,
    muxed: true,
    audioBrief: audioBrief || null,
    at: new Date().toISOString(),
    storedLocally: true,
    mode: `${provider.toLowerCase()}-short-shots`,
    shots: shotTotal,
    shotSec,
  };

  await persistClipToProject({
    projectId: job.projectId,
    clipId: meta.id,
    blob,
    meta,
  });

  await cleanupShotBlobs(shotStorageKeys);
  patchJob(id, {
    status: "done",
    phase: "done",
    progress: 100,
    message: `Short ${provider} prêt — ouvre Clips`,
    predictionId: null,
    shotStorageKeys: [],
  });
}

async function runSeedanceJob(job) {
  await runMultiShotProviderJob(job, {
    provider: "Seedance",
    providerLabel: "seedance-2.0+mux",
    maxPolls: SEEDANCE_MAX_POLLS,
    pollShot: pollSeedance,
    startShot: async ({ shotIndex, shotSec, audioBrief, shotBrief, ctx }) => {
      if (!ctx.track?.audioUrl) throw new Error("Audio du morceau requis");
      const excerpt = await extractTrackExcerpt(
        ctx.track.audioUrl,
        shotSec,
        shotIndex * shotSec,
      );
      return api.seedanceStart({
        artist: ctx.artist,
        track: ctx.track,
        social: ctx.social,
        lyrics: ctx.lyrics,
        audioBrief,
        audioExcerptBase64: excerpt.base64,
        audioExcerptMimeType: excerpt.mimeType,
        shotIndex,
        shotBrief,
        projectId: ctx.projectId,
        duration: shotSec,
      });
    },
  });
}

async function runWan2gpJob(job) {
  await runMultiShotProviderJob(job, {
    provider: "Wan2GP",
    providerLabel: "wan2gp+mux",
    maxPolls: WAN2GP_MAX_POLLS,
    pollShot: pollWan2gp,
    startShot: async ({ shotIndex, audioBrief, shotBrief, ctx }) => {
      return api.wan2gpStart({
        artist: ctx.artist,
        track: ctx.track,
        social: ctx.social,
        lyrics: ctx.lyrics,
        audioBrief,
        shotIndex,
        shotBrief,
        projectId: ctx.projectId,
      });
    },
  });
}

/** Au chargement de chaque page : reprend les jobs running. */
export function resumeAllJobs() {
  for (const job of listActiveJobs()) {
    if (job.remoteAlbum) continue;
    if (HTTP_BOUND_TYPES.has(job.type)) {
      interruptHttpBoundJob(
        job.id,
        job.type === "pipeline"
          ? "Pipeline coupé par la navigation. Relance Auto A→Z — évite de quitter le Studio pendant ce run."
          : "Tâche coupée par la navigation — relance depuis le Studio.",
      );
      continue;
    }
    if (job.type === "veo") {
      if (job.operationName) ensureRunning(job.id);
      else {
        patchJob(job.id, {
          status: "error",
          message: "Job Veo sans opération — relance le short",
        });
      }
      continue;
    }
    if (job.type === "seedance" || job.type === "wan2gp") {
      ensureRunning(job.id);
      continue;
    }
    if (job.type === "album") {
      if (job.projectId) ensureRunning(job.id);
      continue;
    }
    if (job.type === "track") {
      if (job.projectId) ensureRunning(job.id);
      continue;
    }
  }
}

let booted = false;
export function bootJobRunner() {
  if (typeof window === "undefined" || booted) return;
  booted = true;
  dedupeStoredAlbumJobs();
  resumeAllJobs();
  window.addEventListener("pagehide", () => {
    for (const job of listActiveJobs()) {
      if (HTTP_BOUND_TYPES.has(job.type)) interruptHttpBoundJob(job.id);
      // album / morceau / clips : le runner reprend au prochain chargement
    }
  });
}
