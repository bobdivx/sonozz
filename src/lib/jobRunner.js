/**
 * Runner d’arrière-plan : reprend les polls Veo/Seedance après navigation.
 * Ne stocke PAS les bytes vidéo dans localStorage (trop gros) — mémoire session + IDB.
 */

import { api } from "./apiClient.js";
import {
  createJobId,
  getJob,
  listActiveJobs,
  patchJob,
  upsertJob,
} from "./jobStore.js";
import {
  clipMetaOnly,
  ensureClipStorageKey,
  saveClipBlob,
} from "./clipStore.js";
import {
  CLIP_KIND_SHORT,
  createClipId,
  upsertProjectClip,
  normalizeProjectClips,
} from "./clipsModel.js";
import { assemblePromoShort, PROMO_SHORT_SECONDS } from "./assemblePromoShort.js";
import { detectBeatsFromUrl, pickCutPoints } from "./beatDetect.js";
import { resolveVideoBlobUrls } from "./videoResolve.js";

/** @type {Map<string, Promise<void>>} */
const inflight = new Map();
/** Buffers vidéo en RAM (perdus au reload — d’où reprise via operationName). */
const memVideo = new Map();

const EXTEND_COUNT = 1;
const VEO_MAX_POLLS = 60;
const SEEDANCE_MAX_POLLS = 90;

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

async function pollVeo(operationName, { onTick, safePrompt = false } = {}) {
  for (let i = 0; i < VEO_MAX_POLLS; i++) {
    await sleep(10_000);
    onTick?.(i);
    const poll = await api.veoShortPoll(operationName);
    if (poll?.done) return poll;
  }
  throw new Error("Timeout Veo (~10 min)");
}

async function pollSeedance(predictionId, { onTick } = {}) {
  for (let i = 0; i < SEEDANCE_MAX_POLLS; i++) {
    await sleep(8_000);
    onTick?.(i);
    const poll = await api.seedancePoll(predictionId);
    if (poll?.done && poll.videoUrl) return poll;
  }
  throw new Error("Timeout Seedance (~12 min)");
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
    href: ctx.projectId ? `/?project=${ctx.projectId}&step=7` : "/?step=7",
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

export function continueSeedanceShot({
  jobId,
  predictionId,
  shotIndex = 0,
  shotTotal = 2,
  context,
  label,
  videoUrls = [],
} = {}) {
  const id = jobId || createJobId("seed");
  const ctx = slimContext(context);
  upsertJob({
    id,
    type: "seedance",
    status: "running",
    phase: "polling",
    progress: 15 + shotIndex * 30,
    message: `Seedance plan ${shotIndex + 1}/${shotTotal}…`,
    label: label || `Seedance${ctx.track?.title ? ` · ${ctx.track.title}` : ""}`,
    projectId: ctx.projectId,
    clipId: ctx.clipId,
    href: ctx.projectId ? `/?project=${ctx.projectId}&step=7` : "/?step=7",
    predictionId,
    shotIndex,
    shotTotal,
    videoUrls,
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
  if (!jobId) return;
  const job = getJob(jobId);
  if (!job || job.status !== "running" || job.type !== "pipeline") return;
  patchJob(jobId, {
    status: "interrupted",
    phase: "interrupted",
    message:
      message ||
      "Pipeline interrompu (navigation). Relance Auto A→Z depuis le Studio — les tokens déjà utilisés ne sont pas récupérés.",
  });
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
  } catch (e) {
    patchJob(jobId, {
      status: "error",
      phase: "error",
      message: e?.message || "Échec du job",
    });
    memVideo.delete(jobId);
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

  patchJob(id, {
    phase: wasExtending ? "extending" : "polling",
    message: "Attente Veo (arrière-plan)…",
  });

  finished = await pollVeo(operationName, {
    onTick: (i) => {
      patchJob(id, {
        progress: Math.min(55, 12 + Math.round(((i + 1) / VEO_MAX_POLLS) * 40)),
        message: `Veo… poll ${i + 1}/${VEO_MAX_POLLS}`,
      });
    },
  });
  videoUri = finished.videoUri || videoUri;
  memVideo.set(id, { finished, videoUri });

  // Reprise au milieu d’une extension : ce poll = l’extend en cours
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
      patchJob(id, { operationName: ext.operationName, phase: "extending" });
      finished = await pollVeo(ext.operationName, {
        safePrompt: true,
        onTick: (i) => {
          patchJob(id, {
            progress: Math.min(75, 60 + Math.round(((i + 1) / VEO_MAX_POLLS) * 12)),
            message: `Extension ${extendsDone + 1}… poll ${i + 1}`,
          });
        },
      });
      videoUri = finished.videoUri || videoUri;
      extendsDone += 1;
      memVideo.set(id, { finished, videoUri });
      patchJob(id, { extendsDone, videoUri, operationName: ext.operationName });
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

async function runSeedanceJob(job) {
  const id = job.id;
  if (!job.predictionId) throw new Error("predictionId manquant");

  patchJob(id, { message: `Seedance poll plan ${(job.shotIndex || 0) + 1}…` });
  const done = await pollSeedance(job.predictionId, {
    onTick: (i) => {
      const base = 15 + (job.shotIndex || 0) * 30;
      patchJob(id, {
        progress: Math.min(base + 25, base + Math.round(((i + 1) / SEEDANCE_MAX_POLLS) * 25)),
        message: `Seedance… poll ${i + 1}/${SEEDANCE_MAX_POLLS}`,
      });
    },
  });

  const urls = [...(job.videoUrls || []), done.videoUrl].filter(Boolean);
  const shotIndex = (job.shotIndex || 0) + 1;
  const shotTotal = job.shotTotal || 2;

  if (shotIndex < shotTotal) {
    // Les plans suivants sont encore démarrés depuis ClipStep ; on marque en attente
    patchJob(id, {
      phase: "await_next_shot",
      progress: 15 + shotIndex * 35,
      message: `Plan ${shotIndex}/${shotTotal} OK — retourne à Clips pour la suite (ou relance)`,
      videoUrls: urls,
      predictionId: null,
      status: "running",
    });
    // Ne pas auto-finir : Seedance multi-shot reste orchestré par ClipStep pour l’instant
    // mais le poll de CE plan a survécu à la nav
    patchJob(id, {
      status: "done",
      phase: "shot_done",
      progress: Math.round((shotIndex / shotTotal) * 90),
      message: `Plan ${shotIndex}/${shotTotal} prêt (URL sauvée). Rouvre Clips pour enchaîner.`,
      videoUrls: urls,
    });
    return;
  }

  // Dernier plan : mux + save
  patchJob(id, { phase: "muxing", progress: 85, message: "Montage Seedance…" });
  const ctx = job.context || {};
  const resolved = await resolveVideoBlobUrls(urls);
  try {
    let beats = [];
    let cutPoints = urls.map((_, i) => i * 5);
    try {
      const analysis = await detectBeatsFromUrl(ctx.track.audioUrl, PROMO_SHORT_SECONDS);
      beats = analysis.beats || [];
    } catch {
      /* ignore */
    }
    const blob = await assemblePromoShort({
      veoVideoUrls: resolved.urls,
      track: ctx.track,
      social: ctx.social,
      durationSec: PROMO_SHORT_SECONDS,
      beats,
      cutPoints,
      cinematic: true,
    });
    const meta = {
      id: job.clipId || createClipId(),
      kind: CLIP_KIND_SHORT,
      provider: "seedance-2.0+mux",
      warning: "Seedance · job fond",
      durationSec: PROMO_SHORT_SECONDS,
      mimeType: blob.type || "video/mp4",
      publishMimeType: /mp4/i.test(blob.type || "") ? "video/mp4" : blob.type,
      muxed: true,
      at: new Date().toISOString(),
      storedLocally: true,
    };
    await persistClipToProject({
      projectId: job.projectId,
      clipId: meta.id,
      blob,
      meta,
    });
    patchJob(id, {
      status: "done",
      phase: "done",
      progress: 100,
      message: "Short Seedance prêt",
    });
  } finally {
    resolved.revokeAll();
  }
}

/** Au chargement de chaque page : reprend les jobs running. */
export function resumeAllJobs() {
  for (const job of listActiveJobs()) {
    if (job.type === "pipeline") {
      // Le stream HTTP ne survit pas au reload
      interruptPipelineJob(
        job.id,
        "Pipeline coupé par la navigation. Relance Auto A→Z — évite de quitter le Studio pendant ce run.",
      );
      continue;
    }
    if (job.type === "veo" && job.operationName) {
      ensureRunning(job.id);
    } else if (job.type === "seedance" && job.predictionId) {
      ensureRunning(job.id);
    } else if (job.type === "veo") {
      patchJob(job.id, {
        status: "error",
        message: "Job Veo sans opération — relance le short",
      });
    }
  }
}

let booted = false;
export function bootJobRunner() {
  if (typeof window === "undefined" || booted) return;
  booted = true;
  resumeAllJobs();
  window.addEventListener("pagehide", () => {
    for (const job of listActiveJobs()) {
      if (job.type === "pipeline") interruptPipelineJob(job.id);
    }
  });
}
