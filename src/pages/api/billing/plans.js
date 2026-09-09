import { json, error } from "../../../server/http.js";
import { getBillingPlans, planBullets } from "../../../server/plans.js";

export const prerender = false;

/** GET /api/billing/plans — public pricing copy + quotas. */
export async function GET() {
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
    return error(e.message || "Plans indisponibles", 500);
  }
}
