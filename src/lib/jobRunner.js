/**
 * Runner d’arrière-plan : reprend les polls Veo/Seedance/Wan2GP après navigation.
 * Ne stocke PAS les bytes vidéo dans localStorage (trop gros) — mémoire session + IDB.
 */

import { api } from "./apiClient.js";
import {
  createJobId,
  getJob,
  listActiveJobs,
  patchJob,
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
} from "./clipsModel.js";
import { assemblePromoShort, PROMO_SHORT_SECONDS } from "./assemblePromoShort.js";
import { detectBeatsFromUrl, pickCutPoints } from "./beatDetect.js";
import { resolveVideoBlobUrl, resolveVideoBlobUrls } from "./videoResolve.js";
import { extractTrackExcerpt } from "./audioExcerpt.js";

/** @type {Map<string, Promise<void>>} */
const inflight = new Map();
/** Buffers vidéo en RAM (perdus au reload — d’où reprise via operationName). */
const memVideo = new Map();

const EXTEND_COUNT = 1;
const VEO_MAX_POLLS = 60;
const SEEDANCE_MAX_POLLS = 90;
const WAN2GP_MAX_POLLS = 1350; // ~3 h @ 8s — gen locale GPU (chargement modèle + 2 plans)

const HTTP_BOUND_TYPES = new Set(["pipeline", "step", "publish"]);

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
    href: ctx.projectId ? `/?project=${ctx.projectId}&step=7` : "/?step=7",
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
    href: ctx.projectId ? `/?project=${ctx.projectId}&step=7` : "/?step=7",
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
  } catch (e) {
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
      if (HTTP_BOUND_TYPES.has(job.type)) interruptHttpBoundJob(job.id);
    }
  });
}
