import {
  buildLyricsCraftBrief,
  detectLyricsForm,
} from "../../lib/musicLane.js";
import { normalizeAndValidateLyrics } from "../../lib/lyricsStructure.js";
import {
  normalizeFeatArtist,
  duoLyricsInstruction,
  duoLanguageRules,
} from "../../lib/featArtist.js";
import { llmJson, requireTextLlm } from "../llm.js";
import {
  promptJson,
  languagePromptName,
} from "./util.js";

function buildLyricsPrompt({
  lang,
  langName,
  langBlock,
  bilingual,
  featLangName,
  theme,
  artist,
  trends,
  lock,
  feat,
  form,
  duoBlock,
  repairNote = "",
}) {
  const lyricsLangHint = bilingual
    ? `vraies paroles bilingues sous chaque tag (lead = ${langName}, feat = ${featLangName})`
    : `de vraies paroles en ${langName} sous chaque tag`;
  return `Écris des paroles de chanson originales${bilingual ? " en duo bilingue" : ` en ${langName}`} pour cet artiste.
Artiste LEAD: ${promptJson({
  name: artist?.name,
  mode: artist?.mode,
  age: artist?.age,
  gender: artist?.gender,
  genre: artist?.genre,
  genres: artist?.genres,
  mood: artist?.mood,
  voice: artist?.voice,
  language: lang,
  bio: artist?.bio,
  influences: artist?.influences,
  styleArtist: artist?.styleArtist,
  styleArtists: artist?.styleArtists,
})}
${
  feat
    ? `Artiste FEAT (identité séparée — ne pas fusionner avec le lead): ${promptJson({
        name: feat.name,
        gender: feat.gender,
        genre: feat.genre,
        genres: feat.genres,
        mood: feat.mood,
        voice: feat.voice,
        language: feat.language || lang,
        vocalStyle: feat.styleLock?.vocalStyle,
        timbre: feat.styleLock?.timbre,
        writingStyle: feat.styleLock?.writingStyle,
      })}`
    : ""
}
Style musical VERROUILLÉ (lane production du LEAD): ${artist?.genre || "pop contemporain"}
${
  lock
    ? `Lock référence lead "${lock.matchedName}"${Array.isArray(artist?.styleArtists) && artist.styleArtists.length > 1 ? ` (blend: ${artist.styleArtists.join(" × ")})` : ""}:
- production: ${lock.production}
- writingStyle: ${lock.writingStyle}
- mood/energy: ${lock.mood} / ${lock.energy}
- groove/rythme: ${lock.rhythmFeel || lock.tempoFeel || ""}
- timbre: ${lock.timbre || ""}
- bpm cible: ${lock.bpm || "n/a"}
- instruments: ${(lock.instruments || []).join(", ")}
- sonicKeywords: ${(lock.sonicKeywords || []).join(", ")}
- doNot (styles/écritures interdits): ${(lock.doNot || []).join(", ")}
Écris dans EXACTEMENT cette lane pour le lead (hooks, rythme des phrases, vibe) — sans pasticher les paroles de "${lock.matchedName}".`
    : artist?.styleArtists?.length
      ? `Boussole style lead (sans pastiche) : ${artist.styleArtists.join(" · ")}`
      : artist?.styleArtist
        ? `Boussole style lead (sans pastiche) : ${artist.styleArtist}`
        : ""
}
${duoBlock}
${buildLyricsCraftBrief(form)}
${langBlock}
Thème/titre: ${theme || "inspire-toi des tendances"}
Tendances: ${promptJson(lock ? {} : trends || {})}
${repairNote ? `\nCORRECTION OBLIGATOIRE (précédente version invalide): ${repairNote}\n` : ""}
JSON strict RFC 8259:
{
  "title": string,
  "theme": string,
  "language": "${lang}",
  "structure": string[],
  "text": string
}
Le champ text doit contenir les tags MiniMax/ACE en anglais selon l'arc « ${form.id} »: ${form.tagsArc} avec ${lyricsLangHint}.
"structure" doit lister dans l'ordre les tags réellement présents dans "text".
Dans "text", apostrophes brutes (don't) — jamais \\'. Sauts de ligne = \\n uniquement.
"language" doit être exactement "${lang}".`;
}

export async function runLyrics({ keys, theme, artist, trends, language }) {
  requireTextLlm(keys);
  const lock = artist?.styleLock;
  const form = detectLyricsForm(lock, artist);
  const feat = normalizeFeatArtist(artist?.featArtist);
  const langRules = duoLanguageRules(artist, feat, language);
  const lang = langRules.leadLang;
  const langName = languagePromptName(lang);
  const featLangName = languagePromptName(langRules.featLang);
  const duoBlock = feat ? duoLyricsInstruction(artist, feat, form, language) : "";

  const promptArgs = {
    lang,
    langName,
    langBlock: langRules.block,
    bilingual: langRules.bilingual,
    featLangName,
    theme,
    artist,
    trends,
    lock,
    feat,
    form,
    duoBlock,
  };
  let data = await llmJson(keys, buildLyricsPrompt(promptArgs));
  let normalized = normalizeAndValidateLyrics(data, form);

  if (!normalized._validation?.ok) {
    const repairNote = (normalized._validation?.errors || []).join("; ") || "structure invalide";
    data = await llmJson(keys, buildLyricsPrompt({ ...promptArgs, repairNote }));
    normalized = normalizeAndValidateLyrics(data, form);
  }

  const { _validation, ...lyrics } = normalized;
  return {
    ...lyrics,
    language: lang,
    ...(langRules.bilingual ? { featLanguage: langRules.featLang } : {}),
    lyricsForm: form.id,
  };
}
