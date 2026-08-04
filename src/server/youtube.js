/**
 * YouTube Data API v3 — OAuth 2.0 + upload Shorts (videos.insert resumable).
 * Shorts = même endpoint que les vidéos ; vertical 9:16 + #Shorts dans titre/desc.
 * @see https://developers.google.com/youtube/v3/guides/uploading_a_video
 * @see https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
 */

import { createHash, randomBytes } from "node:crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_INIT_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

/** Scope minimal pour uploader des vidéos / Shorts. */
export const YOUTUBE_SCOPES = "https://www.googleapis.com/auth/youtube.upload";

export function defaultRedirectUri(origin) {
  const base = (origin || "").replace(/\/$/, "");
  return `${base}/youtube/callback`;
}

export function sanitizeClientId(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "");
}

/** PKCE S256 standard (base64url) — recommandé Google OAuth. */
export function createPkcePair() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = randomBytes(64);
  let codeVerifier = "";
  for (let i = 0; i < 64; i++) codeVerifier += chars[bytes[i] % chars.length];

  const hash = createHash("sha256").update(codeVerifier, "utf8").digest();
  const codeChallenge = hash
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { codeVerifier, codeChallenge, codeChallengeMethod: "S256" };
}

export function buildAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  scopes = YOUTUBE_SCOPES,
  codeChallenge,
  codeChallengeMethod = "S256",
}) {
  const id = sanitizeClientId(clientId);
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: String(scopes || YOUTUBE_SCOPES).trim(),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: state || crypto.randomUUID(),
  });
  if (codeChallenge) {
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", codeChallengeMethod);
  }
  return `${AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg =
      data.error_description ||
      (typeof data.error === "string" ? data.error : data.error?.message) ||
      `YouTube token HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function exchangeCodeForToken({
  clientId,
  clientSecret,
  code,
  redirectUri,
  codeVerifier,
}) {
  const body = {
    client_id: sanitizeClientId(clientId),
    client_secret: String(clientSecret || "").trim(),
    code: String(code || "").trim(),
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  };
  if (codeVerifier) body.code_verifier = codeVerifier;
  return tokenRequest(body);
}

export async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  return tokenRequest({
    client_id: sanitizeClientId(clientId),
    client_secret: String(clientSecret || "").trim(),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

/**
 * Retourne un access_token utilisable, en refresh si possible.
 * @returns {{ token: string, refreshed?: object } | null}
 */
export async function getYouTubeAccess(keys) {
  const access = keys?.youtubeAccessToken?.trim();
  const refresh = keys?.youtubeRefreshToken?.trim();
  const clientId = keys?.youtubeClientId?.trim();
  const clientSecret = keys?.youtubeClientSecret?.trim();

  // Prefer refresh when we have refresh token — access tokens expire ~1h
  if (refresh && clientId && clientSecret) {
    try {
      const data = await refreshAccessToken({
        clientId,
        clientSecret,
        refreshToken: refresh,
      });
      if (data.access_token) {
        return { token: data.access_token, refreshed: data };
      }
    } catch {
      /* fallback to stored access if still valid */
    }
  }

  if (access) return { token: access };
  return null;
}

function youtubeErrorMessage(data, fallback) {
  const err = data?.error;
  const reason = err?.errors?.[0]?.reason || "";
  const msg = err?.message || reason || fallback;
  if (/quotaExceeded/i.test(`${reason} ${msg}`)) {
    return "Quota YouTube Data API atteint (≈6 uploads/jour en free tier). Réessaie demain (minuit PT).";
  }
  if (/uploadLimitExceeded/i.test(`${reason} ${msg}`)) {
    return "Limite d’upload YouTube du compte atteinte — réessaie plus tard.";
  }
  if (/forbidden|insufficientPermissions|accessNotConfigured/i.test(`${reason} ${msg}`)) {
    return (
      "YouTube API refusée — active YouTube Data API v3 dans Google Cloud, " +
      "ajoute ton compte en test user (OAuth consent), puis reconnecte."
    );
  }
  if (/invalidCredentials|authError|Unauthorized/i.test(`${reason} ${msg}`)) {
    return "Token YouTube invalide ou expiré — Paramètres → Reconnecter YouTube.";
  }
  return msg;
}

/**
 * Upload resumable → Short YouTube.
 * @returns {{ ok, platform, videoId?, url?, message, privacyStatus? }}
 */
export async function publishToYouTube({
  accessToken,
  buffer,
  mimeType = "video/mp4",
  social,
  privacyStatus: privacyHint = "private",
  title: titleHint,
  artistName,
  trackTitle,
}) {
  if (!accessToken?.trim()) {
    return { ok: false, skipped: true, platform: "youtube", message: "Token YouTube manquant" };
  }
  if (!buffer?.length) {
    throw new Error("Vidéo manquante pour YouTube");
  }
  if (/webm/i.test(mimeType || "")) {
    throw new Error(
      "YouTube Shorts : MP4 H.264 recommandé. Ce clip est WebM — régénère via Veo à l’étape Clip.",
    );
  }

  const tags = (social?.hashtags || [])
    .map((h) => String(h || "").replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, 12);

  const baseTitle =
    titleHint ||
    social?.hook ||
    [artistName, trackTitle].filter(Boolean).join(" — ") ||
    social?.caption?.split("\n")[0] ||
    "Short SONOZZ";
  // #Shorts aide YouTube à classer la vidéo
  let title = String(baseTitle).replace(/#Shorts?/gi, "").trim().slice(0, 90);
  if (!/#shorts/i.test(title)) title = `${title} #Shorts`.slice(0, 100);

  const caption = `${social?.caption || ""}\n\n${(social?.hashtags || [])
    .map((h) => (String(h).startsWith("#") ? h : `#${h}`))
    .join(" ")}`.trim();
  let description = caption.slice(0, 4500);
  if (!/#shorts/i.test(description)) {
    description = `${description}\n\n#Shorts`.trim().slice(0, 5000);
  }
  if (!/contenu (généré|synthétique)|AI-generated|synthetic/i.test(description)) {
    description = `${description}\n\nContenu généré avec assistance IA (SONOZZ).`.trim().slice(0, 5000);
  }

  const privacy =
    ["private", "unlisted", "public"].includes(String(privacyHint || "").toLowerCase())
      ? String(privacyHint).toLowerCase()
      : "private";

  const meta = {
    snippet: {
      title,
      description,
      tags: tags.length ? tags : ["Shorts", "SONOZZ"],
      categoryId: "10", // Music
    },
    status: {
      privacyStatus: privacy,
      selfDeclaredMadeForKids: false,
    },
  };

  const initRes = await fetch(UPLOAD_INIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken.trim()}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(buffer.length),
      "X-Upload-Content-Type": /mp4/i.test(mimeType)
        ? "video/mp4"
        : /quicktime|mov/i.test(mimeType)
          ? "video/quicktime"
          : mimeType || "video/mp4",
    },
    body: JSON.stringify(meta),
  });

  if (!initRes.ok) {
    const data = await initRes.json().catch(() => ({}));
    throw new Error(youtubeErrorMessage(data, `YouTube init HTTP ${initRes.status}`));
  }

  const uploadUrl = initRes.headers.get("location") || initRes.headers.get("Location");
  if (!uploadUrl) throw new Error("YouTube : pas d’URL resumable (Location manquante)");

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken.trim()}`,
      "Content-Type": /mp4/i.test(mimeType) ? "video/mp4" : mimeType || "video/mp4",
      "Content-Length": String(buffer.length),
    },
    body: buffer,
  });

  const putData = await putRes.json().catch(() => ({}));
  if (!putRes.ok) {
    throw new Error(youtubeErrorMessage(putData, `YouTube upload HTTP ${putRes.status}`));
  }

  const videoId = putData.id;
  if (!videoId) {
    return {
      ok: false,
      platform: "youtube",
      message: "Upload YouTube sans video id — vérifie YouTube Studio.",
    };
  }

  const url = `https://youtube.com/shorts/${videoId}`;
  const privacyNote =
    privacy === "private"
      ? " (privé — visible seulement par toi)"
      : privacy === "unlisted"
        ? " (non listé)"
        : "";

  return {
    ok: true,
    platform: "youtube",
    videoId,
    url,
    privacyStatus: privacy,
    mimeType,
    byteLength: buffer.length,
    title,
    message: `Short YouTube envoyé${privacyNote} — ${url}`,
  };
}
