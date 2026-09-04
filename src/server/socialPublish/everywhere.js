import { getTikTokAccess } from "../tiktok.js";
import { getYouTubeAccess, publishToYouTube as uploadYouTubeShort } from "../youtube.js";
import { bufferFromVideoInput, publishToTikTok } from "./tiktok.js";
import { publishToWebhook } from "./webhook.js";

export { captionWithTags } from "./caption.js";

export async function publishShortEverywhere({
  keys,
  videoBase64,
  videoBuffer,
  mimeType,
  videoUrl,
  social,
  artist,
  track,
  targets,
}) {
  const wantTikTok = targets?.tiktok !== false;
  const wantYouTube = targets?.youtube !== false;
  const wantWebhook = targets?.webhook !== false;
  const webhookUrl = keys?.socialWebhookUrl?.trim() || "";

  const results = [];
  let tiktokTokens = null;
  let youtubeTokens = null;

  // Buffer une seule fois pour TikTok + YouTube
  let sharedBuffer = null;
  let sharedMime = mimeType || null;
  if (wantTikTok || wantYouTube) {
    try {
      const parsed = bufferFromVideoInput({
        videoBase64,
        videoBuffer,
        mimeType,
      });
      sharedBuffer = parsed.buffer;
      sharedMime = parsed.mimeType;
    } catch (e) {
      if (wantTikTok || wantYouTube) {
        /* chaque branche gérera l’erreur si besoin */
      }
    }
  }

  if (wantTikTok) {
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
          videoBase64: sharedBuffer ? undefined : videoBase64,
          videoBuffer: sharedBuffer || videoBuffer,
          mimeType: sharedMime || mimeType,
          social,
          privacyLevel: keys?.tiktokPrivacyLevel || "SELF_ONLY",
          postMode: keys?.tiktokPostMode || "auto",
        }),
      );
    } catch (e) {
      results.push({ ok: false, platform: "tiktok", message: e.message });
    }
  }

  if (wantYouTube) {
    const hasYtCreds = Boolean(
      keys?.youtubeAccessToken?.trim() ||
        (keys?.youtubeClientId?.trim() && keys?.youtubeRefreshToken?.trim()),
    );
    if (!hasYtCreds) {
      results.push({
        ok: false,
        skipped: true,
        platform: "youtube",
        message: "YouTube non connecté — OAuth dans Paramètres → Réseaux",
      });
    } else {
      try {
        const access = await getYouTubeAccess(keys);
        if (access?.refreshed) {
          youtubeTokens = {
            youtubeAccessToken: access.refreshed.access_token,
            youtubeRefreshToken:
              access.refreshed.refresh_token || keys?.youtubeRefreshToken || "",
          };
        }
        if (!sharedBuffer) {
          const parsed = bufferFromVideoInput({
            videoBase64,
            videoBuffer,
            mimeType,
          });
          sharedBuffer = parsed.buffer;
          sharedMime = parsed.mimeType;
        }
        results.push(
          await uploadYouTubeShort({
            accessToken: access?.token,
            buffer: sharedBuffer,
            mimeType: sharedMime || mimeType,
            social,
            privacyStatus: keys?.youtubePrivacyStatus || "private",
            artistName: artist?.name,
            trackTitle: track?.title,
          }),
        );
      } catch (e) {
        results.push({ ok: false, platform: "youtube", message: e.message });
      }
    }
  }

  if (wantWebhook) {
    if (!webhookUrl) {
      results.push({
        ok: false,
        skipped: true,
        platform: "webhook",
        message: "Webhook non configuré — Enregistrer l’URL dans Paramètres si besoin",
      });
    } else {
      try {
        results.push(
          await publishToWebhook({
            webhookUrl,
            videoBase64,
            videoBuffer: sharedBuffer || videoBuffer,
            mimeType: sharedMime || mimeType,
            videoUrl,
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
  }

  const published = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);

  return {
    status: published.length
      ? failed.length
        ? "partial"
        : "published"
      : failed.length
        ? "failed"
        : "skipped",
    results,
    published: published.length,
    failed: failed.length,
    skipped: skipped.length,
    tiktokTokens,
    youtubeTokens,
    note:
      published.length === 0 && skipped.length
        ? "Aucun canal configuré — connecte TikTok et/ou YouTube (OAuth) et/ou un webhook dans Paramètres."
        : undefined,
  };
}
