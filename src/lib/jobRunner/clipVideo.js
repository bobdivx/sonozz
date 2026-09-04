import { api } from "../apiClient.js";
import {
  clipMetaOnly,
  deleteClipBlob,
  ensureClipStorageKey,
  loadClipBlob,
  saveClipBlob,
} from "../clipStore.js";
import {
  CLIP_KIND_SHORT,
  createClipId,
  upsertProjectClip,
  normalizeProjectClips,
} from "../clipsModel.js";
import { assemblePromoShort, PROMO_SHORT_SECONDS } from "../assemblePromoShort.js";
import { detectBeatsFromUrl, pickCutPoints } from "../beatDetect.js";
import { resolveVideoBlobUrl, resolveVideoBlobUrls } from "../videoResolve.js";

export async function blobFromVeoResult(finished) {
  const src = finished.videoBase64 || finished.videoUrl;
  if (!src) throw new Error("Vidéo Veo vide");
  const res = await fetch(src);
  const raw = await res.blob();
  if (!raw?.size || raw.size < 10_000) throw new Error("Fichier Veo trop petit");
  return new Blob([raw], {
    type: raw.type?.startsWith("video/") ? raw.type : "video/mp4",
  });
}

export async function muxWithTrack(veoBlob, track, social) {
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

export async function persistClipToProject({ projectId, clipId, blob, meta }) {
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

export async function persistShotBlob(jobId, shotIndex, videoUrl) {
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

export async function loadShotObjectUrls(shotStorageKeys = [], videoUrls = []) {
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

export async function cleanupShotBlobs(shotStorageKeys = []) {
  for (const key of shotStorageKeys) {
    try {
      await deleteClipBlob(key);
    } catch {
      /* ignore */
    }
  }
}

export async function muxMultiShot({
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
