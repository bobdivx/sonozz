import { api } from "../apiClient.js";
import { createJobId, getJob, patchJob, upsertJob } from "../jobStore.js";
import { extractTrackExcerpt } from "../audioExcerpt.js";
import { CLIP_KIND_SHORT, createClipId } from "../clipsModel.js";
import { studioHref } from "../studio.js";
import { slimContext } from "./helpers.js";
import { pollVeo, pollSeedance, pollWan2gp } from "./polls.js";
import {
  blobFromVeoResult,
  muxWithTrack,
  muxMultiShot,
  persistClipToProject,
  persistShotBlob,
  cleanupShotBlobs,
} from "./clipVideo.js";
import {
  memVideo,
  EXTEND_COUNT,
  VEO_MAX_POLLS,
  SEEDANCE_MAX_POLLS,
  WAN2GP_MAX_POLLS,
} from "./state.js";
import { ensureRunning } from "./runnerCore.js";
import { PROMO_SHORT_SECONDS } from "../assemblePromoShort.js";

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

export async function runVeoJob(job) {
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

export async function runMultiShotProviderJob(job, { provider, startShot, pollShot, maxPolls, providerLabel }) {
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

export async function runSeedanceJob(job) {
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

export async function runWan2gpJob(job) {
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
