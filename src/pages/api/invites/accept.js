import { json, error, readBody } from "../../../server/http.js";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "../../../server/auth.js";
import { acceptInvitation, findPendingInviteByToken } from "../../../server/invites.js";
import { ROLE_MEMBER } from "../../../server/users.js";
import { SSO_HINT_COOKIE, oidcCookieOptions } from "../../../server/oidc.js";

export const prerender = false;

export async function GET({ url }) {
  try {
    const token = String(url.searchParams.get("token") || "");
    if (!token) return error("Token manquant", 400);
    const check = await findPendingInviteByToken(token);
    if (!check.ok) {
      return json(
        {
          ok: false,
          reason: check.reason,
          email: check.invite?.email || null,
        },
        check.reason === "expired" ? 410 : 400,
      );
    }
    return json({
      ok: true,
      email: check.invite.email,
      expiresAt: check.invite.expiresAt,
    });
  } catch (e) {
    return error(e.message || "Validation impossible", 500);
  }
}

export async function POST({ request, cookies }) {
  try {
    const body = await readBody(request);
    const token = String(body.token || "");
    const password = String(body.password || "");
    const name = body.name != null ? String(body.name) : "";

    if (!token || !password) {
      return error("Token et mot de passe requis", 400);
    }

    const { user, email } = await acceptInvitation({
      token,
      password,
      name: name || null,
    });

    cookies.set(
      SESSION_COOKIE,
      createSessionToken(email, user.role || ROLE_MEMBER),
      sessionCookieOptions(),
    );
    cookies.set(SSO_HINT_COOKIE, "", { ...oidcCookieOptions(0), httpOnly: false, maxAge: 0 });

    return json({
      ok: true,
      email,
      role: user.role || ROLE_MEMBER,
      name: user.name || null,
    });
  } catch (e) {
    return error(e.message || "Acceptation impossible", 400);
  }
}
