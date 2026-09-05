import { createHash } from "node:crypto";
import { llmText, requireTextLlm, isOllamaProvider } from "../llm.js";
import { resolveOllamaModel } from "../ollama.js";
import { assembleAceStepStyle, ACE_STYLE_CAP } from "./body.js";

/** Cible LLM (marge sous le plafond ACE). */
export const ACE_STYLE_TARGET = 650;

const cache = new Map();
const CACHE_MAX = 80;

function canUseTextLlm(keys) {
  if (!keys || typeof keys !== "object") return false;
  if (isOllamaProvider(keys)) return Boolean(resolveOllamaModel(keys));
  return Boolean(String(keys?.geminiApiKey || "").trim());
}

function cacheKey(brief) {
  const payload = JSON.stringify({
    duo: brief?.duo,
    bilingual: brief?.bilingual,
    lead: brief?.lead,
    feat: brief?.feat,
    instruments: brief?.instruments,
    skeleton: brief?.skeleton,
    maxChars: brief?.maxChars,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

function remember(key, value) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  cache.set(key, value);
}

/**
 * Nettoie + valide un caption LLM (longueur, pas de troncature évidente).
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
  // Coupe au dernier point avant max si trop long
  if (s.length > max) {
    const cut = s.slice(0, max);
    const lastDot = cut.lastIndexOf(". ");
    s = lastDot > 80 ? cut.slice(0, lastDot + 1).trim() : cut.trim();
  }
  if (s.length < 48 || s.length > max) return null;
  // Refuse les fins de mots tronqués typiques
  if (/\b(sin|lyr|intelligib|chorus=sin|singer)$/i.test(s)) return null;
  return s;
}

function buildCompressPrompt(brief, { shorten = false } = {}) {
  const max = Number(brief?.maxChars) || ACE_STYLE_TARGET;
  const skeleton = String(brief?.skeleton || "").trim();
  return `You write ACE-Step music STYLE captions (English).
${shorten ? `SHORTEN hard. ` : ""}Output ONLY the caption text. No quotes, no markdown, no explanation.
Hard limit: ${max} characters (count carefully). Prefer ~${Math.min(max, 580)} chars.
Rules:
- One coherent commercial song description.
- Keep MUST: ${(brief?.mustKeep || []).join("; ")}.
- Avoid: ${(brief?.avoid || []).join("; ")}.
- Full band always (never drums-only / single-instrument loop).
- Dry clear natural vocals (no vocoder essay).
- Clear section dynamics in few words.
- If duo: name singer 1 / singer 2 roles briefly.
- If bilingual: state singer 1 lang + singer 2 lang briefly.
- Do NOT invent a second genre mid-track; one production lane.
- Do NOT truncate mid-word or mid-sentence.

Facts JSON:
${JSON.stringify(
  {
    duo: brief?.duo,
    bilingual: brief?.bilingual,
    lead: brief?.lead,
    feat: brief?.feat,
    instruments: brief?.instruments,
    leadLang: brief?.leadLang,
    featLang: brief?.featLang,
  },
  null,
  0,
)}

Skeleton draft to improve/compress:
${skeleton}`;
}

/**
 * Résout le caption ACE : LLM compress (si dispo) → validateur → squelette.
 * @returns {Promise<{ style: string, source: 'llm'|'cache'|'skeleton', brief: object }>}
 */
export async function resolveAceStepStyleCaption(
  keys,
  {
    style,
    language,
    styleLock,
    artist,
    featArtist,
    lyrics,
    preview = false,
    labMode = false,
    forceLlm = false,
  } = {},
) {
  const assembled = assembleAceStepStyle({
    style,
    language,
    styleLock,
    artist,
    featArtist,
    lyrics,
  });
  const brief = assembled.brief;
  const skeleton = assembled.style;
  const key = cacheKey(brief);

  if (cache.has(key)) {
    return { style: cache.get(key), source: "cache", brief, langCode: assembled.langCode };
  }

  const skipLlm =
    labMode ||
    (preview && !forceLlm) ||
    !canUseTextLlm(keys);

  if (skipLlm) {
    return { style: skeleton, source: "skeleton", brief, langCode: assembled.langCode };
  }

  // Solo simple déjà court → pas besoin LLM
  if (!forceLlm && !assembled.duo && !assembled.bilingual && skeleton.length <= 520) {
    remember(key, skeleton);
    return { style: skeleton, source: "skeleton", brief, langCode: assembled.langCode };
  }

  try {
    requireTextLlm(keys);
    let raw = await llmText(keys, buildCompressPrompt(brief));
    let ok = sanitizeAceStyleCaption(raw, { max: ACE_STYLE_CAP });
    if (!ok || ok.length > ACE_STYLE_TARGET + 20) {
      raw = await llmText(keys, buildCompressPrompt({ ...brief, maxChars: 580 }, { shorten: true }));
      ok = sanitizeAceStyleCaption(raw, { max: ACE_STYLE_TARGET });
    }
    if (ok) {
      remember(key, ok);
      console.info("[acestep] style caption LLM", ok.length, "chars");
      return { style: ok, source: "llm", brief, langCode: assembled.langCode };
    }
    console.warn("[acestep] style LLM invalid/too long — skeleton fallback");
  } catch (e) {
    console.warn("[acestep] style LLM fallback:", e?.message || e);
  }

  remember(key, skeleton);
  return { style: skeleton, source: "skeleton", brief, langCode: assembled.langCode };
}

/** Test helper — vide le cache. */
export function clearAceStyleCaptionCache() {
  cache.clear();
}
