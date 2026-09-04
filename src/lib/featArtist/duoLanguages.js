import { MUSIC_LANGUAGES, languagePrompt } from "../studio/languages.js";

const ALLOWED = new Set(MUSIC_LANGUAGES.map((l) => l.code));

function normLang(code, fallback = "fr") {
  const raw = String(code || "")
    .toLowerCase()
    .trim()
    .slice(0, 2);
  if (ALLOWED.has(raw)) return raw;
  return ALLOWED.has(fallback) ? fallback : "fr";
}

/**
 * Langues lead / feat pour un duo.
 * Sans langue feat configurée → même langue que le lead (pas de bilingue forcé).
 */
export function resolveDuoLanguages(lead, feat, overrideLang) {
  const leadLang = normLang(overrideLang || lead?.language, "fr");
  const featHasLang = Boolean(String(feat?.language || "").trim());
  const featLang = featHasLang ? normLang(feat.language, leadLang) : leadLang;
  return {
    leadLang,
    featLang,
    bilingual: Boolean(feat?.name) && leadLang !== featLang,
  };
}

export function duoLanguagePromptName(code) {
  return languagePrompt(normLang(code));
}

/** Consigne LLM : une langue ou bilingue par chanteur. */
export function duoLanguageRules(lead, feat, overrideLang) {
  const { leadLang, featLang, bilingual } = resolveDuoLanguages(lead, feat, overrideLang);
  const leadName = duoLanguagePromptName(leadLang);
  const featName = duoLanguagePromptName(featLang);
  if (!bilingual) {
    return {
      leadLang,
      featLang,
      bilingual: false,
      block: `Langue obligatoire des paroles: ${leadName} (code ${leadLang}) — aucune autre langue dans le chant.`,
      jsonLanguage: leadLang,
    };
  }
  const a = String(lead?.name || "Lead").trim() || "Lead";
  const b = String(feat?.name || "Feat").trim() || "Feat";
  return {
    leadLang,
    featLang,
    bilingual: true,
    block: `DUO BILINGUE obligatoire (chaque artiste chante dans SA langue) :
- Lead « ${a} » (singer 1) : paroles UNIQUEMENT en ${leadName} (code ${leadLang})
- Feat « ${b} » (singer 2) : paroles UNIQUEMENT en ${featName} (code ${featLang})
- Couplets / sections solo lead → ${leadName} ; solo feat → ${featName}
- Sur Chorus/Hook à deux voix : chaque chanteur reste dans SA langue (pas de mélange de langues sur une même ligne)
- Aucune 3e langue.
Champ JSON "language": "${leadLang}" (langue principale / métadonnées = lead).`,
    jsonLanguage: leadLang,
  };
}
