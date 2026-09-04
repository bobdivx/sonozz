const W = 1080;
const H = 1920;
const CTA_SECONDS = 3.5;

export function wrapText(ctx, text, maxWidth) {
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

export function nearestBeatDelta(t, beats) {
  if (!beats?.length) return 99;
  let best = 99;
  for (const b of beats) {
    const d = Math.abs(b - t);
    if (d < best) best = d;
  }
  return best;
}

export function activeShotIndex(t, cutPoints, shotCount) {
  if (shotCount <= 1) return 0;
  let idx = 0;
  for (let i = 0; i < cutPoints.length; i++) {
    if (t >= cutPoints[i]) idx = i;
  }
  return Math.min(shotCount - 1, idx % shotCount);
}

export function drawCinematicOverlay(ctx, { t, duration, artist, track, social, inCta, cinematic }) {
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

export function drawScene(ctx, {
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
