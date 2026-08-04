/**
 * Publication shorts → TikTok Direct Post + YouTube Shorts + webhook (Activepieces/Make).
 */

import { getTikTokAccess } from "./tiktok.js";
import { getYouTubeAccess, publishToYouTube as uploadYouTubeShort } from "./youtube.js";

const MIN_TIKTOK_BYTES = 80_000;
const CHUNK_TARGET = 10_000_000; // 10 Mo — entre 5 et 64 Mo (doc TikTok)

function captionWithTags(social = {}) {
  const tags = (social.hashtags || [])
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .join(" ");
  return `${social.caption || ""}\n\n${tags}`.trim().slice(0, 2200);
}

function mimeFromDataUrl(videoBase64 = "", fallback = "video/webm") {
  const m = String(videoBase64).match(/^data:([^;]+);base64,/i);
  if (m?.[1]) return m[1].split(";")[0].trim();
  return fallback;
}

/** Détecte le conteneur réel (évite d’envoyer du WebM étiqueté mp4). */
export function detectVideoMime(buffer, hint = "") {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 12) {
    return hint || "application/octet-stream";
  }
  // WebM / Matroska : 1A 45 DF A3
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return "video/webm";
  }
  // ISO BMFF (MP4/MOV) : ....ftyp
  if (buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12);
    if (/^qt/i.test(brand)) return "video/quicktime";
    return "video/mp4";
  }
  if (/mp4/i.test(hint)) return "video/mp4";
  if (/webm/i.test(hint)) return "video/webm";
  if (/quicktime|mov/i.test(hint)) return "video/quicktime";
  return hint || "application/octet-stream";
}

function bufferFromVideoInput({ videoBase64, videoBuffer, mimeType: mimeHint }) {
  if (videoBuffer && Buffer.isBuffer(videoBuffer)) {
    const mimeType = detectVideoMime(videoBuffer, mimeHint || "video/mp4");
    return { buffer: videoBuffer, mimeType };
  }
  if (typeof videoBase64 === "string" && videoBase64.length > 100) {
    const hinted = mimeFromDataUrl(videoBase64, mimeHint || "video/webm");
    const raw = videoBase64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(raw, "base64");
    return { buffer, mimeType: detectVideoMime(buffer, hinted) };
  }
  throw new Error("Vidéo manquante ou illisible");
}

/** TikTok Inbox décode mal le WebM canvas → souvent 1 seule frame. */
function assertTikTokReady(buffer, mimeType) {
  if (!buffer?.length || buffer.length < MIN_TIKTOK_BYTES) {
    throw new Error(
      "Vidéo trop légère pour TikTok (souvent une frame figée). Régénère le short Veo (MP4) à l’étape Clip, puis republie.",
    );
  }
  if (/webm/i.test(mimeType || "")) {
    throw new Error(
      "Ce clip est un WebM (montage canvas / +promo). TikTok Inbox n’affiche souvent que la 1ère image. " +
        "Étape Clip → « Générer short Veo » (MP4 H.264), puis republie.",
    );
  }
  if (!/mp4|quicktime/i.test(mimeType || "")) {
    throw new Error(
      `Format TikTok non supporté (${mimeType || "inconnu"}). Il faut un MP4 Veo — régénère le clip.`,
    );
  }
}

/** Plan d’upload conforme à la doc TikTok (chunks 5–64 Mo). */
function buildChunkPlan(videoSize) {
  if (videoSize <= 0) throw new Error("Taille vidéo invalide");
  // < 5 Mo : un seul chunk = fichier entier
  if (videoSize < 5_000_000) {
    return { chunkSize: videoSize, totalChunkCount: 1 };
  }
  // ≤ 64 Mo : un seul chunk OK
  if (videoSize <= 64_000_000) {
    return { chunkSize: videoSize, totalChunkCount: 1 };
  }
  const chunkSize = CHUNK_TARGET;
  const totalChunkCount = Math.ceil(videoSize / chunkSize);
  return { chunkSize, totalChunkCount };
}

function tiktokErrorMessage(data, fallback) {
  const code = String(data?.error?.code || "");
  const msg = data?.error?.message || code || fallback;
  if (/scope_not_authorized|scope not authorized/i.test(`${code} ${msg}`)) {
    return "Scope TikTok manquant (video.publish / video.upload). Paramètres → Reconnecter.";
  }
  if (/unaudited_client_can_only_post_to_private/i.test(`${code} ${msg}`)) {
    return (
      "App TikTok non auditée : Direct Post exige un compte TikTok Privé " +
      "(app → Confidentialité → Compte privé ON), ou attends l’audit de l’app."
    );
  }
  if (/spam_risk_too_many_pending_share/i.test(`${code} ${msg}`)) {
    return (
      "Limite TikTok : trop d’envois API non finalisés sur 24 h (même si tu as supprimé le brouillon visible). " +
      "Attends quelques heures / demain, ou passe le compte TikTok en Privé et utilise le mode Direct + « Uniquement moi »."
    );
  }
  if (/spam_risk_too_many_posts/i.test(`${code} ${msg}`)) {
    return "Quota quotidien TikTok atteint pour ce compte — réessaie demain.";
  }
  return msg;
}

async function tiktokCreatorInfo(token) {
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  const code = String(data?.error?.code || "");
  if (!res.ok || (code && code !== "ok")) {
    throw new Error(tiktokErrorMessage(data, `TikTok creator_info HTTP ${res.status}`));
  }
  return data.data || data;
}

function pickPrivacyLevel(creator, preferred = "SELF_ONLY") {
  const options = Array.isArray(creator?.privacy_level_options)
    ? creator.privacy_level_options
    : [];
  const want = String(preferred || "SELF_ONLY").trim() || "SELF_ONLY";
  // Honorer le choix Settings s’il est autorisé par le compte
  if (options.includes(want)) return want;
  if (options.includes("SELF_ONLY")) return "SELF_ONLY";
  if (options.includes("FOLLOWER_OF_CREATOR")) return "FOLLOWER_OF_CREATOR";
  if (options.includes("MUTUAL_FOLLOW_FRIENDS")) return "MUTUAL_FOLLOW_FRIENDS";
  if (options[0]) return options[0];
  return want;
}

async function tiktokInitDirectPost(token, { videoSize, chunkSize, totalChunkCount, title, privacyLevel, isAigc = true }) {
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title: String(title || "").slice(0, 2200),
        privacy_level: privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
        is_aigc: Boolean(isAigc),
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  const code = String(data?.error?.code || "");
  if (!res.ok || (code && code !== "ok")) {
    const err = new Error(tiktokErrorMessage(data, `TikTok direct init HTTP ${res.status}`));
    err.tiktokCode = code;
    throw err;
  }
  return data.data || data;
}

async function tiktokPutVideo(uploadUrl, buffer, mimeType = "video/mp4", { chunkSize, totalChunkCount } = {}) {
  const type = /mp4/i.test(mimeType)
    ? "video/mp4"
    : /quicktime|mov/i.test(mimeType)
      ? "video/quicktime"
      : "video/webm";
  const videoSize = buffer.length;
  const plan = chunkSize && totalChunkCount
    ? { chunkSize, totalChunkCount }
    : buildChunkPlan(videoSize);

  for (let i = 0; i < plan.totalChunkCount; i++) {
    const start = i * plan.chunkSize;
    const isLast = i === plan.totalChunkCount - 1;
    const end = isLast ? videoSize : Math.min(start + plan.chunkSize, videoSize);
    const chunk = buffer.subarray(start, end);
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": type,
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${end - 1}/${videoSize}`,
      },
      body: chunk,
    });
    if (!res.ok && res.status !== 201 && res.status !== 206) {
      const text = await res.text().catch(() => "");
      throw new Error(`TikTok upload HTTP ${res.status}: ${text.slice(0, 160)}`);
    }
  }
}

async function tiktokFetchStatus(token, publishId) {
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const data = await res.json().catch(() => ({}));
  const code = String(data?.error?.code || "");
  if (!res.ok || (code && code !== "ok")) {
    throw new Error(data?.error?.message || code || `TikTok status HTTP ${res.status}`);
  }
  return data.data || data;
}

async function tiktokInitInbox(token, { videoSize, chunkSize, totalChunkCount }) {
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
        total_chunk_count: totalChunkCount,
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  const code = String(data?.error?.code || "");
  if (!res.ok || (code && code !== "ok")) {
    const err = new Error(tiktokErrorMessage(data, `TikTok inbox init HTTP ${res.status}`));
    err.tiktokCode = code;
    throw err;
  }
  return data.data || data;
}

async function pollTikTokStatus(token, publishId, { wantInbox = false } = {}) {
  let status = "PROCESSING_UPLOAD";
  let failReason = null;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 3500));
    try {
      const st = await tiktokFetchStatus(token, publishId);
      status = st.status || status;
      failReason = st.fail_reason || st.reason || null;
      if (status === "PUBLISH_COMPLETE" || status === "FAILED") break;
      if (wantInbox && status === "SEND_TO_USER_INBOX") break;
    } catch {
      /* retry */
    }
  }
  return { status, failReason };
}

async function publishTikTokInbox({ token, buffer, mimeType, social }) {
  assertTikTokReady(buffer, mimeType);
  const videoSize = buffer.length;
  const plan = buildChunkPlan(videoSize);
  const title = captionWithTags(social);
  const init = await tiktokInitInbox(token, {
    videoSize,
    chunkSize: plan.chunkSize,
    totalChunkCount: plan.totalChunkCount,
  });
  const uploadUrl = init.upload_url;
  const publishId = init.publish_id;
  if (!uploadUrl) throw new Error("TikTok inbox : pas d’upload_url");

  await tiktokPutVideo(uploadUrl, buffer, mimeType, plan);
  const { status, failReason } = await pollTikTokStatus(token, publishId, { wantInbox: true });

  if (status === "FAILED") {
    return {
      ok: false,
      platform: "tiktok",
      mode: "inbox",
      publishId,
      status,
      message: `Inbox TikTok échoué (${failReason || "FAILED"}).`,
    };
  }

  return {
    ok: true,
    platform: "tiktok",
    mode: "inbox",
    publishId,
    status,
    mimeType,
    byteLength: videoSize,
    message:
      "Brouillon Inbox OK — ouvre l’app TikTok → cloche / Inbox → finalise et publie. (Direct Post bloqué tant que l’app n’est pas auditée / compte public.)",
    caption: title,
  };
}

async function publishTikTokDirect({ token, buffer, mimeType, social, privacyHint }) {
  assertTikTokReady(buffer, mimeType);
  const videoSize = buffer.length;
  const plan = buildChunkPlan(videoSize);
  const title = captionWithTags(social);
  const creator = await tiktokCreatorInfo(token);
  let privacyLevel = pickPrivacyLevel(creator, privacyHint || "SELF_ONLY");

  let init;
  try {
    init = await tiktokInitDirectPost(token, {
      videoSize,
      chunkSize: plan.chunkSize,
      totalChunkCount: plan.totalChunkCount,
      title,
      privacyLevel,
      isAigc: true,
    });
  } catch (e) {
    if (/unaudited|private/i.test(`${e.tiktokCode || ""} ${e.message || ""}`) && privacyLevel !== "SELF_ONLY") {
      privacyLevel = "SELF_ONLY";
      init = await tiktokInitDirectPost(token, {
        videoSize,
        chunkSize: plan.chunkSize,
        totalChunkCount: plan.totalChunkCount,
        title,
        privacyLevel: "SELF_ONLY",
        isAigc: true,
      });
    } else {
      throw e;
    }
  }

  const uploadUrl = init.upload_url;
  const publishId = init.publish_id;
  if (!uploadUrl) throw new Error("TikTok Direct Post : pas d’upload_url");

  await tiktokPutVideo(uploadUrl, buffer, mimeType, plan);
  const { status, failReason } = await pollTikTokStatus(token, publishId);

  if (status === "FAILED") {
    return {
      ok: false,
      platform: "tiktok",
      mode: "direct",
      publishId,
      status,
      privacyLevel,
      message: `Direct Post échoué (${failReason || "FAILED"}).`,
    };
  }

  if (status === "PUBLISH_COMPLETE") {
    const privateNote =
      privacyLevel === "SELF_ONLY" ? " (visibilité : uniquement toi)" : ` (${privacyLevel})`;
    return {
      ok: true,
      platform: "tiktok",
      mode: "direct",
      publishId,
      status,
      privacyLevel,
      mimeType,
      byteLength: videoSize,
      message: `Publié sur ton profil TikTok${privateNote}.`,
      caption: title,
    };
  }

  return {
    ok: true,
    platform: "tiktok",
    mode: "direct",
    publishId,
    status,
    privacyLevel,
    mimeType,
    byteLength: videoSize,
    message: `Direct Post en cours (${status}). Vérifie ton Profil dans 1–2 min.`,
    caption: title,
  };
}

/**
 * Direct Post et/ou Inbox selon Paramètres → Mode publication TikTok.
 */
export async function publishToTikTok({
  accessToken,
  videoBase64,
  videoBuffer,
  mimeType: mimeHint,
  social,
  privacyLevel: privacyHint,
  postMode: modeHint = "auto",
}) {
  if (!accessToken?.trim()) {
    return { ok: false, skipped: true, platform: "tiktok", message: "Token TikTok manquant" };
  }

  const token = accessToken.trim();
  const { buffer, mimeType } = bufferFromVideoInput({
    videoBase64,
    videoBuffer,
    mimeType: mimeHint,
  });
  // Toujours le mime détecté (pas le hint client qui peut mentir)
  assertTikTokReady(buffer, mimeType);

  const mode = String(modeHint || "auto").toLowerCase();
  const tryDirect = mode === "direct" || mode === "auto";
  const tryInbox = mode === "inbox" || mode === "auto";

  if (tryDirect) {
    try {
      return await publishTikTokDirect({
        token,
        buffer,
        mimeType,
        social,
        privacyHint,
      });
    } catch (e) {
      const unaudited = /unaudited|private_accounts/i.test(
        `${e.tiktokCode || ""} ${e.message || ""}`,
      );
      // Ne pas brûler le quota Inbox (max 5 pending / 24 h) à chaque essai Auto
      if (unaudited && mode === "auto") {
        return {
          ok: false,
          platform: "tiktok",
          mode: "auto",
          message:
            "Direct Post bloqué (app non auditée + compte public). " +
            "Option A : compte TikTok → Privé, mode Direct, visibilité « Uniquement moi », republie. " +
            "Option B : mode Inbox (seulement si le quota 24 h n’est pas déjà saturé).",
        };
      }
      if (!tryInbox) {
        return {
          ok: false,
          platform: "tiktok",
          mode: "direct",
          message: e.message || "Direct Post impossible",
        };
      }
      try {
        const inbox = await publishTikTokInbox({
          token,
          buffer,
          mimeType,
          social,
        });
        if (inbox.ok) {
          inbox.message = `Direct Post bloqué (app non auditée) → ${inbox.message}`;
        }
        return inbox;
      } catch (e2) {
        return {
          ok: false,
          platform: "tiktok",
          mode: "inbox",
          message: e2.message || `${e.message} — ${e2.message}`,
        };
      }
    }
  }

  return publishTikTokInbox({
    token,
    buffer,
    mimeType,
    social,
  });
}

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
