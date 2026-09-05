import { json, error } from "../../../server/http.js";
import { getSessionFromCookies } from "../../../server/auth.js";
import { isAdminRole } from "../../../server/users.js";
import { revokeInvitation } from "../../../server/invites.js";

export const prerender = false;

export async function DELETE({ cookies, params }) {
  const session = getSessionFromCookies(cookies);
  if (!session?.email) return error("Non autorisé", 401);
  if (!isAdminRole(session.role)) return error("Réservé à l’administrateur", 403);

  try {
    const id = String(params.id || "");
    const invite = await revokeInvitation(id);
    return json({ ok: true, invite });
  } catch (e) {
    return error(e.message || "Révocation impossible", 400);
  }
}
