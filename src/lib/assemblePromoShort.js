/**
 * Montage short 9:16 cinéma :
 * multi-plans vidéo + audio réel du morceau + coupes / punchs sur les beats.
 */

import { resolveAudioAsset } from "./audioResolve.js";

const W = 1080;
const H = 1920;
const FPS = 30;
export const PROMO_SHORT_SECONDS = 28;
const CTA_SECONDS = 3.5;

function loadVideo(src) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    // blob:/data: = same-origin → pas de CORS. Remote + crossOrigin casse Replicate.
    if (/^https?:\/\//i.test(src)) {
      v.crossOrigin = "anonymous";
    }
    let settled = false;
    const fail = (why) => {
      if (settled) return;
      settled = true;
      reject(new Error(why || "Impossible de charger une piste vidéo"));
    };
    const ok = () => {
      if (settled) return;
      if (!v.videoWidth || !v.videoHeight) return;
      settled = true;
      resolve(v);
    };
    const timer = setTimeout(() => fail("Timeout chargement vidéo (métadonnées)"), 20000);
    const wrapOk = () => {
      clearTimeout(timer);
      ok();
    };
    v.onloadedmetadata = wrapOk;
    v.onloadeddata = wrapOk;
    v.oncanplay = wrapOk;
    v.onerror = () => {
      clearTimeout(timer);
      fail("Erreur décodage vidéo (CORS ou fichier invalide)");
    };
    v.src = src;
    v.load();
  });
}

/** Attend une frame décodée avant le premier drawImage (évite « Frame indisponible »). */
async function waitForDecodableFrame(video, { timeoutMs = 12000 } = {}) {
  if (!video) throw new Error("Vidéo manquante");
  video.muted = true;
  video.playsInline = true;
  try {
    video.currentTime = 0;
  } catch {
    /* ignore */
  }
  await video.play().catch(() => {});

  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (video.videoWidth > 0 && video.readyState >= 2) {
      // petit seek pour forcer un decode
      try {
        if (video.currentTime < 0.05 && Number.isFinite(video.duration) && video.duration > 0.2) {
          await new Promise((resolve) => {
            const done = () => {
              video.removeEventListener("seeked", done);
              resolve();
            };
            video.addEventListener("seeked", done);
            try {
              video.currentTime = 0.08;
            } catch {
              resolve();
            }
            setTimeout(resolve, 400);
          });
        }
      } catch {
        /* ignore */
      }
      if (video.readyState >= 2) return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    "Frame vidéo indisponible — le plan n’a pas pu être décodé (souvent CORS Replicate). Réessaie.",
  );
}

function loadAudio(src) {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.crossOrigin = "anonymous";
    a.preload = "auto";
    let settled = false;
    const ok = () => {
      if (settled) return;
      settled = true;
      resolve(a);
    };
    a.oncanplaythrough = ok;
    a.onloadeddata = () => setTimeout(ok, 300);
    a.onerror = () =>
      reject(
        new Error(
          "Impossible de charger l’audio du morceau — lien mort ? Régénère/réimporte à l’étape 4.",
        ),
      );
    a.src = src;
  });
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function nearestBeatDelta(t, beats) {
  if (!beats?.length) return 99;
  let best = 99;
  for (const b of beats) {
    const d = Math.abs(b - t);
    if (d < best) best = d;
  }
  return best;
}

function activeShotIndex(t, cutPoints, shotCount) {
  if (shotCount <= 1) return 0;
  let idx = 0;
  for (let i = 0; i < cutPoints.length; i++) {
    if (t >= cutPoints[i]) idx = i;
  }
  return Math.min(shotCount - 1, idx % shotCount);
}

function drawCinematicOverlay(ctx, { t, duration, artist, track, social, inCta, cinematic }) {
  const title = track?.title || "Nouveau single";
  const name = artist?.name || "Artiste";
  const hook = social?.hook || "";

  // Vignette légère (réalisme cinéma)
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.78);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  if (cinematic && !inCta) {
    // Lower-third discret seulement
    const fadeIn = Math.min(1, t / 1.2);
    const fadeOut = t > duration - CTA_SECONDS - 1 ? Math.max(0, (duration - CTA_SECONDS - t) / 1) : 1;
    const a = fadeIn * fadeOut;
    ctx.globalAlpha = 0.85 * a;
    ctx.fillStyle = "rgba(8,10,14,0.55)";
    ctx.fillRect(48, H - 220, W - 96, 140);
    ctx.fillStyle = "#f2efe6";
    ctx.font = "700 42px Syne, Arial, sans-serif";
    wrapText(ctx, title, W - 160)
      .slice(0, 1)
      .forEach((line) => ctx.fillText(line, 72, H - 150));
    ctx.fillStyle = "rgba(242,239,230,0.75)";
    ctx.font = "600 28px Figtree, Arial, sans-serif";
    ctx.fillText(name, 72, H - 100);
    ctx.globalAlpha = 1;
    return;
  }

  const grad = ctx.createLinearGradient(0, H * 0.55, 0, H);
  grad.addColorStop(0, "transparent");
  grad.addColorStop(0.4, "rgba(8,10,14,0.55)");
  grad.addColorStop(1, "rgba(8,10,14,0.92)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, H * 0.5, W, H * 0.5);

  if (!inCta) {
    ctx.fillStyle = "rgba(242,239,230,0.9)";
    ctx.font = "700 36px Syne, Arial, sans-serif";
    ctx.fillText("SONOZZ", 64, 100);

    ctx.fillStyle = "#f2efe6";
    ctx.font = "800 64px Syne, Arial, sans-serif";
    wrapText(ctx, title, W - 120)
      .slice(0, 2)
      .forEach((line, i) => ctx.fillText(line, 64, H - 280 + i * 72));

    ctx.fillStyle = "rgba(242,239,230,0.75)";
    ctx.font = "600 36px Figtree, Arial, sans-serif";
    ctx.fillText(name, 64, H - 120);

    if (hook) {
      ctx.fillStyle = "#c9a227";
      ctx.font = "700 34px Figtree, Arial, sans-serif";
      wrapText(ctx, hook, W - 120)
        .slice(0, 2)
        .forEach((line, i) => ctx.fillText(line, 64, H - 420 + i * 44));
    }
  } else {
    ctx.fillStyle = "rgba(8,10,14,0.72)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#c9a227";
    ctx.font = "700 32px Syne, Arial, sans-serif";
    ctx.fillText("MAINTENANT DISPO", 64, H * 0.38);
    ctx.fillStyle = "#f2efe6";
    ctx.font = "800 70px Syne, Arial, sans-serif";
    wrapText(ctx, title, W - 120)
      .slice(0, 2)
      .forEach((line, i) => ctx.fillText(line, 64, H * 0.45 + i * 80));
    ctx.fillStyle = "rgba(242,239,230,0.8)";
    ctx.font = "600 40px Figtree, Arial, sans-serif";
    ctx.fillText(name, 64, H * 0.45 + 180);
    ctx.fillStyle = "#f2efe6";
    ctx.font = "700 42px Figtree, Arial, sans-serif";
    wrapText(ctx, "Écoute le morceau sur Spotify, Apple Music & streaming", W - 120)
      .slice(0, 3)
      .forEach((line, i) => ctx.fillText(line, 64, H * 0.62 + i * 52));
  }

  const p = Math.min(1, t / duration);
  ctx.fillStyle = "rgba(242,239,230,0.2)";
  ctx.fillRect(64, H - 48, W - 128, 6);
  ctx.fillStyle = "#c9a227";
  ctx.fillRect(64, H - 48, (W - 128) * p, 6);
}

function drawScene(ctx, {
  videos,
  cutPoints,
  beats,
  inCta,
  t,
  durationSec,
  artist,
  track,
  social,
  cinematic,
}) {
  ctx.fillStyle = "#0c0f12";
  ctx.fillRect(0, 0, W, H);

  const shotIdx = activeShotIndex(t, cutPoints, videos.length);
  const veo = videos[shotIdx] || videos[0];
  // Fallback : autre plan décodé si le courant n’est pas prêt (évite abort brutal)
  let paint = veo;
  if (!paint || paint.videoWidth <= 0 || paint.readyState < 2) {
    paint = videos.find((v) => v && v.videoWidth > 0 && v.readyState >= 2) || paint;
  }
  const hasVideo = paint && paint.videoWidth > 0 && paint.readyState >= 2;
  if (!hasVideo) {
    // Frame noire plutôt que throw mid-record (sinon tout le mux est perdu)
    ctx.fillStyle = "#0c0f12";
    ctx.fillRect(0, 0, W, H);
    return;
  }

  // Punch zoom léger sur le beat
  const onBeat = nearestBeatDelta(t, beats) < 0.09;
  const punch = onBeat ? 1.045 : 1.0;
  const vw = paint.videoWidth;
  const vh = paint.videoHeight;
  // Crop source → 9:16 TikTok plein cadre (pas de bandes noires)
  const targetAR = W / H;
  const srcAR = vw / Math.max(1, vh);
  let sx = 0;
  let sy = 0;
  let sw = vw;
  let sh = vh;
  if (srcAR > targetAR) {
    sw = vh * targetAR;
    sx = (vw - sw) / 2;
  } else if (srcAR < targetAR) {
    sh = vw / targetAR;
    // Biais haut : garde le visage si plan un peu trop haut
    sy = Math.max(0, (vh - sh) * 0.22);
  }
  const dw = W * punch;
  const dh = H * punch;

  ctx.globalAlpha = inCta ? 0.4 : 1;
  ctx.drawImage(paint, sx, sy, sw, sh, (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.globalAlpha = 1;

  // Flash beat très léger
  if (onBeat && !inCta) {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(0, 0, W, H);
  }

  drawCinematicOverlay(ctx, {
    t,
    duration: durationSec,
    artist,
    track,
    social,
    inCta,
    cinematic,
  });
}

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
        "Impossible de charger l’audio du morceau — régénère ou réimporte à l’étape 4.",
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
