import { json, error, readBody } from "../../../server/http.js";
import {
  authenticatePassword,
  createSessionToken,
  isAuthConfigured,
  SESSION_COOKIE,
  sessionCookieOptions,
  SSO_PASSWORD_BLOCKED,
} from "../../../server/auth.js";
import { SSO_HINT_COOKIE, oidcCookieOptions } from "../../../server/oidc.js";

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
    const result = await authenticatePassword(email, password);
    if (!result.ok) {
      if (result.reason === "sso_required") {
        return error(SSO_PASSWORD_BLOCKED, 403);
      }
      return error("Identifiants incorrects", 401);
    }
    const token = createSessionToken(email);
    cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    cookies.set(SSO_HINT_COOKIE, "", { ...oidcCookieOptions(0), httpOnly: false, maxAge: 0 });
    return json({ ok: true, email: email.toLowerCase() });
  } catch (e) {
    return error(e.message || "Connexion impossible", 500);
  }
}
