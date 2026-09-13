/**
 * Règles ACE-Step style caption — source unique.
 * Éditer ICI pour changer le comportement qualité.
 *
 * Principe : caption COURT, sans doublons. Les pavés → mur de bruit ACE.
 * Rap : « rapped » / hip-hop flow — jamais « sung lyrics » (ACE part en chant pop).
 */

import { isRapLane } from "../../lib/musicLane.js";

/** Plafond hard ACE (troncature côté moteur au-delà). */
export const ACE_STYLE_CAP = 700;

/** Bump si les règles changent (invalide le cache mémoire). */
export const ACE_STYLE_RULES_VERSION = 8;

/** Cible caption — au-delà ACE sature (noise wall). */
export const ACE_STYLE_TARGET = 360;

/** Solo déjà sous la cible → pas de compress LLM. */
export const ACE_STYLE_LLM_SKIP_MAX = 320;

export const ACE_STYLE_AVOID = [
  "vocoder",
  "autotune",
  "artificial vocal",
  "muffled vocal",
  "synthetic guitar",
  "muddy mix",
  "drums-only",
  "multi-genre mash",
  "repeated gender phrases",
];

/** MustKeep LLM — très court (chant). */
export const ACE_STYLE_MUST_CORE = [
  "full band once",
  "clear sung lyrics",
  "airy mix",
  "instrument layers change by section (never same loop)",
];

/** MustKeep LLM — lane rap / hip-hop. */
export const ACE_STYLE_MUST_CORE_RAP = [
  "full band once (808/trap bed)",
  "clear rapped lyrics, hip-hop flow, not melodic singing",
  "airy mix",
  "instrument layers change by section (never same loop)",
];

export const ACE_STYLE_FALLBACK_CLARITY = "clear sung lyrics";
export const ACE_STYLE_FALLBACK_CLARITY_RAP =
  "clear rapped lyrics, hip-hop flow, not melodic singing";
export const ACE_STYLE_FALLBACK_BAND = "full band: guitar, bass, drums, keys";
export const ACE_STYLE_FALLBACK_BAND_RAP =
  "full band: 808 bass, trap drums, hi-hats, synth pads, piano";
export const ACE_STYLE_FALLBACK_MIX = "airy mix";
export const ACE_STYLE_FALLBACK_DYNAMICS =
  "instrument layers change: verse sparse → chorus adds guitar/keys/pads → densest final";
export const ACE_STYLE_FALLBACK_DYNAMICS_RAP =
  "instrument layers change: verse sparse 808+hats → chorus adds pads/melody/chopped vocal → densest final — never same loop";

export function briefIsRap(brief = {}) {
  if (brief?.rap === true) return true;
  if (brief?.rap === false) return false;
  return isRapLane(
    [brief?.lead?.genre, brief?.genre, brief?.skeleton, ...(Array.isArray(brief?.instruments) ? brief.instruments : [])]
      .filter(Boolean)
      .join(" "),
  );
}

export function aceGenderHardPrefix(genderCode, { rap = false } = {}) {
  if (rap) {
    if (genderCode === "female") return "female lead rap vocal, woman rapper, clear diction";
    if (genderCode === "male") return "male lead rap vocal, man rapper, clear diction";
    return "lead rap vocal, clear diction, hip-hop flow";
  }
  if (genderCode === "female") return "female lead vocal, woman singer, clear diction";
  if (genderCode === "male") return "male lead vocal, man singer, clear diction";
  return null;
}

export function aceGenderMustKeep(genderCode, { rap = false } = {}) {
  if (rap) {
    if (genderCode === "female") return "female rap lead once at start (never male, never melodic pop singing)";
    if (genderCode === "male") return "male rap lead once at start (never female, never melodic pop singing)";
    return "rap lead once at start (not melodic singing)";
  }
  if (genderCode === "female") return "female lead once at start (never male)";
  if (genderCode === "male") return "male lead once at start (never female)";
  return null;
}

export function buildAceStyleBriefLocks({
  genderCode = null,
  duo = false,
  bilingualBit = null,
  trackArc = null,
  rap = false,
} = {}) {
  const mustCore = rap ? ACE_STYLE_MUST_CORE_RAP : ACE_STYLE_MUST_CORE;
  return {
    mustKeep: [
      aceGenderMustKeep(genderCode, { rap }),
      ...mustCore,
      duo ? "singer 1 / singer 2 distinct" : null,
      bilingualBit || null,
      trackArc ? "keep this track's instrumentArc verbatim once" : null,
    ].filter(Boolean),
    avoid: [
      ...ACE_STYLE_AVOID,
      ...(rap ? ["melodic pop singing", "belting chorus", "sung ballad"] : []),
    ],
    trackArc: trackArc || null,
    rap: Boolean(rap),
  };
}

export function aceStyleLlmRulesBlock(brief = {}) {
  const rap = briefIsRap(brief);
  const must = (brief.mustKeep || []).join("; ");
  const avoid = (brief.avoid || ACE_STYLE_AVOID).join("; ");
  const trackArc = String(brief?.trackArc || "").trim();
  const delivery = rap
    ? "genre first as hip-hop/rap, rapped vocals with rhythmic flow (NOT melodic singing), full trap/808 band"
    : "genre, full band, clear lyrics, airy mix";
  return `Rules:
- Output ONE short English style caption (~${ACE_STYLE_TARGET} chars max, prefer ~300).
- Keep MUST: ${must}.
- Avoid: ${avoid}.
- Start with gender ONCE: "${aceGenderHardPrefix(brief?.lead?.gender, { rap }) || "lead vocal"}" — never repeat it.
- Then: ${delivery}, instrument-layer section arc — each ONCE.
- Name which layers enter/exit (verse sparse → chorus denser) — "thicker" alone is not enough.
${trackArc ? `- Include this track instrument plan once: "${trackArc.slice(0, 200)}"` : ""}
- No essays, no duplicate sentences, no second genre.`;
}

export function rewriteOppositeGender(text, genderCode) {
  let s = String(text || "");
  if (genderCode === "female") {
    return s
      .replace(/\bmale lead rap vocal\b/gi, "female lead rap vocal")
      .replace(/\bmale lead vocal\b/gi, "female lead vocal")
      .replace(/\bclear natural male\b/gi, "clear natural female")
      .replace(/\bmale vocal\b/gi, "female vocal")
      .replace(/\bman rapper\b/gi, "woman rapper")
      .replace(/\bmale rapper\b/gi, "female rapper")
      .replace(/\bman singer\b/gi, "woman singer")
      .replace(/\bmale singer\b/gi, "female singer");
  }
  if (genderCode === "male") {
    return s
      .replace(/\bfemale lead rap vocal\b/gi, "male lead rap vocal")
      .replace(/\bfemale lead vocal\b/gi, "male lead vocal")
      .replace(/\bclear natural female\b/gi, "clear natural male")
      .replace(/\bfemale vocal\b/gi, "male vocal")
      .replace(/\bwoman rapper\b/gi, "man rapper")
      .replace(/\bfemale rapper\b/gi, "male rapper")
      .replace(/\bwoman singer\b/gi, "man singer")
      .replace(/\bfemale singer\b/gi, "male singer");
  }
  return s;
}

/** Retire toutes les phrases genre (partout) pour en remettre une seule en tête. */
export function stripGenderPhrases(text) {
  return String(text || "")
    .replace(
      /\b(female|male) lead (?:rap )?vocal(?:,?\s*(?:woman|man) (?:singer|rapper))?(?:,?\s*clear(?:\s+articulate)?(?:\s+(?:female|male))?\s+(?:voice|diction))?\b\.?\s*/gi,
      "",
    )
    .replace(/\b(woman|man) (?:singer|rapper),?\s*clear diction\b\.?\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dé-duplique les clauses séparées par des points. */
export function dedupeStyleClauses(text) {
  const parts = String(text || "")
    .split(/\.\s+/)
    .map((p) => p.trim().replace(/\.+$/, ""))
    .filter(Boolean);
  const seen = [];
  const out = [];
  for (const p of parts) {
    const key = p
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (!key || key.length < 8) {
      out.push(p);
      continue;
    }
    const dup = seen.some(
      (k) => k === key || (key.length > 20 && (k.includes(key) || key.includes(k))),
    );
    if (dup) continue;
    seen.push(key);
    out.push(p);
  }
  return out.length ? `${out.join(". ")}.` : "";
}

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
  if (s.length < 40 || s.length > max) return null;
  if (/\b(sin|lyr|intelligib|chorus=sin|singer)$/i.test(s)) return null;
  return s;
}

/**
 * Genre en tête une seule fois + dé-dupe + plafond cible.
 */
export function enforceAceStyleLocks(caption, brief = {}) {
  let s = String(caption || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!s) return s;

  const rap = briefIsRap(brief);
  const g = brief?.lead?.gender;
  const prefix = aceGenderHardPrefix(g, { rap });
  s = rewriteOppositeGender(s, g);
  s = stripGenderPhrases(s);

  if (prefix) {
    s = `${prefix}. ${s}`.replace(/\s+/g, " ").trim();
  }

  // Rap : retirer « sung lyrics » injecté par LLM / squelette pop.
  if (rap) {
    s = s
      .replace(/\bclear sung lyrics(?: every word intelligible)?\b/gi, "clear rapped lyrics, hip-hop flow")
      .replace(/\bsung lyrics\b/gi, "rapped lyrics")
      .replace(/\bmelodic (?:pop )?singing\b/gi, "rapped flow");
  }

  s = dedupeStyleClauses(s);

  const clarityOk = rap
    ? /\b(rapped|rap vocal|hip-?hop flow|intelligible|diction)\b/i.test(s)
    : /\b(clear|intelligible|diction)\b/i.test(s);
  if (!clarityOk) {
    s = `${s.replace(/\.\s*$/, "")}. ${rap ? ACE_STYLE_FALLBACK_CLARITY_RAP : ACE_STYLE_FALLBACK_CLARITY}.`;
  }
  if (!/\b(full band|guitar|bass|drums|808|trap drums)\b/i.test(s)) {
    s = `${s.replace(/\.\s*$/, "")}. ${rap ? ACE_STYLE_FALLBACK_BAND_RAP : ACE_STYLE_FALLBACK_BAND}.`;
  }
  if (!/\b(airy|open mix)\b/i.test(s)) {
    s = `${s.replace(/\.\s*$/, "")}. ${ACE_STYLE_FALLBACK_MIX}.`;
  }
  if (
    !/\b(instrument layers|layers change|verse sparse|never (?:one )?flat|never same loop|section dynamics)\b/i.test(
      s,
    )
  ) {
    s = `${s.replace(/\.\s*$/, "")}. ${rap ? ACE_STYLE_FALLBACK_DYNAMICS_RAP : ACE_STYLE_FALLBACK_DYNAMICS}.`;
  }

  s = dedupeStyleClauses(s.replace(/\s+/g, " ").trim());

  const max = ACE_STYLE_TARGET;
  if (s.length > max) {
    const cut = sanitizeAceStyleCaption(s, { max });
    s = cut || s.slice(0, max).trim();
  }
  return s;
}
