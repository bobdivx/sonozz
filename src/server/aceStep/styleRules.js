/**
 * Règles ACE-Step style caption — source unique.
 * Éditer ICI pour changer le comportement qualité.
 *
 * Principe : caption COURT, sans doublons. Les pavés → mur de bruit ACE.
 */

/** Plafond hard ACE (troncature côté moteur au-delà). */
export const ACE_STYLE_CAP = 700;

/** Bump si les règles changent (invalide le cache mémoire). */
export const ACE_STYLE_RULES_VERSION = 7;

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

/** MustKeep LLM — très court. */
export const ACE_STYLE_MUST_CORE = [
  "full band once",
  "clear sung lyrics",
  "airy mix",
  "instrument layers change by section (never same loop)",
];

export const ACE_STYLE_FALLBACK_CLARITY = "clear sung lyrics";
export const ACE_STYLE_FALLBACK_BAND = "full band: guitar, bass, drums, keys";
export const ACE_STYLE_FALLBACK_MIX = "airy mix";
export const ACE_STYLE_FALLBACK_DYNAMICS =
  "instrument layers change: verse sparse → chorus adds guitar/keys/pads → densest final";

export function aceGenderHardPrefix(genderCode) {
  if (genderCode === "female") return "female lead vocal, woman singer, clear diction";
  if (genderCode === "male") return "male lead vocal, man singer, clear diction";
  return null;
}

export function aceGenderMustKeep(genderCode) {
  if (genderCode === "female") return "female lead once at start (never male)";
  if (genderCode === "male") return "male lead once at start (never female)";
  return null;
}

export function buildAceStyleBriefLocks({
  genderCode = null,
  duo = false,
  bilingualBit = null,
  trackArc = null,
} = {}) {
  return {
    mustKeep: [
      aceGenderMustKeep(genderCode),
      ...ACE_STYLE_MUST_CORE,
      duo ? "singer 1 / singer 2 distinct" : null,
      bilingualBit || null,
      trackArc ? "keep this track's instrumentArc verbatim once" : null,
    ].filter(Boolean),
    avoid: [...ACE_STYLE_AVOID],
    trackArc: trackArc || null,
  };
}

export function aceStyleLlmRulesBlock(brief = {}) {
  const must = (brief.mustKeep || []).join("; ");
  const avoid = (brief.avoid || ACE_STYLE_AVOID).join("; ");
  const trackArc = String(brief?.trackArc || "").trim();
  return `Rules:
- Output ONE short English style caption (~${ACE_STYLE_TARGET} chars max, prefer ~300).
- Keep MUST: ${must}.
- Avoid: ${avoid}.
- Start with gender ONCE: "${aceGenderHardPrefix(brief?.lead?.gender) || "lead vocal"}" — never repeat it.
- Then: genre, full band, clear lyrics, airy mix, instrument-layer section arc — each ONCE.
- Name which layers enter/exit (verse sparse → chorus adds guitar/keys/pads) — "thicker" alone is not enough.
${trackArc ? `- Include this track instrument plan once: "${trackArc.slice(0, 200)}"` : ""}
- No essays, no duplicate sentences, no second genre.`;
}

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

/** Retire toutes les phrases genre (partout) pour en remettre une seule en tête. */
export function stripGenderPhrases(text) {
  return String(text || "")
    .replace(
      /\b(female|male) lead vocal(?:,?\s*(?:woman|man) singer)?(?:,?\s*clear(?:\s+articulate)?(?:\s+(?:female|male))?\s+(?:voice|diction))?\b\.?\s*/gi,
      "",
    )
    .replace(/\b(woman|man) singer,?\s*clear diction\b\.?\s*/gi, "")
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

  const g = brief?.lead?.gender;
  const prefix = aceGenderHardPrefix(g);
  s = rewriteOppositeGender(s, g);
  s = stripGenderPhrases(s);

  if (prefix) {
    s = `${prefix}. ${s}`.replace(/\s+/g, " ").trim();
  }

  s = dedupeStyleClauses(s);

  if (!/\b(clear|intelligible|diction)\b/i.test(s)) {
    s = `${s.replace(/\.\s*$/, "")}. ${ACE_STYLE_FALLBACK_CLARITY}.`;
  }
  if (!/\b(full band|guitar|bass|drums)\b/i.test(s)) {
    s = `${s.replace(/\.\s*$/, "")}. ${ACE_STYLE_FALLBACK_BAND}.`;
  }
  if (!/\b(airy|open mix)\b/i.test(s)) {
    s = `${s.replace(/\.\s*$/, "")}. ${ACE_STYLE_FALLBACK_MIX}.`;
  }
  if (
    !/\b(instrument layers|layers change|verse sparse|never (?:one )?flat|never same loop|section dynamics)\b/i.test(
      s,
    )
  ) {
    s = `${s.replace(/\.\s*$/, "")}. ${ACE_STYLE_FALLBACK_DYNAMICS}.`;
  }

  s = dedupeStyleClauses(s.replace(/\s+/g, " ").trim());

  const max = ACE_STYLE_TARGET;
  if (s.length > max) {
    const cut = sanitizeAceStyleCaption(s, { max });
    s = cut || s.slice(0, max).trim();
  }
  return s;
}
