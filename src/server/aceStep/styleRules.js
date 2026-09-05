/**
 * Règles ACE-Step style caption — source unique.
 * Utilisées par le squelette (assemble), le prompt LLM, et enforceAceStyleLocks.
 *
 * Éditer ICI pour changer le comportement qualité (genre, clarté, full band…).
 */

/** Plafond hard ACE (troncature côté moteur au-delà). */
export const ACE_STYLE_CAP = 700;

/** Cible LLM (marge sous le plafond). */
export const ACE_STYLE_TARGET = 650;

/** Solo déjà court → pas de compress LLM. */
export const ACE_STYLE_LLM_SKIP_MAX = 520;

/** Bump si les règles changent (invalide le cache mémoire). */
export const ACE_STYLE_RULES_VERSION = 2;

/** Interdits récurrents (vocoder, mash genre, etc.). */
export const ACE_STYLE_AVOID = [
  "vocoder",
  "heavy autotune",
  "digital distortion",
  "muffled distant vocal",
  "Sister Act essay",
  "conflicting multi-genre paragraphs",
  "truncated mid-sentence",
  "drums-only / sparse one-instrument loop",
];

/** Bits toujours exigés (hors genre vocal dynamique). */
export const ACE_STYLE_MUST_CORE = [
  "full multi-instrument band",
  "never drums-only",
  "dry clear natural vocals, intelligible lyrics",
  "section dynamics (verse lean → thicker chorus → bridge → biggest final chorus)",
];

export const ACE_STYLE_FALLBACK_CLARITY =
  "clear articulate vocals, intelligible lyrics";

export const ACE_STYLE_FALLBACK_BAND =
  "full band always: guitar, bass, drums, keys";

/** Préfixe genre — ACE pondère le début du caption. */
export function aceGenderHardPrefix(genderCode) {
  if (genderCode === "female") {
    return "female lead vocal, woman singer, clear articulate female voice";
  }
  if (genderCode === "male") {
    return "male lead vocal, man singer, clear articulate male voice";
  }
  return null;
}

export function aceGenderMustKeep(genderCode) {
  if (genderCode === "female") {
    return "female lead vocal, woman singer (HARD — never male / man singer)";
  }
  if (genderCode === "male") {
    return "male lead vocal, man singer (HARD — never female / woman singer)";
  }
  return null;
}

/**
 * Liste mustKeep / avoid pour le brief LLM + logs.
 * @param {{ genderCode?: string|null, duo?: boolean, bilingualBit?: string|null }} opts
 */
export function buildAceStyleBriefLocks({
  genderCode = null,
  duo = false,
  bilingualBit = null,
} = {}) {
  return {
    mustKeep: [
      aceGenderMustKeep(genderCode),
      ...ACE_STYLE_MUST_CORE,
      duo ? "singer 1 / singer 2 distinct with correct genders" : "lead vocal clear and prominent",
      bilingualBit || null,
    ].filter(Boolean),
    avoid: [...ACE_STYLE_AVOID],
  };
}

/**
 * Règles textuelles injectées dans le prompt LLM (anglais = langue ACE).
 */
export function aceStyleLlmRulesBlock(brief = {}) {
  const must = (brief.mustKeep || []).join("; ");
  const avoid = (brief.avoid || ACE_STYLE_AVOID).join("; ");
  return `Rules (non-negotiable):
- One coherent commercial song description in English.
- Keep MUST: ${must}.
- Avoid: ${avoid}.
- HARD gender: if lead.gender is female, caption MUST START with "${aceGenderHardPrefix("female")}" and NEVER say male/man singer. If male, START with "${aceGenderHardPrefix("male")}".
- Name guitars/bass/drums/keys early; full band always.
- Dry clear natural vocals, intelligible lyrics (no vocoder, no muffled/distant vocal).
- Dynamics in few words: verse lean → thicker chorus → thin bridge → biggest final chorus.
- If duo: singer 1 / singer 2 roles + genders briefly.
- If bilingual: singer 1 lang + singer 2 lang briefly.
- One production lane only — do NOT invent a second genre mid-track.
- Do NOT truncate mid-word or mid-sentence.`;
}

/** Corrige les mentions de genre opposées dans un caption. */
export function rewriteOppositeGender(text, genderCode) {
  let s = String(text || "");
  if (genderCode === "female") {
    return s
      .replace(/\bmale lead vocal\b/gi, "female lead vocal")
      .replace(/\bclear natural male\b/gi, "clear natural female")
      .replace(/\bmale vocal\b/gi, "female vocal")
      .replace(/\bman singer\b/gi, "woman singer")
      .replace(/\bmale singer\b/gi, "female singer");
  }
  if (genderCode === "male") {
    return s
      .replace(/\bfemale lead vocal\b/gi, "male lead vocal")
      .replace(/\bclear natural female\b/gi, "clear natural male")
      .replace(/\bfemale vocal\b/gi, "male vocal")
      .replace(/\bwoman singer\b/gi, "man singer")
      .replace(/\bfemale singer\b/gi, "male singer");
  }
  return s;
}

/**
 * Nettoie + valide un caption (longueur, pas de troncature évidente).
 * @returns {string|null}
 */
export function sanitizeAceStyleCaption(raw, { max = ACE_STYLE_CAP } = {}) {
  let s = String(raw || "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^Style:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (s.length > max) {
    const cut = s.slice(0, max);
    const lastDot = cut.lastIndexOf(". ");
    s = lastDot > 80 ? cut.slice(0, lastDot + 1).trim() : cut.trim();
  }
  if (s.length < 48 || s.length > max) return null;
  if (/\b(sin|lyr|intelligib|chorus=sin|singer)$/i.test(s)) return null;
  return s;
}

/**
 * Réinjecte genre / clarté / full band si le LLM (ou le cache) les a dilués.
 */
export function enforceAceStyleLocks(caption, brief = {}) {
  let s = String(caption || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!s) return s;

  const g = brief?.lead?.gender;
  const prefix = aceGenderHardPrefix(g);
  s = rewriteOppositeGender(s, g);

  if (prefix) {
    s = s
      .replace(
        /^(female|male) lead vocal(?:,?\s*(?:woman|man) singer)?(?:,?\s*clear articulate (?:female|male) voice)?\.?\s*/i,
        "",
      )
      .trim();
    s = `${prefix}. ${s}`;
  }

  if (!/\b(clear|intelligible|articulate)\b/i.test(s)) {
    s = `${s.replace(/\.\s*$/, "")}. ${ACE_STYLE_FALLBACK_CLARITY}`;
  }
  if (!/\b(full band|guitar|bass|drums)\b/i.test(s)) {
    s = `${s.replace(/\.\s*$/, "")}. ${ACE_STYLE_FALLBACK_BAND}`;
  }

  s = s.replace(/\s+/g, " ").trim();
  if (s.length > ACE_STYLE_CAP) {
    const cut = sanitizeAceStyleCaption(s, { max: ACE_STYLE_CAP });
    s = cut || s.slice(0, ACE_STYLE_CAP).trim();
  }
  return s;
}
