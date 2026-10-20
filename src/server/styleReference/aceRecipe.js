/**
 * « Recette » ACE automatique quand un artiste a un artiste de référence (validée sur Skarlvind v4) :
 *   1. titre de référence REPRÉSENTATIF (album, proche de la médiane du style) → styleLock.styleReference
 *      (Deezer, mode « reference », force 1.0, jamais cover ; aperçu redemandé à chaque génération) ;
 *   2. caption ACE en tags courts → styleLock.aceCaption (règles : src/lib/aceCaption.js) ;
 *   3. profil qualité cible mesuré sur l'extrait → styleLock.qualityProfile (contrôle des prises).
 * Rien n'est écrit en base ici : le profil est renvoyé à l'app, qui l'enregistre à la demande de l'utilisateur.
 */
import { pickRepresentativeTrack } from "./representativeTrack.js";
import { resolveArtistStyleReference } from "../aceStep/artistStyleRef.js";
import { buildAceCaption, sanitizeAceCaption, aceCaptionLlmRules } from "../../lib/aceCaption.js";

export const ACE_RECIPE_VERSION = 1;

async function qualityTools() {
  try {
    const q = await import("../quality/index.js");
    return (await q.qualityCheckAvailable()) ? q : null;
  } catch (e) {
    console.warn("[ace-recipe] contrôle qualité indisponible:", e?.message || e);
    return null;
  }
}

function refArtistName(lock) {
  if (lock?.seedTrack?.artistName) return lock.seedTrack.artistName;
  if (Array.isArray(lock?.refs) && lock.refs[0]?.matchedName) return lock.refs[0].matchedName;
  return lock?.matchedName || lock?.query || "";
}

/** Titre choisi par l'utilisateur (seedTrack Deezer) prioritaire sur le choix auto. */
function seedTrackReference(lock) {
  const st = lock?.seedTrack;
  if (st?.source === "deezer" && st?.sourceId) {
    return {
      source: "deezer",
      deezerTrackId: String(st.sourceId).replace(/\D+/g, ""),
      title: `${st.title}${st.artistName ? ` — ${st.artistName}` : ""}`,
      album: st.album || undefined,
      mode: "reference",
      strength: 1,
      auto: false,
      method: "seed-track",
    };
  }
  return null;
}

async function llmCaption(keys, { lock, base, names, duo }) {
  if (!keys) return null;
  try {
    const { llmJson, requireTextLlm } = await import("../llm.js");
    requireTextLlm(keys);
    const data = await llmJson(
      keys,
      `Tu écris la caption de style pour le modèle musical ACE-Step.
${aceCaptionLlmRules({ duo, rough: base.rough, noGuitars: base.noGuitars })}
Genres catalogue confirmés : ${JSON.stringify(base.genres)}
Fiche style (sources réelles) : ${JSON.stringify({
        genres: lock.genres, instruments: lock.instruments, timbre: lock.timbre, vocalStyle: lock.vocalStyle,
        duoVocals: lock.duoVocals, bpm: lock.bpm, rhythmFeel: lock.rhythmFeel, production: lock.production,
      })}
Proposition de départ (à améliorer sans enfreindre les règles) : ${JSON.stringify(base.caption)}
JSON strict : {"caption": string}`,
    );
    const c = sanitizeAceCaption(data?.caption, { names, rough: base.rough, noGuitars: base.noGuitars, duo });
    return c && c.length > 40 ? c : null;
  } catch (e) {
    console.warn("[ace-recipe] caption LLM ignorée:", e?.message || e);
    return null;
  }
}

/**
 * @param {object} p
 * @param {object} p.styleLock     styleLock résolu (resolveStyleReference / clone / existant)
 * @param {boolean} [p.duo]
 * @param {"male"|"female"|null} [p.leadGender]
 * @param {string[]} [p.names]     noms à exclure de la caption (membres, nom de scène)
 * @param {object} [p.keys]        clés utilisateur (LLM facultatif pour affiner la caption)
 * @param {"auto"|"keep"} [p.reference] keep = garder une référence déjà présente (ex. Skarlvind / Mantra)
 * @param {object} [p.deezerTrack] { deezerTrackId, title } imposé par l'utilisateur
 */
export async function buildAceRecipe({ styleLock, duo = false, leadGender = null, names = [], keys = null, reference = "keep", deezerTrack = null, fetchImpl = fetch } = {}) {
  const lock = styleLock && typeof styleLock === "object" ? styleLock : {};
  const q = await qualityTools();
  const notes = [];

  // 1. référence de style
  let styleReference = null;
  if (deezerTrack?.deezerTrackId) {
    styleReference = {
      source: "deezer",
      deezerTrackId: String(deezerTrack.deezerTrackId).replace(/\D+/g, ""),
      title: String(deezerTrack.title || "style reference").slice(0, 120),
      mode: "reference",
      strength: 1,
      auto: false,
      method: "user",
    };
  } else if (reference === "keep" && lock.styleReference && lock.styleReference.enabled !== false) {
    styleReference = lock.styleReference;
  } else if (lock.styleReference?.enabled === false && reference === "keep") {
    styleReference = lock.styleReference;
  } else {
    styleReference = seedTrackReference(lock);
    if (!styleReference) {
      styleReference = await pickRepresentativeTrack({
        name: refArtistName(lock),
        deezerArtistId: lock.source === "deezer" && /^\d+$/.test(String(lock.sourceId || "")) ? lock.sourceId : undefined,
        fetchImpl,
        analyzeStyle: q ? (url) => q.analyzeStyleQuick(url, { fetchImpl }) : null,
      }).catch((e) => {
        notes.push(`référence: ${e?.message || e}`);
        return null;
      });
      if (styleReference?.measured) delete styleReference.measured; // pas de poids mort en base
    }
  }

  // 2. profil qualité mesuré sur l'extrait de référence
  let qualityProfile = null;
  let refUrl = null;
  if (styleReference && styleReference.enabled !== false && q) {
    const resolved = await resolveArtistStyleReference({ styleReference }, { fetchImpl }).catch(() => null);
    refUrl = resolved?.url || null;
    if (refUrl) {
      try {
        const analysis = await q.analyzeTake(refUrl, { duo, nBlocks: 3, fetchImpl });
        qualityProfile = q.buildQualityProfile(analysis, { duo, source: styleReference.title });
      } catch (e) {
        notes.push(`profil: ${e?.message || e}`);
      }
    }
  }

  // 3. caption
  const catalogGenres = [
    ...(Array.isArray(styleReference?.albumGenres) ? styleReference.albumGenres : []),
    ...(Array.isArray(lock.catalogGenres) ? lock.catalogGenres : []),
  ];
  const base = buildAceCaption({ styleLock: lock, catalogGenres, duo, leadGender, names, measured: qualityProfile });
  const refined = await llmCaption(keys, { lock, base, names, duo });
  return {
    styleReference: styleReference || undefined,
    aceCaption: refined || base.caption,
    aceCaptionMeta: { source: refined ? "llm+rules" : "rules", rough: base.rough, noGuitars: base.noGuitars, genres: base.genres },
    qualityProfile: qualityProfile || undefined,
    aceRecipe: { version: ACE_RECIPE_VERSION, at: new Date().toISOString(), notes: notes.length ? notes : undefined },
  };
}

/** Applique la recette au styleLock (copie). */
export function applyAceRecipe(styleLock, recipe) {
  if (!styleLock || !recipe) return styleLock;
  const out = { ...styleLock };
  for (const k of ["styleReference", "aceCaption", "aceCaptionMeta", "qualityProfile", "aceRecipe"]) {
    if (recipe[k] !== undefined) out[k] = recipe[k];
  }
  return out;
}
