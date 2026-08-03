import { json } from "../../../server/http.js";
import { getSessionFromCookies, isAuthConfigured } from "../../../server/auth.js";

export const prerender = false;

export async function GET({ cookies }) {
  const session = getSessionFromCookies(cookies);
  return json({
    configured: isAuthConfigured(),
    authenticated: Boolean(session),
    email: session?.email || null,
  });
}
