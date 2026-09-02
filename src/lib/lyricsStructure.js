/**
 * Parse / normalise / valide les tags de structure paroles (MiniMax / ACE).
 */

import { getLyricsFormPreset } from "./musicLane.js";

const TAG_LINE_RE = /^\[([^\]]+)\]\s*$/;

/** Synonymes FR / variantes → tag canonique EN (base sans suffixe vocal). */
const CANONICAL_BASE = {
  couplet: "Verse",
  verse: "Verse",
  refrain: "Chorus",
  chorus: "Chorus",
  hook: "Hook",
  "pré-refrain": "Pre-Chorus",
  "pre-refrain": "Pre-Chorus",
  "pré refrain": "Pre-Chorus",
  "pre refrain": "Pre-Chorus",
  prechorus: "Pre-Chorus",
  "pre-chorus": "Pre-Chorus",
  "pre chorus": "Pre-Chorus",
  pont: "Bridge",
  bridge: "Bridge",
  intro: "Intro",
  outro: "Outro",
  build: "Build",
  drop: "Drop",
  break: "Break",
  breakdown: "Breakdown",
  instrumental: "Instrumental",
  inst: "Instrumental",
};

function normKey(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrait la base structurelle d’un tag brut (« Verse - female vocal » → Verse).
 */
export function canonicalStructureTag(rawTag = "") {
  const full = String(rawTag || "").trim();
  if (!full) return "";
  const basePart = full.split(/\s[-–—]\s/)[0].trim();
  const key = normKey(basePart);
  if (CANONICAL_BASE[key]) return CANONICAL_BASE[key];
  // Title-Case fallback: "pre chorus" already handled; keep first word capitalized
  const words = basePart.split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(words.length > 1 && /-/i.test(basePart) ? "-" : " ");
}

/** Remplace les tags FR courants dans le texte par des tags EN. */
export function normalizeLyricsTextTags(text = "") {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\[Couplet(?:\s*\d+)?\]/gi, "[Verse]")
    .replace(/\[Refrain\]/gi, "[Chorus]")
    .replace(/\[Pré[- ]?refrain\]/gi, "[Pre-Chorus]")
    .replace(/\[Pre[- ]?Chorus\]/gi, "[Pre-Chorus]")
    .replace(/\[Pre Chorus\]/gi, "[Pre-Chorus]")
    .replace(/\[Pont\]/gi, "[Bridge]")
    .replace(/\[Intro\]/gi, "[Intro]")
    .replace(/\[Outro\]/gi, "[Outro]");
}

/**
 * @returns {{ tag: string, canonical: string, body: string }[]}
 */
export function parseLyricsSections(text = "") {
  const normalized = normalizeLyricsTextTags(text);
  const lines = normalized.split("\n");
  const sections = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    current.body = current.bodyLines.join("\n").trim();
    delete current.bodyLines;
    sections.push(current);
    current = null;
  };

  for (const line of lines) {
    const m = line.trim().match(TAG_LINE_RE);
    if (m) {
      flush();
      const tag = m[1].trim();
      current = { tag, canonical: canonicalStructureTag(tag), bodyLines: [] };
      continue;
    }
    if (current) current.bodyLines.push(line);
  }
  flush();
  return sections;
}

export function deriveStructureFromText(text = "") {
  return parseLyricsSections(text).map((s) => s.canonical || s.tag);
}

function bodyFingerprint(body = "") {
  return String(body || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Valide le texte contre un preset de forme.
 * @returns {{ ok: boolean, errors: string[], structure: string[], text: string, sections: object[] }}
 */
export function validateLyricsAgainstForm(text = "", form = null) {
  const preset = getLyricsFormPreset(form);
  const textNorm = normalizeLyricsTextTags(text);
  const sections = parseLyricsSections(textNorm);
  const structure = sections.map((s) => s.canonical || s.tag);
  const present = new Set(structure.map((t) => normKey(t)));
  const errors = [];

  for (const req of preset.requiredTags || []) {
    if (!present.has(normKey(req))) {
      errors.push(`manque [${req}]`);
    }
  }

  if (preset.requireDistinctVerses) {
    const narrativeTag = structure.includes("Verse")
      ? "Verse"
      : structure.includes("Build")
        ? "Build"
        : null;
    if (narrativeTag) {
      const bodies = sections
        .filter((s) => normKey(s.canonical) === normKey(narrativeTag))
        .map((s) => bodyFingerprint(s.body))
        .filter(Boolean);
      if (bodies.length >= 2) {
        const uniq = new Set(bodies);
        if (uniq.size < Math.min(2, bodies.length)) {
          errors.push(`les [${narrativeTag}] sont identiques (copier-coller)`);
        }
      } else if ((preset.requiredTags || []).includes("Verse") && bodies.length < 2) {
        // arc attend au moins 2 verses quand Verse est requis et tagsArc en a 2
        const expectedVerses = (preset.tagsArc.match(/\[Verse\]/gi) || []).length;
        if (expectedVerses >= 2 && bodies.length < 2) {
          errors.push("il faut au moins 2 [Verse] distincts");
        }
      }
    }
  }

  if (!sections.length) {
    errors.push("aucun tag de structure [Tag] trouvé dans text");
  }

  return {
    ok: errors.length === 0,
    errors,
    structure,
    text: textNorm,
    sections,
  };
}

/**
 * Fusionne la réponse LLM avec structure dérivée du texte + validation.
 */
export function normalizeAndValidateLyrics(data = {}, form = null) {
  const preset = getLyricsFormPreset(form);
  const rawText = data?.text ?? "";
  const validated = validateLyricsAgainstForm(rawText, preset);
  return {
    ...data,
    text: validated.text,
    structure: validated.structure.length ? validated.structure : data?.structure || [],
    lyricsForm: preset.id,
    _validation: { ok: validated.ok, errors: validated.errors },
  };
}
