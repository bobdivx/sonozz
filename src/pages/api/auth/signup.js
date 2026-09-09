import { json, error, readBody } from "../../../server/http.js";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
  ROLE_MEMBER,
} from "../../../server/auth.js";
import { findUserByEmail, createUser } from "../../../server/users.js";
import { hashPassword, isPasswordStrongEnough, MIN_PASSWORD_LEN } from "../../../server/password.js";
import { grantSignupCredits } from "../../../server/credits.js";
import { SSO_HINT_COOKIE, oidcCookieOptions } from "../../../server/oidc.js";

export const prerender = false;

/**
 * POST /api/auth/signup — inscription self-serve (tout nouveau compte → plan Free).
 */
export async function POST({ request, cookies }) {
  try {
    const body = await readBody(request);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = body.name != null ? String(body.name).trim() : "";

    if (!email || !email.includes("@")) {
      return error("Email invalide", 400);
    }
    if (!isPasswordStrongEnough(password)) {
      return error(`Mot de passe trop court (min. ${MIN_PASSWORD_LEN})`, 400);
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return error("Un compte existe déjà avec cet email — connecte-toi", 409);
    }

    const passwordHash = hashPassword(password);
    const user = await createUser({
      email,
      passwordHash,
      name: name || null,
      role: ROLE_MEMBER,
    });

    let credits = 0;
    try {
      const grant = await grantSignupCredits(email);
      credits = grant.balance;
    } catch (e) {
      console.warn("[signup] grant credits", e?.message || e);
    }

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
      plan: "free",
      credits,
    });
  } catch (e) {
    console.error("[signup]", e?.message || e);
    return error(e.message || "Inscription impossible", 400);
  }
}
