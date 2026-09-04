import { json } from "../../../server/http.js";
import {
  getSessionFromCookies,
  isAuthConfigured,
  sessionCapabilities,
} from "../../../server/auth.js";
import { isOidcConfigured } from "../../../server/oidc.js";
import { findUserByEmail, resolveRoleForEmail } from "../../../server/users.js";

export const prerender = false;

export async function GET({ cookies }) {
  const session = getSessionFromCookies(cookies);
  let ssoLinked = false;
  let ssoLinkedAt = null;
  let name = null;
  let role = session?.role || null;

  if (session?.email) {
    try {
      const user = await findUserByEmail(session.email);
      ssoLinked = Boolean(user?.ssoLinkedAt);
      ssoLinkedAt = user?.ssoLinkedAt || null;
      name = user?.name || null;
      role = resolveRoleForEmail(session.email, user?.role || session.role);
    } catch {
      role = session.role || resolveRoleForEmail(session.email);
    }
  }

  const caps = session ? sessionCapabilities(role) : sessionCapabilities(null);

  return json({
    configured: isAuthConfigured(),
    oidcConfigured: isOidcConfigured(),
    authenticated: Boolean(session),
    email: session?.email || null,
    name,
    role: session ? caps.role : null,
    canManageSettings: Boolean(session && caps.canManageSettings),
    canInvite: Boolean(session && caps.canInvite),
    ssoLinked,
    ssoLinkedAt,
  });
}
