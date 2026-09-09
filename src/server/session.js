/**
 * Helpers session pour les API (cookies Astro).
 */
import { getSessionFromCookies, ROLE_ADMIN } from "./auth.js";

export function requireSession(cookies) {
  const session = getSessionFromCookies(cookies);
  if (!session?.email) {
    const err = new Error("Non autorisé");
    err.status = 401;
    err.code = "UNAUTHORIZED";
    throw err;
  }
  return session;
}

export function isAdminSession(session) {
  return session?.role === ROLE_ADMIN;
}
