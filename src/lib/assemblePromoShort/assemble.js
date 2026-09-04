import { resolveAudioAsset } from "../audioResolve.js";
import { loadVideo, waitForDecodableFrame, loadAudio } from "./media.js";
import {
  wrapText,
  nearestBeatDelta,
  activeShotIndex,
  drawCinematicOverlay,
  drawScene,
} from "./draw.js";

export const PROMO_SHORT_SECONDS = 28;
const W = 1080;
const H = 1920;
const FPS = 30;
const CTA_SECONDS = 3.5;

/**
 * @param {object} opts
 * @param {string} [opts.veoVideoUrl] — un seul plan
 * @param {string[]} [opts.veoVideoUrls] — multi-plans
 * @param {number[]} [opts.beats]
 * @param {number[]} [opts.cutPoints]
 * @param {boolean} [opts.cinematic=true]
 */
export async function assemblePromoShort({
  veoVideoUrl,
  veoVideoUrls,
  track,
  artist,
  social,
  durationSec = PROMO_SHORT_SECONDS,
  beats = [],
  cutPoints,
  cinematic = true,
  onProgress,
} = {}) {
  const urls = (veoVideoUrls?.length ? veoVideoUrls : veoVideoUrl ? [veoVideoUrl] : []).filter(Boolean);
  if (!urls.length) throw new Error("Vidéo manquante pour le montage");
  if (!track?.audioUrl) throw new Error("Audio du morceau requis pour le short");

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false });

  const videos = [];
  for (const url of urls) {
    const v = await loadVideo(url);
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    await waitForDecodableFrame(v);
    videos.push(v);
  }
  await new Promise((r) => setTimeout(r, 100));
  for (const v of videos) {
    if (v.paused) await v.play().catch(() => {});
    if (v.readyState < 2 || !v.videoWidth) {
      await waitForDecodableFrame(v);
    }
  }

  const cuts =
    cutPoints?.length >= 2
      ? cutPoints
      : urls.length > 1
        ? Array.from({ length: urls.length }, (_, i) => (i * durationSec) / urls.length)
        : [0];

  const stream = canvas.captureStream(FPS);

  // Résout l’audio (proxy si lien Replicate / CORS)
  let audioAsset = null;
  let audioEl;
  try {
    audioAsset = await resolveAudioAsset(track.audioUrl);
    audioEl = await loadAudio(audioAsset.objectUrl);
  } catch (e) {
    throw new Error(
      e.message ||
        "Impossible de charger l’audio du morceau — régénère ou réimporte à l’étape Morceaux.",
    );
  }
  audioEl.currentTime = 0;
  const audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
  const source = audioCtx.createMediaElementSource(audioEl);
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(dest);
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

  const mime = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find((t) => MediaRecorder.isTypeSupported(t));
  if (!mime) throw new Error("MediaRecorder non supporté — utilise Chrome/Edge.");

  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 10_000_000,
  });
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data?.size) chunks.push(e.data);
  };
  const container = mime.startsWith("video/mp4") ? "video/mp4" : "video/webm";
  const done = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: container }));
    recorder.onerror = () => reject(new Error("Échec montage short"));
  });

  let lastShot = -1;
  /** Aligne chaque plan sur le temps global audio (cut local), pas un reset à 0. */
  const syncShotPlayback = (t) => {
    const idx = activeShotIndex(t, cuts, videos.length);
    const cutStart = cuts[Math.min(idx, cuts.length - 1)] ?? 0;
    const localT = Math.max(0, t - cutStart);
    const v = videos[idx];
    const seekSafe = (video, time) => {
      try {
        const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
        const target = dur != null ? Math.min(Math.max(0, time), Math.max(0, dur - 0.05)) : time;
        video.currentTime = target;
      } catch {
        /* ignore */
      }
    };

    if (idx !== lastShot) {
      seekSafe(v, localT);
      v.play().catch(() => {});
      lastShot = idx;
    } else if (v) {
      // Corrige la dérive sans seek permanent
      if (Number.isFinite(v.currentTime) && Math.abs(v.currentTime - localT) > 0.45) {
        seekSafe(v, localT);
      }
      if (v.paused || v.ended) {
        seekSafe(v, localT);
        v.play().catch(() => {});
      }
    }
  };

  drawScene(ctx, {
    videos,
    cutPoints: cuts,
    beats,
    inCta: false,
    t: 0,
    durationSec,
    artist,
    track,
    social,
    cinematic,
  });

  recorder.start(100);
  await audioEl.play().catch(() => {});
  syncShotPlayback(0);

  const startedAt = performance.now();
  const ctaStart = durationSec - CTA_SECONDS;
  const lead = videos[0];
  const useRvfc = typeof lead.requestVideoFrameCallback === "function";

  await new Promise((resolve, reject) => {
    let frames = 0;
    const paint = (now) => {
      try {
        const elapsed = (now - startedAt) / 1000;
        if (elapsed >= durationSec) {
          syncShotPlayback(durationSec);
          drawScene(ctx, {
            videos,
            cutPoints: cuts,
            beats,
            inCta: true,
            t: durationSec,
            durationSec,
            artist,
            track,
            social,
            cinematic,
          });
          onProgress?.(100);
          resolve();
          return;
        }

        syncShotPlayback(elapsed);
        drawScene(ctx, {
          videos,
          cutPoints: cuts,
          beats,
          inCta: elapsed >= ctaStart,
          t: elapsed,
          durationSec,
          artist,
          track,
          social,
          cinematic,
        });
        frames += 1;
        onProgress?.(Math.min(99, Math.round((elapsed / durationSec) * 100)));

        const active = videos[activeShotIndex(elapsed, cuts, videos.length)] || lead;
        if (useRvfc && typeof active.requestVideoFrameCallback === "function") {
          active.requestVideoFrameCallback(() => paint(performance.now()));
        } else {
          requestAnimationFrame(paint);
        }
      } catch (err) {
        reject(err);
      }
    };

    if (useRvfc) {
      lead.requestVideoFrameCallback(() => paint(performance.now()));
    } else {
      requestAnimationFrame(paint);
    }

    setTimeout(() => {
      if (frames < 5) reject(new Error("Montage figé (pas assez de frames vidéo)"));
    }, 2500);
  });

  await new Promise((r) => setTimeout(r, 120));
  if (recorder.state !== "inactive") recorder.stop();
  audioEl.pause();
  videos.forEach((v) => v.pause());
  await audioCtx.close().catch(() => {});
  if (audioAsset?.objectUrl) URL.revokeObjectURL(audioAsset.objectUrl);

  const blob = await done;
  if (!blob?.size || blob.size < 50_000) {
    throw new Error("Montage vidéo trop léger / figé — réessaie la génération");
  }
  return blob;
}

