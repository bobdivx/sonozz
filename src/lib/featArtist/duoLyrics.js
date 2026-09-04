import { ACE_COMMERCIAL_LYRICS_STRUCTURE, getLyricsFormPreset } from "../musicLane.js";
import { vocalLockForArtist, isGospelFeatLock } from "./vocalLock.js";
import { resolveDuoLanguages, duoLanguagePromptName } from "./duoLanguages.js";

function genderVocalCue(code) {
  if (code === "female") return "female vocal";
  if (code === "nonbinary") return "androgynous vocal";
  return "male vocal";
}

/** Bloc LLM pour génération de paroles en duo. */
export function duoLyricsInstruction(lead, feat, form = null, overrideLang = null) {
  const a = vocalLockForArtist(lead);
  const b = vocalLockForArtist(feat);
  if (!a || !b) return "";

  const preset = getLyricsFormPreset(form);
  const arc = preset?.tagsArc || ACE_COMMERCIAL_LYRICS_STRUCTURE;
  const hookTag = preset?.hookTag || "Chorus";
  const hasVerse = /\[Verse\]/i.test(arc);
  const leadCue = genderVocalCue(a.genderCode);
  const featCue = genderVocalCue(b.genderCode);
  const sameGender = a.genderCode && b.genderCode && a.genderCode === b.genderCode;
  const featGospel = isGospelFeatLock(b);
  const { leadLang, featLang, bilingual } = resolveDuoLanguages(lead, feat, overrideLang);
  const leadLangName = duoLanguagePromptName(leadLang);
  const featLangName = duoLanguagePromptName(featLang);
  const verseLeadTag = sameGender
    ? `[Verse]\n[singer 1: ${a.genderCode}]`
    : `[Verse - ${leadCue}]`;
  const verseFeatTag = sameGender
    ? `[Verse]\n[singer 2: ${b.genderCode}]`
    : `[Verse - ${featCue}]`;

  const langBit = bilingual
    ? `- BILINGUE: couplets singer 1 en ${leadLangName} (${leadLang}) ; couplets singer 2 en ${featLangName} (${featLang}) — jamais l’inverse.`
    : `- Les deux chanteurs écrivent en ${leadLangName} (${leadLang}).`;

  const verseRules = hasVerse
    ? `- Alterne les couplets avec des tags ACE-Step (PAS de ligne "(${a.name})" qui serait chantée) :
  ${verseLeadTag}
  ${verseFeatTag}
- En duo même sexe, n’utilise JAMAIS deux fois « [Verse - ${leadCue}] » : ACE fusionne les voix.
- Les 2 couplets ([Verse]) doivent différer (pas le même texte copié)
${langBit}`
    : `- Alterne les sections narratives entre lead et feat via tags ACE-Step (PAS de ligne "(${a.name})" chantée) :
  [Build]\n[singer 1: ${a.genderCode || "vocal"}]
  [singer 2: ${b.genderCode || "vocal"}]
${langBit}`;

  const hookRules = featGospel
    ? `- Le [${hookTag}] est chanté UNIQUEMENT par le feat gospel « ${b.name} » (énergie Sister Act / chœur d’église) :
  [${hookTag}]
  [singer 2: ${b.genderCode || "vocal"}]
  (refrain JOYEUX GOSPEL — témoignage, hallelujah / lift d’église, PAS un 2e couplet rap)${
      bilingual ? `\n- Refrain feat en ${featLangName} uniquement.` : ""
    }
- Bridge / Outro : singer 2 en mode gospel lead + chœur qui répond.
- Couplets = rap (singer 1). Sur le refrain on doit ENTENDRE le gospel (orgue, clap, chœur), pas seulement une 2e voix hip-hop.`
    : `- Au moins un [${hookTag}] suivi de [singer 1: ${a.genderCode || "vocal"}] et [singer 2: ${b.genderCode || "vocal"}] (les deux chantent le hook).${
        bilingual
          ? `\n- Sur le hook bilingue : singer 1 en ${leadLangName}, singer 2 en ${featLangName} (lignes séparées, pas de mélange sur une ligne).`
          : ""
      }`;

  return `
DUO OBLIGATOIRE — deux chanteurs distincts (ne fusionne JAMAIS en un seul narrateur) :
- Lead « ${a.name} » (${a.genderLabel || "voix lead"}${a.genre ? `, style ${a.genre}` : ""}${a.writingStyle ? `, écriture: ${a.writingStyle}` : ""}${a.vocalStyle ? `, voix: ${a.vocalStyle}` : ""}${bilingual ? `, langue: ${leadLangName}` : ""})
- Feat « ${b.name} » (${b.genderLabel || "voix feat"}${b.genre ? `, style ${b.genre}` : ""}${b.writingStyle ? `, écriture: ${b.writingStyle}` : ""}${b.vocalStyle ? `, voix: ${b.vocalStyle}` : ""}${bilingual ? `, langue: ${featLangName}` : ""})
Règles structure dans "text" (titre COMMERCIAL, forme « ${preset.id} », pas linéaire) :
- Arc obligatoire: ${arc}
- Inclure Intro (ambiance), section contraste si présente dans l'arc (Bridge / Breakdown / Break), Outro
${verseRules}
${hookRules}
- Chaque artiste garde SA personnalité d'écriture et son registre — pas de pastiche croisé.
- N'écris PAS les noms d'artistes comme paroles à chanter (sauf si c'est un hook volontaire très court).
- N'écris PAS de didascalies entre parenthèses (pas de « (Sound of…) » — ACE les chante / les mélange).
`.trim();
}
