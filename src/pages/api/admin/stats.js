import { json, error } from "../../../server/http.js";
import { getSessionFromCookies } from "../../../server/auth.js";
import { isAdminRole } from "../../../server/users.js";
import { getAdminStats } from "../../../server/adminStats.js";

export const prerender = false;

export async function GET({ cookies }) {
  const session = getSessionFromCookies(cookies);
  if (!session?.email) return error("Non autorisé", 401);
  if (!isAdminRole(session.role)) return error("Réservé à l'administrateur", 403);

  try {
    const stats = await getAdminStats();
    return json(stats);
  } catch (e) {
    return error(e.message || "Impossible de charger les stats", 500);
  }
}
