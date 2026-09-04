import { captionWithTags, mimeFromDataUrl } from "./caption.js";

/**
 * Webhook générique (Activepieces / Make / n8n) pour Instagram / YouTube / multi-réseaux.
 */
export async function publishToWebhook({
  webhookUrl,
  videoBase64,
  videoBuffer,
  mimeType: mimeHint,
  videoUrl,
  social,
  artist,
  track,
  platforms,
}) {
  if (!webhookUrl?.trim()) {
    return { ok: false, skipped: true, platform: "webhook", message: "Webhook non configuré" };
  }

  let mimeType = mimeHint || "video/webm";
  let dataBase64 = null;
  let byteLength = 0;
  let tooLarge = false;

  if (videoBuffer && Buffer.isBuffer(videoBuffer)) {
    byteLength = videoBuffer.length;
    tooLarge = byteLength > 6_000_000;
    if (!tooLarge) {
      dataBase64 = `data:${mimeType};base64,${videoBuffer.toString("base64")}`;
    }
  } else if (typeof videoBase64 === "string") {
    mimeType = mimeFromDataUrl(videoBase64, mimeType);
    byteLength = Math.round((videoBase64.length * 3) / 4);
    tooLarge = videoBase64.length >= 8_000_000;
    dataBase64 = tooLarge ? null : videoBase64;
  }

  const payload = {
    event: "sonozz.short.publish",
    at: new Date().toISOString(),
    platforms: platforms || social?.platforms || ["TikTok", "Instagram Reels", "YouTube Shorts"],
    caption: captionWithTags(social),
    hashtags: social?.hashtags || [],
    hook: social?.hook || null,
    artist: artist?.name || null,
    track: track?.title || null,
    video: {
      mimeType,
      url: videoUrl || null,
      dataBase64,
      tooLarge,
      byteLength,
    },
  };

  const res = await fetch(webhookUrl.trim(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Webhook HTTP ${res.status}: ${text.slice(0, 160)}`);
  }

  return {
    ok: true,
    platform: "webhook",
    message: tooLarge
      ? videoUrl
        ? "Webhook déclenché (vidéo via URL S3 — trop lourde pour le JSON)."
        : "Webhook déclenché (vidéo trop lourde pour le JSON — métadonnées seules ; utilise l’export fichier)."
      : "Webhook déclenché (Activepieces / Make peut poster IG / YT / TikTok).",
  };
}
