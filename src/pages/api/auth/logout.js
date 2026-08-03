import { json, error } from "../../../server/http.js";
import { SESSION_COOKIE, sessionCookieOptions } from "../../../server/auth.js";

export const prerender = false;

export async function POST({ cookies }) {
  try {
    cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(0), maxAge: 0 });
    return json({ ok: true });
  } catch (e) {
    return error(e.message || "Déconnexion impossible", 500);
  }
}
