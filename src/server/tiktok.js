/**
 * TikTok Login Kit — OAuth (Web HTTPS ou Desktop localhost) + Content Posting.
 * Desktop : PKCE obligatoire, challenge = HEX(SHA256(verifier)) — pas base64url.
 * Web : redirect HTTPS, PKCE non requis selon la doc Login Kit Web.
 * @see https://developers.tiktok.com/doc/login-kit-desktop
 * @see https://developers.tiktok.com/doc/login-kit-web
 */

import { createHash, randomBytes } from "node:crypto";

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
/**
 * Scope Login Kit de base uniquement.
 * `video.upload` casse souvent l’auth si Content Posting API n’est pas encore approuvé.
 * On pourra l’ajouter après connexion réussie / review TikTok.
 */
const DEFAULT_SCOPES = "user.info.basic";

export function defaultRedirectUri(origin) {
  const base = (origin || "").replace(/\/$/, "");
  return `${base}/tiktok/callback`;
}

export function sanitizeClientKey(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width / BOM
    .replace(/\s+/g, "");
}

export function isDesktopRedirect(redirectUri) {
  try {
    const host = new URL(redirectUri).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * PKCE pour Desktop TikTok : challenge = hex(sha256(verifier)).
 * @see https://developers.tiktok.com/doc/login-kit-desktop
 */
export function createPkcePair() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = randomBytes(64);
  let codeVerifier = "";
  for (let i = 0; i < 64; i++) codeVerifier += chars[bytes[i] % chars.length];

  const codeChallenge = createHash("sha256").update(codeVerifier, "utf8").digest("hex");
  return { codeVerifier, codeChallenge, codeChallengeMethod: "S256" };
}

/**
 * Construit l’URL comme dans les exemples TikTok (scope non sur-encodé au-delà de form-urlencoded).
 */
export function buildAuthorizeUrl({
  clientKey,
  redirectUri,
  state,
  scopes = DEFAULT_SCOPES,
  codeChallenge,
  codeChallengeMethod = "S256",
}) {
  const key = sanitizeClientKey(clientKey);
  const parts = [
    `client_key=${encodeURIComponent(key)}`,
    `response_type=code`,
    // Virgules du scope laissées lisibles (comme les exemples TikTok)
    `scope=${String(scopes || DEFAULT_SCOPES)
      .split(",")
      .map((s) => encodeURIComponent(s.trim()))
      .join(",")}`,
    `redirect_uri=${encodeURIComponent(redirectUri)}`,
    `state=${encodeURIComponent(state || crypto.randomUUID())}`,
  ];
  if (codeChallenge) {
    parts.push(`code_challenge=${encodeURIComponent(codeChallenge)}`);
    parts.push(`code_challenge_method=${encodeURIComponent(codeChallengeMethod)}`);
  }
  return `${AUTH_URL}?${parts.join("&")}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg =
      data.error_description ||
      data.message ||
      (typeof data.error === "string" ? data.error : data.error?.message) ||
      `TikTok token HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function exchangeCodeForToken({
  clientKey,
  clientSecret,
  code,
  redirectUri,
  codeVerifier,
}) {
  // TikTok renvoie souvent un code URL-encodé — à décoder avant l’échange.
  const decodedCode = decodeURIComponent(String(code || "").trim());
  const body = {
    client_key: sanitizeClientKey(clientKey),
    client_secret: String(clientSecret || "").trim(),
    code: decodedCode,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  };
  if (codeVerifier) body.code_verifier = codeVerifier;
  return tokenRequest(body);
}

export async function refreshAccessToken({ clientKey, clientSecret, refreshToken }) {
  return tokenRequest({
    client_key: sanitizeClientKey(clientKey),
    client_secret: String(clientSecret || "").trim(),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

/**
 * Retourne un access_token utilisable, en refresh si possible.
 * @returns {{ token: string, refreshed?: object } | null}
 */
export async function getTikTokAccess(keys) {
  const access = keys?.tiktokAccessToken?.trim();
  const refresh = keys?.tiktokRefreshToken?.trim();
  const clientKey = keys?.tiktokClientKey?.trim();
  const clientSecret = keys?.tiktokClientSecret?.trim();

  if (access) return { token: access };

  if (refresh && clientKey && clientSecret) {
    const data = await refreshAccessToken({
      clientKey,
      clientSecret,
      refreshToken: refresh,
    });
    if (!data.access_token) throw new Error("Refresh TikTok sans access_token");
    return { token: data.access_token, refreshed: data };
  }

  return null;
}
