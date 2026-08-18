import { createHash, randomBytes } from "node:crypto";

export const OIDC_STATE_COOKIE = "sonozz_oidc_state";
export const OIDC_VERIFIER_COOKIE = "sonozz_oidc_verifier";
export const OIDC_NEXT_COOKIE = "sonozz_oidc_next";
export const OIDC_INTENT_COOKIE = "sonozz_oidc_intent";
export const SSO_HINT_COOKIE = "sonozz_sso_hint";
export const CALLBACK_PATH = "/api/auth/callback/pocket-id";
export const START_PATH = "/api/auth/pocket-id";

const DISCOVERY_TTL_MS = 1000 * 60 * 10;
let discoveryCache = { url: "", at: 0, doc: null };

function procEnv() {
  return typeof process !== "undefined" ? process.env || {} : {};
}

function pickEnv(proc, meta, keys) {
  for (const key of keys) {
    const v = String(proc[key] || "").trim();
    if (v) return v;
  }
  for (const key of keys) {
    const v = String(meta[key] || "").trim();
    if (v) return v;
  }
  return "";
}

/**
 * Issuer / client depuis les variables DevForge. Aucune URL Pocket ID en dur.
 */
export function getOidcConfig() {
  const meta = import.meta.env || {};
  const proc = procEnv();
  const issuer = pickEnv(proc, meta, [
    "OIDC_ISSUER",
    "OIDC_ISSUER_URL",
    "AUTH_POCKET_ID_ISSUER",
    "POCKET_ID_URL",
  ]).replace(/\/+$/, "");
  const discoveryUrl =
    pickEnv(proc, meta, ["OIDC_DISCOVERY_URL"]) ||
    (issuer ? `${issuer}/.well-known/openid-configuration` : "");
  const clientId = pickEnv(proc, meta, ["OIDC_CLIENT_ID", "AUTH_POCKET_ID_ID"]);
  const clientSecret = pickEnv(proc, meta, [
    "OIDC_CLIENT_SECRET",
    "AUTH_POCKET_ID_SECRET",
  ]);
  const scopes = pickEnv(proc, meta, ["OIDC_SCOPES"]) || "openid email profile";
  return { issuer, discoveryUrl, clientId, clientSecret, scopes };
}

export function isOidcConfigured() {
  const { issuer, clientId, clientSecret } = getOidcConfig();
  return Boolean(issuer && clientId && clientSecret);
}

export function oidcCookieOptions(maxAgeSec = 600) {
  const meta = import.meta.env || {};
  const proc = procEnv();
  const secure = String(meta.AUTH_SECURE || proc.AUTH_SECURE || "").trim() === "1";
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSec,
  };
}

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

export function randomOidcState() {
  return randomBytes(24).toString("hex");
}

export async function fetchOidcDiscovery() {
  const { discoveryUrl } = getOidcConfig();
  if (!discoveryUrl) throw new Error("OIDC_DISCOVERY_URL / issuer manquant");
  const now = Date.now();
  if (discoveryCache.doc && discoveryCache.url === discoveryUrl && now - discoveryCache.at < DISCOVERY_TTL_MS) {
    return discoveryCache.doc;
  }
  const res = await fetch(discoveryUrl, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Discovery OIDC indisponible (${res.status})`);
  }
  const doc = await res.json();
  if (!doc?.authorization_endpoint || !doc?.token_endpoint) {
    throw new Error("Discovery OIDC incomplète");
  }
  discoveryCache = { url: discoveryUrl, at: now, doc };
  return doc;
}

export function buildOidcAuthorizeUrl({
  authorizationEndpoint,
  clientId,
  redirectUri,
  scopes,
  state,
  codeChallenge,
  nonce,
}) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    nonce,
  });
  return `${authorizationEndpoint}?${params.toString()}`;
}

export async function exchangeOidcCode({
  tokenEndpoint,
  clientId,
  clientSecret,
  code,
  redirectUri,
  codeVerifier,
}) {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: codeVerifier,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`Échange token OIDC : ${detail}`);
  }
  return data;
}

export async function fetchOidcUserinfo(userinfoEndpoint, accessToken) {
  if (!userinfoEndpoint || !accessToken) return null;
  const res = await fetch(userinfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

/** Décode le payload JWT sans vérifier la signature (le token endpoint a déjà authentifié le client). */
export function decodeJwtPayload(jwt) {
  if (!jwt || typeof jwt !== "string") return null;
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function claimsFromOidcTokens(tokens, userinfo) {
  const idClaims = decodeJwtPayload(tokens?.id_token) || {};
  const info = userinfo && typeof userinfo === "object" ? userinfo : {};
  const email = String(info.email || idClaims.email || "")
    .trim()
    .toLowerCase();
  const sub = String(info.sub || idClaims.sub || "").trim();
  const name = String(info.name || idClaims.name || info.preferred_username || "").trim();
  return { email, sub, name };
}
