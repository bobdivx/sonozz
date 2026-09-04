import {
  buildLyricsCraftBrief,
  detectLyricsForm,
} from "../../lib/musicLane.js";
import { normalizeAndValidateLyrics } from "../../lib/lyricsStructure.js";
import { normalizeFeatArtist, duoLyricsInstruction } from "../../lib/featArtist.js";
import { llmJson, requireTextLlm } from "../llm.js";
import {
  promptJson,
  resolveLanguage,
  languagePromptName,
} from "./util.js";

function buildLyricsPrompt({ lang, langName, theme, artist, trends, lock, feat, form, duoBlock, repairNote = "" }) {
  return `Écris des paroles de chanson originales en ${langName} pour cet artiste.
Artiste LEAD: ${promptJson({
  name: artist?.name,
  mode: artist?.mode,
  age: artist?.age,
  gender: artist?.gender,
  genre: artist?.genre,
  genres: artist?.genres,
  mood: artist?.mood,
  voice: artist?.voice,
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
Langue obligatoire des paroles: ${langName} (code ${lang}) — aucune autre langue dans le chant.
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
Le champ text doit contenir les tags MiniMax/ACE en anglais selon l'arc « ${form.id} »: ${form.tagsArc} avec de vraies paroles en ${langName} sous chaque tag.
"structure" doit lister dans l'ordre les tags réellement présents dans "text".
Dans "text", apostrophes brutes (don't) — jamais \\'. Sauts de ligne = \\n uniquement.
"language" doit être exactement "${lang}".`;
}

export async function runLyrics({ keys, theme, artist, trends, language }) {
  requireTextLlm(keys);
  const lang = resolveLanguage(language, artist);
  const langName = languagePromptName(lang);
  const lock = artist?.styleLock;
  const form = detectLyricsForm(lock, artist);
  const feat = normalizeFeatArtist(artist?.featArtist);
  const duoBlock = feat ? duoLyricsInstruction(artist, feat, form) : "";

  const promptArgs = { lang, langName, theme, artist, trends, lock, feat, form, duoBlock };
  let data = await llmJson(keys, buildLyricsPrompt(promptArgs));
  let normalized = normalizeAndValidateLyrics(data, form);

  if (!normalized._validation?.ok) {
    const repairNote = (normalized._validation?.errors || []).join("; ") || "structure invalide";
    data = await llmJson(keys, buildLyricsPrompt({ ...promptArgs, repairNote }));
    normalized = normalizeAndValidateLyrics(data, form);
  }

  const { _validation, ...lyrics } = normalized;
  return { ...lyrics, language: lang, lyricsForm: form.id };
}
