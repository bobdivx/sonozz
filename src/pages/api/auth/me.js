import { json } from "../../../server/http.js";
import { getSessionFromCookies, isAuthConfigured } from "../../../server/auth.js";
import { isOidcConfigured } from "../../../server/oidc.js";
import { findUserByEmail } from "../../../server/users.js";

export const prerender = false;

export async function GET({ cookies }) {
  const session = getSessionFromCookies(cookies);
  let ssoLinked = false;
  let ssoLinkedAt = null;
  if (session?.email) {
    try {
      const user = await findUserByEmail(session.email);
      ssoLinked = Boolean(user?.ssoLinkedAt);
      ssoLinkedAt = user?.ssoLinkedAt || null;
    } catch {
      /* Turso indisponible : on ne bloque pas /me */
    }
  }
  return json({
    configured: isAuthConfigured(),
    oidcConfigured: isOidcConfigured(),
    authenticated: Boolean(session),
    email: session?.email || null,
    ssoLinked,
    ssoLinkedAt,
  });
}
