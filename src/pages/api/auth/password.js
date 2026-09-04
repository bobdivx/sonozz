import { json, error, readBody } from "../../../server/http.js";
import {
  getSessionFromCookies,
  verifyEnvCredentials,
  SESSION_COOKIE,
  sessionCookieOptions,
  createSessionToken,
} from "../../../server/auth.js";
import {
  findUserByEmail,
  setUserPassword,
  resolveRoleForEmail,
} from "../../../server/users.js";
import {
  isPasswordStrongEnough,
  MIN_PASSWORD_LEN,
  verifyPassword,
} from "../../../server/password.js";

export const prerender = false;

/**
 * Change le mot de passe du compte connecté.
 * Body: { currentPassword, newPassword }
 */
export async function POST({ request, cookies }) {
  try {
    const session = getSessionFromCookies(cookies);
    if (!session?.email) return error("Non autorisé", 401);

    const body = await readBody(request);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");

    if (!currentPassword || !newPassword) {
      return error("Mot de passe actuel et nouveau requis", 400);
    }
    if (!isPasswordStrongEnough(newPassword)) {
      return error(`Nouveau mot de passe trop court (min. ${MIN_PASSWORD_LEN})`, 400);
    }

    const email = session.email;
    const user = await findUserByEmail(email);

    let currentOk = false;
    if (verifyEnvCredentials(email, currentPassword)) {
      currentOk = true;
    } else if (user?.passwordHash && verifyPassword(currentPassword, user.passwordHash)) {
      currentOk = true;
    }

    if (!currentOk) return error("Mot de passe actuel incorrect", 401);

    await setUserPassword(email, newPassword);

    const role = resolveRoleForEmail(email, user?.role || session.role);
    cookies.set(SESSION_COOKIE, createSessionToken(email, role), sessionCookieOptions());

    return json({ ok: true });
  } catch (e) {
    return error(e.message || "Impossible de changer le mot de passe", 500);
  }
}
