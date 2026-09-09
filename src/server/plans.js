/**
 * Plan quotas & pricing copy — editable from /admin (stored in app_meta).
 * 1 crédit ≈ 1 génération de titre (paroles+audio).
 *
 * Quotas calés sur l’entrée de gamme concurrente (~10–12 €) :
 * Boomy Creator (~10 $/mois, ~25 exports), Suno Pro (~10 $/mois, droits
 * commerciaux + downloads plafonnés), AIVA Standard (~11 €/mois, ~15 exports).
 * SONOZZ facture aussi des profils artistes + albums (catalogue), pas seulement
 * des générations — d’où des plafonds artistes/albums volontairement bas.
 */
import { getAppMeta, setAppMeta } from "./db.js";

/** v2 : plafonds Pro réalistes (2 artistes / 3 albums / 40 crédits). */
export const BILLING_PLANS_META = "billing_plans_v2";

/** Titres cibles par album (défaut création album). */
const TRACKS_PER_ALBUM = 8;

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
      // 2 profils = artiste principal + side / feat — pas un label à 10 rosters
      artists: 2,
      // 3 albums ≈ 24 titres catalogue (3 × 8) — réaliste à 12 €/mois
      albums: 3,
      // ~40 essais / mois (itérations incluses), proche Boomy Creator (25 exports)
      creditsPerMonth: 40,
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

function albumBullet(count) {
  const n = Number(count) || 0;
  const tracks = n * TRACKS_PER_ALBUM;
  if (n <= 0) return "Aucun album";
  if (n === 1) return `1 album (≈ ${TRACKS_PER_ALBUM} titres)`;
  return `${n} albums au total (≈ ${tracks} titres)`;
}

function artistBullet(count, { soft = false } = {}) {
  const n = Number(count) || 0;
  if (n <= 0) return "Aucun profil artiste";
  if (n === 1) return soft ? "1 profil artiste" : "1 profil artiste max";
  return soft ? `Jusqu’à ${n} profils artistes` : `${n} profils artistes max`;
}

function creditsBullet(count, unit) {
  const n = Number(count) || 0;
  return `${n} crédit${n > 1 ? "s" : ""} / mois — 1 crédit = 1 ${unit}`;
}

/** Bullets FR for landing / billing cards. */
export function planBullets(plans, tier) {
  const unit = plans.creditUnitLabel || "génération de titre";
  if (tier === "free") {
    const p = plans.free;
    return [
      artistBullet(p.artists),
      albumBullet(p.albums),
      creditsBullet(p.creditsPerMonth, unit),
      p.watermark ? "Exports avec watermark" : "Exports sans watermark",
      "Écoute publique via /play",
    ];
  }
  if (tier === "pro") {
    const p = plans.pro;
    return [
      artistBullet(p.artists, { soft: true }),
      albumBullet(p.albums),
      creditsBullet(p.creditsPerMonth, unit),
      p.cleanExport && !p.watermark
        ? "Export audio & jaquette sans watermark"
        : p.watermark
          ? "Exports avec watermark"
          : "Export standard",
      p.multiAlbums ? "Plusieurs albums par artiste" : "1 album par artiste",
    ];
  }
  if (tier === "credits") {
    const p = plans.creditsPack;
    return [
      `+${p.credits} crédits en un achat`,
      `1 crédit = 1 ${unit}`,
      "S’ajoute à ton solde actuel",
      "Utilisable en Free ou Pro",
    ];
  }
  if (tier === "publish_plus") {
    const p = plans.publishPlus;
    return [
      "Publication stores (DistroKid ou équivalent)",
      "Suivi : en cours / publié / échec",
      p.note || "Add-on publication — sans crédits en plus",
      "Se cumule avec Free ou Pro",
    ];
  }
  return [];
}
