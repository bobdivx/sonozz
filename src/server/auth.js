import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { isOidcConfigured } from "./oidc.js";
import {
  isSsoLinkedEmail,
  resolveRoleForEmail,
  resolveSessionRole,
  ROLE_ADMIN,
  ROLE_MEMBER,
  verifyUserPassword,
  findUserByEmail,
} from "./users.js";

export const SESSION_COOKIE = "sonozz_session";
export const SSO_PASSWORD_BLOCKED = "Ce compte se connecte avec Pocket ID";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 jours

/**
 * Accès STATIQUE à import.meta.env (Vite n’injecte pas les clés dynamiques).
 */
export function getAuthConfig() {
  const meta = import.meta.env || {};
  const proc = typeof process !== "undefined" ? process.env || {} : {};
  return {
    email: String(meta.AUTH_EMAIL || proc.AUTH_EMAIL || "")
      .trim()
      .toLowerCase(),
    password: String(meta.AUTH_PASSWORD || proc.AUTH_PASSWORD || ""),
    secret: String(
      meta.AUTH_SECRET ||
        proc.AUTH_SECRET ||
        meta.TURSO_AUTH_TOKEN ||
        proc.TURSO_AUTH_TOKEN ||
        "sonozz-dev-secret",
    ).trim(),
    // Uniquement si AUTH_SECURE=1 (HTTPS). Ne pas lier à PROD : un build
    // servi en http://localhost casserait sinon le cookie de session.
    secure: String(meta.AUTH_SECURE || proc.AUTH_SECURE || "").trim() === "1",
  };
}

export function isAuthConfigured() {
  const { email, password } = getAuthConfig();
  return Boolean(email && password);
}

/** Studio protégé si mot de passe OU Pocket ID est configuré. */
export function isAccessControlEnabled() {
  return isAuthConfigured() || isOidcConfigured();
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

export function verifyEnvCredentials(email, password) {
  const cfg = getAuthConfig();
  if (!cfg.email || !cfg.password) return false;
  const okEmail = safeEqual(String(email || "").trim().toLowerCase(), cfg.email);
  const okPass = safeEqual(String(password || ""), cfg.password);
  return okEmail && okPass;
}

/** @deprecated use verifyEnvCredentials */
export function verifyCredentials(email, password) {
  return verifyEnvCredentials(email, password);
}

/**
 * Login mot de passe : refuse si CE user a lié Pocket ID.
 * @returns {{ ok: true, role?: string } | { ok: false, reason: 'invalid' | 'sso_required' | 'disabled' }}
 */
export function decidePasswordLogin(credentialsOk, ssoLinked, role = ROLE_MEMBER) {
  if (!credentialsOk) return { ok: false, reason: "invalid" };
  if (ssoLinked) return { ok: false, reason: "sso_required" };
  return { ok: true, role };
}

export async function authenticatePassword(email, password) {
  const normalized = String(email || "").trim().toLowerCase();
  const ssoLinked = await isSsoLinkedEmail(normalized);

  if (verifyEnvCredentials(normalized, password)) {
    try {
      const user = await findUserByEmail(normalized);
      if (user?.disabledAt) return { ok: false, reason: "disabled" };
    } catch {
      /* ignore */
    }
    return decidePasswordLogin(true, ssoLinked, ROLE_ADMIN);
  }

  try {
    const user = await verifyUserPassword(normalized, password);
    if (!user) return { ok: false, reason: "invalid" };
    const role = resolveRoleForEmail(normalized, user.role);
    return decidePasswordLogin(true, ssoLinked, role);
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

function sign(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Session : email|role|exp|nonce|sig (nouveau) ou email|exp|nonce|sig (legacy).
 */
export function createSessionToken(email, role = null) {
  const { secret } = getAuthConfig();
  const normalized = String(email).trim().toLowerCase();
  const resolved = role || resolveRoleForEmail(normalized);
  const exp = Date.now() + SESSION_TTL_MS;
  const nonce = randomBytes(8).toString("hex");
  const payload = `${normalized}|${resolved}|${exp}|${nonce}`;
  return `${payload}|${sign(payload, secret)}`;
}

export function readSessionToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split("|");
  const { secret } = getAuthConfig();

  // Nouveau : email|role|exp|nonce|sig
  if (parts.length === 5) {
    const [email, role, expStr, nonce, sig] = parts;
    const payload = `${email}|${role}|${expStr}|${nonce}`;
    const expectedSig = sign(payload, secret);
    if (!safeEqual(sig, expectedSig)) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return null;
    const resolvedRole = role === ROLE_ADMIN ? ROLE_ADMIN : ROLE_MEMBER;
    return { email, role: resolvedRole, exp };
  }

  // Legacy : email|exp|nonce|sig
  if (parts.length === 4) {
    const [email, expStr, nonce, sig] = parts;
    const payload = `${email}|${expStr}|${nonce}`;
    const expectedSig = sign(payload, secret);
    if (!safeEqual(sig, expectedSig)) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return null;
    return { email, role: resolveRoleForEmail(email), exp };
  }

  return null;
}

export function getSessionFromCookies(cookies) {
  try {
    const raw = cookies?.get?.(SESSION_COOKIE)?.value;
    return readSessionToken(raw);
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeSec = Math.floor(SESSION_TTL_MS / 1000)) {
  const { secure } = getAuthConfig();
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSec,
  };
}

export function sessionCapabilities(role) {
  const isAdmin = role === ROLE_ADMIN;
  return {
    role: isAdmin ? ROLE_ADMIN : ROLE_MEMBER,
    canManageSettings: isAdmin,
    canInvite: isAdmin,
  };
}

/** Chemins réservés aux admins (paramètres sensibles). */
export function isAdminOnlyPath(pathname) {
  if (!pathname) return false;
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/parametres" || p === "/lab/ace") return true;
  if (p === "/api/keys" || p === "/api/test-keys" || p === "/api/db-test") return true;
  if (p === "/api/invites" || p.startsWith("/api/invites/")) {
    // accept est public
    if (p === "/api/invites/accept") return false;
    return true;
  }
  return false;
}

/** Chemins accessibles sans connexion (écoute publique). */
export function isPublicPath(pathname) {
  if (!pathname) return false;
  const p = pathname.replace(/\/+$/, "") || "/";

  if (p === "/play" || p === "/login" || p === "/403" || p === "/500") return true;
  if (p === "/rejoindre") return true;
  if (p === "/api/library" || p === "/api/audio/stream") return true;
  // Portraits du lecteur public (/play liste les artistes via /api/library).
  if (/^\/api\/artists\/[^/]+\/photo$/.test(p)) return true;
  if (p === "/api/auth/login" || p === "/api/auth/logout" || p === "/api/auth/me") return true;
  if (p === "/api/auth/pocket-id" || p === "/api/auth/sso-status") return true;
  if (p === "/api/auth/callback/pocket-id") return true;
  if (p === "/api/invites/accept") return true;

  if (p.startsWith("/_astro/") || p.startsWith("/assets/")) return true;
  if (p === "/favicon.ico" || p === "/favicon.svg" || p === "/logo.png" || p === "/apple-touch-icon.png") return true;
  if (p === "/sonozz-tiktok-app-icon.png") return true;

  return false;
}

export { resolveSessionRole, ROLE_ADMIN, ROLE_MEMBER };
