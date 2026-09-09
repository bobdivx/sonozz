import { json, error, readBody } from "../../../server/http.js";
import { getSessionFromCookies } from "../../../server/auth.js";
import { isAdminRole } from "../../../server/users.js";
import { getBillingPlans, saveBillingPlans, planBullets } from "../../../server/plans.js";

export const prerender = false;

function requireAdmin(cookies) {
  const session = getSessionFromCookies(cookies);
  if (!session?.email) return { error: error("Non autorisé", 401) };
  if (!isAdminRole(session.role)) return { error: error("Réservé à l'administrateur", 403) };
  return { session };
}

export async function GET({ cookies }) {
  const gate = requireAdmin(cookies);
  if (gate.error) return gate.error;
  try {
    const plans = await getBillingPlans();
    return json({
      plans,
      bullets: {
        free: planBullets(plans, "free"),
        pro: planBullets(plans, "pro"),
        credits: planBullets(plans, "credits"),
        publish_plus: planBullets(plans, "publish_plus"),
      },
    });
  } catch (e) {
    return error(e.message || "Lecture plans impossible", 500);
  }
}

export async function PUT({ request, cookies }) {
  const gate = requireAdmin(cookies);
  if (gate.error) return gate.error;
  try {
    const body = await readBody(request);
    const saved = await saveBillingPlans(body?.plans || body);
    return json(saved);
  } catch (e) {
    return error(e.message || "Sauvegarde plans impossible", 500);
  }
}
