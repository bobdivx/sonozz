import { json, error, readBody } from "../../../server/http.js";
import { getSessionFromCookies } from "../../../server/auth.js";
import {
  isAdminRole,
  listUsers,
  disableUser,
  enableUser,
} from "../../../server/users.js";
import { listInvitations, createInvitation } from "../../../server/invites.js";

export const prerender = false;

function requireAdmin(cookies) {
  const session = getSessionFromCookies(cookies);
  if (!session?.email) return { error: error("Non autorisé", 401) };
  if (!isAdminRole(session.role)) return { error: error("Réservé à l’administrateur", 403) };
  return { session };
}

export async function GET({ cookies }) {
  const admin = requireAdmin(cookies);
  if (admin.error) return admin.error;

  try {
    const [invites, users] = await Promise.all([listInvitations(), listUsers()]);
    return json({
      invites,
      members: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        disabledAt: u.disabledAt,
        ssoLinkedAt: u.ssoLinkedAt,
        createdAt: u.createdAt,
      })),
    });
  } catch (e) {
    return error(e.message || "Impossible de lister l’équipe", 500);
  }
}

export async function POST({ request, cookies }) {
  const admin = requireAdmin(cookies);
  if (admin.error) return admin.error;

  try {
    const body = await readBody(request);
    const email = String(body.email || "").trim();
    const result = await createInvitation({
      email,
      invitedBy: admin.session.email,
      request,
    });
    return json({ ok: true, invite: result.invite });
  } catch (e) {
    return error(e.message || "Invitation impossible", 400);
  }
}

/** Actions admin sur membres : { action: 'disable'|'enable', email } */
export async function PATCH({ request, cookies }) {
  const admin = requireAdmin(cookies);
  if (admin.error) return admin.error;

  try {
    const body = await readBody(request);
    const action = String(body.action || "");
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) return error("Email requis", 400);
    if (email === admin.session.email) {
      return error("Tu ne peux pas te désactiver toi-même", 400);
    }

    if (action === "disable") {
      const user = await disableUser(email);
      return json({ ok: true, member: user });
    }
    if (action === "enable") {
      const user = await enableUser(email);
      return json({ ok: true, member: user });
    }
    return error("Action inconnue", 400);
  } catch (e) {
    return error(e.message || "Action impossible", 400);
  }
}
