import { json, error, readBody } from "../../../server/http.js";
import {
  createSessionToken,
  isAuthConfigured,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifyCredentials,
} from "../../../server/auth.js";

export const prerender = false;

export async function POST({ request, cookies }) {
  try {
    if (!isAuthConfigured()) {
      return error("Auth non configurée (AUTH_EMAIL / AUTH_PASSWORD)", 503);
    }
    const body = await readBody(request);
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    if (!email || !password) return error("Email et mot de passe requis", 400);
    if (!verifyCredentials(email, password)) {
      return error("Identifiants incorrects", 401);
    }
    const token = createSessionToken(email);
    cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return json({ ok: true, email: email.toLowerCase() });
  } catch (e) {
    return error(e.message || "Connexion impossible", 500);
  }
}
