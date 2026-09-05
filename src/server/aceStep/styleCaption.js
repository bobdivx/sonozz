import { createHash } from "node:crypto";
import { llmText, requireTextLlm, isOllamaProvider } from "../llm.js";
import { resolveOllamaModel } from "../ollama.js";
import { assembleAceStepStyle } from "./body.js";
import {
  ACE_STYLE_CAP,
  ACE_STYLE_TARGET,
  ACE_STYLE_LLM_SKIP_MAX,
  ACE_STYLE_RULES_VERSION,
  sanitizeAceStyleCaption,
  enforceAceStyleLocks,
  aceStyleLlmRulesBlock,
} from "./styleRules.js";

export {
  ACE_STYLE_TARGET,
  ACE_STYLE_CAP,
  ACE_STYLE_RULES_VERSION,
  sanitizeAceStyleCaption,
  enforceAceStyleLocks,
} from "./styleRules.js";

const cache = new Map();
const CACHE_MAX = 80;

function canUseTextLlm(keys) {
  if (!keys || typeof keys !== "object") return false;
  if (isOllamaProvider(keys)) return Boolean(resolveOllamaModel(keys));
  return Boolean(String(keys?.geminiApiKey || "").trim());
}

function cacheKey(brief) {
  const payload = JSON.stringify({
    v: ACE_STYLE_RULES_VERSION,
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

function buildCompressPrompt(brief, { shorten = false } = {}) {
  const max = Number(brief?.maxChars) || ACE_STYLE_TARGET;
  const skeleton = String(brief?.skeleton || "").trim();
  return `You write ACE-Step music STYLE captions (English).
${shorten ? `SHORTEN hard. ` : ""}Output ONLY the caption text. No quotes, no markdown, no explanation.
Hard limit: ${max} characters (count carefully). Prefer ~${Math.min(max, 580)} chars.
${aceStyleLlmRulesBlock(brief)}

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
 * Résout le caption ACE : LLM compress (si dispo) → règles → squelette.
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
    const cached = enforceAceStyleLocks(cache.get(key), brief);
    return { style: cached, source: "cache", brief, langCode: assembled.langCode };
  }

  const skipLlm =
    labMode ||
    (preview && !forceLlm) ||
    !canUseTextLlm(keys);

  if (skipLlm) {
    return {
      style: enforceAceStyleLocks(skeleton, brief),
      source: "skeleton",
      brief,
      langCode: assembled.langCode,
    };
  }

  if (!forceLlm && !assembled.duo && !assembled.bilingual && skeleton.length <= ACE_STYLE_LLM_SKIP_MAX) {
    const locked = enforceAceStyleLocks(skeleton, brief);
    remember(key, locked);
    return { style: locked, source: "skeleton", brief, langCode: assembled.langCode };
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
      const locked = enforceAceStyleLocks(ok, brief);
      remember(key, locked);
      console.info("[acestep] style caption LLM", locked.length, "chars");
      return { style: locked, source: "llm", brief, langCode: assembled.langCode };
    }
    console.warn("[acestep] style LLM invalid/too long — skeleton fallback");
  } catch (e) {
    console.warn("[acestep] style LLM fallback:", e?.message || e);
  }

  const locked = enforceAceStyleLocks(skeleton, brief);
  remember(key, locked);
  return { style: locked, source: "skeleton", brief, langCode: assembled.langCode };
}

/** Test helper — vide le cache. */
export function clearAceStyleCaptionCache() {
  cache.clear();
}
