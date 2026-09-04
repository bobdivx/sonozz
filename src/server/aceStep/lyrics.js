import { languagePrompt } from "../../lib/studio.js";

/**
 * Code langue ACE (`vocalLanguage`) + consigne style explicite.
 * Si les paroles sont clairement FR mais le champ dit "en", on force fr.
 */
export function resolveAceVocalLanguage(language, lyricsText = "") {
  const raw = String(language || "")
    .trim()
    .toLowerCase();
  let code = raw.slice(0, 2);
  if (raw === "french" || raw === "français" || raw === "francais") code = "fr";
  if (raw === "english") code = "en";
  if (raw === "spanish" || raw === "español" || raw === "espanol") code = "es";

  const text = String(lyricsText || "");
  const hasAccents = /[àâäéèêëïîôùûüçœ]/i.test(text);
  const frHits = (
    text.match(
      /\b(le|la|les|des|une|un|dans|pour|avec|je|tu|nous|vous|mon|ma|mes|qui|que|est|sont|pas|plus|tout|cette|comme|aussi|temps|entre|hier|demain|cœur|même|être|sablier|sable|nuit|ville|amour|vie)\b/gi,
    ) || []
  ).length;
  const looksFr = (hasAccents && frHits >= 1) || frHits >= 3;
  if (looksFr && (!code || code === "en")) code = "fr";

  if (!/^[a-z]{2}$/.test(code)) code = looksFr ? "fr" : "en";
  return code;
}

export function aceVocalLanguageStyleBit(languageCode) {
  const code = resolveAceVocalLanguage(languageCode);
  const name = languagePrompt(code);
  if (code === "fr") {
    return `sung in French (français)`;
  }
  return `sung in ${name} (${code})`;
}

/** Style ACE pour duo : une langue ou bilingue (singer 1 / singer 2). */
export function aceDuoVocalLanguageStyleBit(leadLang, featLang) {
  const a = resolveAceVocalLanguage(leadLang);
  const b = resolveAceVocalLanguage(featLang);
  if (a === b) return aceVocalLanguageStyleBit(a);
  const aName = languagePrompt(a);
  const bName = languagePrompt(b);
  return `bilingual duet: singer 1 sings in ${aName} (${a}), singer 2 sings in ${bName} (${b}); each singer stays in their own language`;
}

export function lyricsForAceStepPreview(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(0, 16).join("\n");
}

/**
 * ACE chante les didascalies (« (Sound of static…) ») → bruit / intro inaudible.
 * On retire les parenthèses de mise en scène, on garde (ad-libs) courts.
 */
export function stripAceStageDirections(text) {
  return String(text || "")
    .replace(/^\s*\((?:sound of|sfx|fx|music|instrumental|distorted|fade|static)[^)]{0,160}\)\s*$/gim, "")
    .replace(/\((?:sound of|sfx|fx)[^)]{0,160}\)/gi, "")
    .replace(/^\s*\([^)]{20,160}\)\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
