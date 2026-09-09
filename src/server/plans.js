/**
 * Plan quotas & pricing copy — editable from /admin (stored in app_meta).
 * 1 crédit ≈ 1 génération de titre (paroles+audio).
 */
import { getAppMeta, setAppMeta } from "./db.js";

export const BILLING_PLANS_META = "billing_plans_v1";

/** @typedef {{
 *  label: string,
 *  priceLabel: string,
 *  priceMonthlyEur: number,
 *  artists: number,
 *  albums: number,
 *  creditsPerMonth: number,
 *  watermark: boolean,
 *  multiAlbums: boolean,
 *  cleanExport: boolean,
 * }} PlanTier */

export function defaultBillingPlans() {
  return {
    free: {
      label: "Free",
      priceLabel: "0 €",
      priceMonthlyEur: 0,
      artists: 1,
      albums: 1,
      creditsPerMonth: 5,
      watermark: true,
      multiAlbums: false,
      cleanExport: false,
    },
    pro: {
      label: "Pro",
      priceLabel: "12 €/mois",
      priceMonthlyEur: 12,
      artists: 10,
      albums: 50,
      creditsPerMonth: 50,
      watermark: false,
      multiAlbums: true,
      cleanExport: true,
    },
    creditsPack: {
      label: "Pack crédits",
      priceLabel: "9 €",
      priceEur: 9,
      credits: 20,
    },
    publishPlus: {
      label: "Publish+",
      priceLabel: "15 €/mois",
      priceMonthlyEur: 15,
      distrokid: true,
      note: "Add-on DistroKid / stores — sans crédits supplémentaires",
    },
    creditUnitLabel: "génération de titre",
  };
}

function mergePlans(raw) {
  const base = defaultBillingPlans();
  if (!raw || typeof raw !== "object") return base;
  return {
    ...base,
    ...raw,
    free: { ...base.free, ...(raw.free || {}) },
    pro: { ...base.pro, ...(raw.pro || {}) },
    creditsPack: { ...base.creditsPack, ...(raw.creditsPack || {}) },
    publishPlus: { ...base.publishPlus, ...(raw.publishPlus || {}) },
  };
}

export async function getBillingPlans() {
  const raw = await getAppMeta(BILLING_PLANS_META);
  if (!raw) return defaultBillingPlans();
  try {
    return mergePlans(JSON.parse(raw));
  } catch {
    return defaultBillingPlans();
  }
}

export async function saveBillingPlans(plans) {
  const merged = mergePlans(plans);
  const result = await setAppMeta(BILLING_PLANS_META, JSON.stringify(merged));
  return { plans: merged, updatedAt: result.updatedAt };
}

/** Bullets FR for landing / billing cards. */
export function planBullets(plans, tier) {
  const unit = plans.creditUnitLabel || "génération";
  if (tier === "free") {
    const p = plans.free;
    return [
      `${p.artists} artiste${p.artists > 1 ? "s" : ""} max`,
      `${p.albums} album${p.albums > 1 ? "s" : ""} max`,
      `${p.creditsPerMonth} crédits / mois (${unit}s)`,
      p.watermark ? "Watermark / qualité limitée" : "Sans watermark",
      "Lecteur public /play",
    ];
  }
  if (tier === "pro") {
    const p = plans.pro;
    return [
      `Jusqu’à ${p.artists} artistes`,
      `Jusqu’à ${p.albums} albums`,
      `${p.creditsPerMonth} crédits / mois (${unit}s)`,
      p.multiAlbums ? "Multi-albums" : "Albums limités",
      p.cleanExport ? "Export propre" : "Export standard",
      p.watermark ? "Avec watermark" : "Sans watermark",
    ];
  }
  if (tier === "credits") {
    const p = plans.creditsPack;
    return [
      `+${p.credits} crédits (achat unique)`,
      `1 crédit = 1 ${unit}`,
      "S’ajoute à ton solde",
      "Valable Free ou Pro",
    ];
  }
  if (tier === "publish_plus") {
    const p = plans.publishPlus;
    return [
      "Pipeline DistroKid (ou équivalent)",
      "Suivi statut : en cours / publié / échec",
      p.note || "Add-on publication stores",
      "Sans crédits supplémentaires",
    ];
  }
  return [];
}
