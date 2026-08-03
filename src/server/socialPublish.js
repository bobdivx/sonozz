/**
 * Publication shorts → TikTok (Content Posting) + webhook générique (Activepieces/Make).
 */

import { getTikTokAccess } from "./tiktok.js";

function captionWithTags(social = {}) {
  const tags = (social.hashtags || [])
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .join(" ");
  return `${social.caption || ""}\n\n${tags}`.trim().slice(0, 2200);
}

async function tiktokInitUpload(token, videoSize) {
  const chunkSize = videoSize;
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSize,
        chunk_size: chunkSize,
        total_chunk_count: 1,
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error?.code) {
    throw new Error(
      data?.error?.message || data?.error?.code || `TikTok init HTTP ${res.status}`,
    );
  }
  return data.data || data;
}

async function tiktokPutVideo(uploadUrl, buffer, videoSize) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/webm",
      "Content-Length": String(videoSize),
      "Content-Range": `bytes 0-${videoSize - 1}/${videoSize}`,
    },
    body: buffer,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TikTok upload HTTP ${res.status}: ${text.slice(0, 160)}`);
  }
}

/**
 * Envoie la vidéo dans l’inbox TikTok (l’utilisateur valide la notif pour publier).
 * Scope requis : video.upload
 */
export async function publishToTikTok({ accessToken, videoBase64, social }) {
  if (!accessToken?.trim()) {
    return { ok: false, skipped: true, platform: "tiktok", message: "Token TikTok manquant" };
  }

  const raw = videoBase64.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(raw, "base64");
  const videoSize = buffer.length;
  if (videoSize < 1000) throw new Error("Vidéo trop petite / invalide");

  const init = await tiktokInitUpload(accessToken.trim(), videoSize);
  const uploadUrl = init.upload_url;
  const publishId = init.publish_id;
  if (!uploadUrl) throw new Error("TikTok n’a pas renvoyé d’upload_url");

  await tiktokPutVideo(uploadUrl, buffer, videoSize);

  return {
    ok: true,
    platform: "tiktok",
    mode: "inbox",
    publishId,
    message:
      "Vidéo envoyée dans l’inbox TikTok — ouvre l’app TikTok et valide la notification pour publier.",
    caption: captionWithTags(social),
  };
}

/**
 * Webhook générique (Activepieces / Make / n8n) pour Instagram / YouTube / multi-réseaux.
 */
export async function publishToWebhook({ webhookUrl, videoBase64, social, artist, track, platforms }) {
  if (!webhookUrl?.trim()) {
    return { ok: false, skipped: true, platform: "webhook", message: "Webhook non configuré" };
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
    // base64 peut être gros — certains webhooks préfèrent une URL ; on envoie si < 8 Mo
    video: {
      mimeType: "video/webm",
      dataBase64: videoBase64.length < 8_000_000 ? videoBase64 : null,
      tooLarge: videoBase64.length >= 8_000_000,
      byteLength: Math.round((videoBase64.length * 3) / 4),
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
    message: "Webhook déclenché (Activepieces / Make peut poster IG / YT / TikTok).",
  };
}

export async function publishShortEverywhere({ keys, videoBase64, social, artist, track, targets }) {
  const want = {
    tiktok: targets?.tiktok !== false,
    webhook: targets?.webhook !== false,
  };

  const results = [];
  let tiktokTokens = null;

  if (want.tiktok) {
    try {
      const access = await getTikTokAccess(keys);
      if (access?.refreshed) {
        tiktokTokens = {
          tiktokAccessToken: access.refreshed.access_token,
          tiktokRefreshToken:
            access.refreshed.refresh_token || keys?.tiktokRefreshToken || "",
        };
      }
      results.push(
        await publishToTikTok({
          accessToken: access?.token,
          videoBase64,
          social,
        }),
      );
    } catch (e) {
      results.push({ ok: false, platform: "tiktok", message: e.message });
    }
  }

  if (want.webhook) {
    try {
      results.push(
        await publishToWebhook({
          webhookUrl: keys?.socialWebhookUrl,
          videoBase64,
          social,
          artist,
          track,
          platforms: targets?.platforms,
        }),
      );
    } catch (e) {
      results.push({ ok: false, platform: "webhook", message: e.message });
    }
  }

  const published = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);

  return {
    status: published.length ? (failed.length ? "partial" : "published") : failed.length ? "failed" : "skipped",
    results,
    published: published.length,
    failed: failed.length,
    skipped: skipped.length,
    tiktokTokens,
    note:
      published.length === 0 && skipped.length
        ? "Aucun canal configuré — connecte TikTok (Client Key + Secret + OAuth) et/ou un webhook dans Paramètres."
        : undefined,
  };
}
