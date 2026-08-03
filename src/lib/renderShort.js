const W = 1080;
const H = 1920;
const FPS = 30;
const DURATION_SEC = 15;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
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

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function pickPalette(artist) {
  const p = artist?.palette?.filter(Boolean) || [];
  return {
    a: p[0] || "#c9a227",
    b: p[1] || "#3d6b5a",
    c: p[2] || "#d4784a",
    ink: "#0c0f12",
    fog: "#f2efe6",
  };
}

function drawFrame(ctx, { t, cover, artist, track, social, palette }) {
  const progress = t / DURATION_SEC;
  const sceneIndex = Math.min(2, Math.floor(progress * 3));
  const sceneLocal = (progress * 3) % 1;

  // Background
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, palette.b);
  grad.addColorStop(0.45, palette.a);
  grad.addColorStop(1, palette.ink);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Soft moving orb
  const ox = W * (0.3 + 0.4 * Math.sin(t * 0.7));
  const oy = H * (0.25 + 0.1 * Math.cos(t * 0.5));
  const orb = ctx.createRadialGradient(ox, oy, 20, ox, oy, 420);
  orb.addColorStop(0, `${palette.c}99`);
  orb.addColorStop(1, "transparent");
  ctx.fillStyle = orb;
  ctx.fillRect(0, 0, W, H);

  // Cover plate
  const coverSize = 620;
  const coverX = (W - coverSize) / 2;
  const coverY = 280 + Math.sin(t * 1.2) * 12;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 40;
  drawRoundedRect(ctx, coverX, coverY, coverSize, coverSize, 28);
  ctx.clip();
  if (cover) {
    const scale = Math.max(coverSize / cover.width, coverSize / cover.height);
    const dw = cover.width * scale;
    const dh = cover.height * scale;
    ctx.drawImage(cover, coverX + (coverSize - dw) / 2, coverY + (coverSize - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = palette.ink;
    ctx.fillRect(coverX, coverY, coverSize, coverSize);
  }
  ctx.restore();

  // Dark bottom panel
  const panelGrad = ctx.createLinearGradient(0, H * 0.55, 0, H);
  panelGrad.addColorStop(0, "transparent");
  panelGrad.addColorStop(0.35, "rgba(12,15,18,0.75)");
  panelGrad.addColorStop(1, "rgba(12,15,18,0.95)");
  ctx.fillStyle = panelGrad;
  ctx.fillRect(0, H * 0.5, W, H * 0.5);

  // Brand
  ctx.fillStyle = palette.a;
  ctx.font = "700 36px Syne, Arial, sans-serif";
  ctx.fillText("SONOZZ", 72, 120);

  // Title / artist
  ctx.fillStyle = palette.fog;
  ctx.font = "800 72px Syne, Arial, sans-serif";
  const titleLines = wrapText(ctx, track?.title || "Untitled", W - 140);
  titleLines.slice(0, 2).forEach((line, i) => {
    ctx.fillText(line, 72, 1100 + i * 82);
  });

  ctx.fillStyle = "rgba(242,239,230,0.75)";
  ctx.font = "600 40px Figtree, Arial, sans-serif";
  ctx.fillText(artist?.name || "Artiste", 72, 1100 + titleLines.slice(0, 2).length * 82 + 20);

  // Scene / hook text
  const scenes = social?.scenes?.length
    ? social.scenes
    : ["Hook", "Visuel artiste", "CTA follow"];
  const hook = social?.hook || scenes[sceneIndex] || "";
  const lyricLine =
    (lyricsFirstLine(social) || hook).slice(0, 90);

  ctx.fillStyle = palette.a;
  ctx.font = "700 44px Figtree, Arial, sans-serif";
  const hookLines = wrapText(ctx, lyricLine, W - 140);
  hookLines.slice(0, 3).forEach((line, i) => {
    const alpha = Math.min(1, 0.35 + sceneLocal);
    ctx.globalAlpha = alpha;
    ctx.fillText(line, 72, 1480 + i * 56);
  });
  ctx.globalAlpha = 1;

  // Progress bar
  ctx.fillStyle = "rgba(242,239,230,0.15)";
  ctx.fillRect(72, H - 90, W - 144, 8);
  ctx.fillStyle = palette.a;
  ctx.fillRect(72, H - 90, (W - 144) * progress, 8);

  ctx.fillStyle = "rgba(242,239,230,0.55)";
  ctx.font = "600 28px Figtree, Arial, sans-serif";
  ctx.fillText("9:16 · 15s · TikTok / Reels / Shorts", 72, H - 48);

  // Scene indicator
  ctx.fillStyle = "rgba(242,239,230,0.4)";
  ctx.font = "600 26px Figtree, Arial, sans-serif";
  ctx.fillText(`Scène ${sceneIndex + 1}/3`, W - 220, 120);
}

function lyricsFirstLine(social) {
  if (!social?.caption) return "";
  return social.caption.split("\n").find((l) => l.trim() && !l.startsWith("#")) || "";
}

/**
 * Render a real 9:16 short and return a downloadable Blob (webm).
 */
export async function renderShortVideo({ artist, track, coverUrl, social, onProgress }) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const palette = pickPalette(artist);
  const cover = await loadImage(coverUrl);

  const stream = canvas.captureStream(FPS);
  let audioCtx;
  let audioDest;
  let audioEl;

  if (track?.audioUrl) {
    try {
      audioEl = new Audio();
      audioEl.crossOrigin = "anonymous";
      audioEl.src = track.audioUrl;
      audioEl.currentTime = 0;
      await audioEl.play().catch(() => {});
      audioCtx = new AudioContext();
      const source = audioCtx.createMediaElementSource(audioEl);
      audioDest = audioCtx.createMediaStreamDestination();
      source.connect(audioDest);
      source.connect(audioCtx.destination);
      audioDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch {
      /* vidéo muette si audio CORS */
    }
  }

  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : MediaRecorder.isTypeSupported("video/webm")
      ? "video/webm"
      : "";

  if (!mime || typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder non supporté par ce navigateur — utilise Chrome/Edge.");
  }

  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 8_000_000,
  });
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data?.size) chunks.push(e.data);
  };

  const done = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
    recorder.onerror = () => reject(new Error("Échec enregistrement vidéo"));
  });

  recorder.start(100);

  const totalFrames = DURATION_SEC * FPS;
  for (let i = 0; i <= totalFrames; i++) {
    const t = i / FPS;
    drawFrame(ctx, { t, cover, artist, track, social, palette });
    onProgress?.(Math.round((i / totalFrames) * 100));
    await new Promise((r) => setTimeout(r, 1000 / FPS));
  }

  recorder.stop();
  audioEl?.pause();
  await audioCtx?.close().catch(() => {});

  const blob = await done;
  return blob;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
