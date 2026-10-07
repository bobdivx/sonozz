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
  buildAntiRepeatBlock,
  buildBriefBlock,
  buildVoiceBlock,
  buildWritingRulesBlock,
  clicheScore,
  extractHookLine,
  findCliches,
  pickSongBrief,
  shouldUseNews,
} from "../../lib/songwriting/index.js";
import { loadArtistSongHistory, loadArtistWritingSettings } from "../songwriting/history.js";
import { fetchNewsHeadlines } from "../songwriting/news.js";
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
  brief = null,
  history = [],
  album = null,
  userTheme = "",
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
${buildVoiceBlock(artist)}
${buildLyricsCraftBrief(form)}
${buildWritingRulesBlock(lang)}
${langBlock}
${buildBriefBlock(brief)}
${
  userTheme
    ? `Thème / titre demandé par l’utilisateur (prioritaire sur l’angle du brief ; garde point de vue, ton et ancrages): ${userTheme}`
    : "Aucun thème imposé : invente un sujet PRÉCIS et neuf à partir du BRIEF (une situation, pas un sentiment)."
}
${
  album?.title || album?.concept
    ? `Album en cours: ${promptJson({ title: album.title, concept: album.concept })} — ce titre est UNE facette de l’album, pas son résumé.`
    : ""
}
${buildAntiRepeatBlock(album?.siblings || [], { label: "AUTRES TITRES DE CET ALBUM" })}
${buildAntiRepeatBlock(history)}
${!lock && trends && Object.keys(trends).length ? `Contexte marché (énergie / format du hook — PAS un sujet de chanson): ${promptJson({ mood: trends.mood, hooks: trends.hooks, genre: trends.genre })}` : ""}
${repairNote ? `\nCORRECTION OBLIGATOIRE (précédente version invalide): ${repairNote}\n` : ""}
JSON strict RFC 8259:
{
  "title": string,
  "theme": string,
  "hook": string,
  "newsRef": string,
  "language": "${lang}",
  "structure": string[],
  "text": string
}
"theme" = la situation concrète racontée (1 phrase, avec qui / où / quoi), pas un mot-valise.
"hook" = la ligne clé du refrain, recopiée telle quelle.
Le titre doit être original : pas un mot abstrait seul (« Liberté », « Lumière », « Nuit »…), pas un titre déjà utilisé ci-dessus.
Le champ text doit contenir les tags MiniMax/ACE en anglais selon l'arc « ${form.id} »: ${form.tagsArc} avec ${lyricsLangHint}.
"structure" doit lister dans l'ordre les tags réellement présents dans "text".
Dans "text", apostrophes brutes (don't) — jamais \\'. Sauts de ligne = \\n uniquement.
"language" doit être exactement "${lang}".`.replace(/\n{3,}/g, "\n\n");
}

const BRIEF_STR_MAX = 400;

function cleanStr(v, n = BRIEF_STR_MAX) {
  return String(v ?? "").trim().slice(0, n);
}

/** Brief fourni par le client (plan d’album) — on ne garde que les champs connus. */
function sanitizeBrief(raw) {
  if (!raw || typeof raw !== "object") return null;
  const brief = {
    angleId: cleanStr(raw.angleId, 40) || undefined,
    category: cleanStr(raw.category, 40) || undefined,
    angle: cleanStr(raw.angle),
    pov: cleanStr(raw.pov, 80),
    tone: cleanStr(raw.tone, 60),
    anchors: Array.isArray(raw.anchors) ? raw.anchors.map((a) => cleanStr(a, 120)).filter(Boolean).slice(0, 5) : [],
    useNews: Boolean(raw.useNews),
  };
  return brief.angle || brief.pov || brief.tone ? brief : null;
}

function sanitizeAlbum(raw) {
  if (!raw || typeof raw !== "object") return null;
  const siblings = (Array.isArray(raw.siblings) ? raw.siblings : [])
    .map((t) => ({
      title: cleanStr(t?.title, 80),
      theme: cleanStr(t?.theme, 160),
      hook: cleanStr(t?.hook, 120),
      category: cleanStr(t?.category, 40) || undefined,
    }))
    .filter((t) => t.title || t.theme)
    .slice(0, 14);
  const album = { title: cleanStr(raw.title, 120), concept: cleanStr(raw.concept, 500), siblings };
  return album.title || album.concept || siblings.length ? album : null;
}

/** Choisit le brief : plan d’album > thème utilisateur (+ POV/ton) > tirage anti-répétition (+ actu). */
async function resolveBrief({ clientBrief, userTheme, artist, history, album, lang, rng = Math.random }) {
  const excludeCategories = (album?.siblings || []).map((t) => t.category).filter(Boolean);
  const base = pickSongBrief({ artist, recent: history, excludeCategories, rng });
  let brief = clientBrief
    ? { ...base, ...Object.fromEntries(Object.entries(clientBrief).filter(([, v]) => v && (!Array.isArray(v) || v.length))) }
    : base;

  if (userTheme && !clientBrief) {
    // L’utilisateur a donné un thème : on garde POV / ton / ancrages, pas l’angle tiré au sort.
    brief = { ...brief, angleId: "user", category: "user", angle: `Traiter le thème demandé par une scène précise et un angle personnel : ${userTheme.slice(0, 200)}` };
  }

  const wantNews = clientBrief ? clientBrief.useNews : !userTheme && shouldUseNews(artist, rng);
  if (wantNews) {
    try {
      const all = await fetchNewsHeadlines(lang, { limit: 16 });
      // Mélange pour ne pas toujours proposer la même « une » en premier
      const candidates = [...all].sort(() => rng() - 0.5).slice(0, 6);
      if (candidates.length) {
        brief = pickSongBrief({ artist, recent: history, excludeCategories, rng, news: { candidates } });
        if (clientBrief?.pov) brief.pov = clientBrief.pov;
        if (clientBrief?.tone) brief.tone = clientBrief.tone;
      }
    } catch (e) {
      console.warn("[lyrics] news:", e.message);
    }
  }
  delete brief.useNews;
  return brief;
}

function buildPolishPrompt({ lyrics, hits, lang, langName, form, artist, brief }) {
  return `Tu es un·e auteur·e-compositeur·rice exigeant·e. Réécris ces paroles pour qu’elles sonnent comme un VRAI artiste, pas comme une IA.
Artiste: ${promptJson({ name: artist?.name, genre: artist?.genre, writingVoice: artist?.writingVoice, city: artist?.city })}
${buildBriefBlock(brief)}

Problèmes détectés : clichés ${hits.map((h) => `« ${h.phrase} »${h.count > 1 ? ` ×${h.count}` : ""}`).join(", ")}.
${buildWritingRulesBlock(lang)}

Consignes de réécriture :
- Garde EXACTEMENT les mêmes tags de section, dans le même ordre (arc « ${form.id} »: ${form.tagsArc}), et la langue (${langName}).
- Garde le sujet, le point de vue et l’idée du hook ; tu peux reformuler le hook s’il contient un cliché.
- Remplace chaque cliché par une image concrète, un détail précis ou une tournure parlée inattendue.
- Ne rallonge pas : même nombre de lignes à ±2 par section.

Paroles actuelles (titre « ${lyrics.title || ""} ») :
${String(lyrics.text || "").slice(0, 4000)}

JSON strict RFC 8259:
{ "title": string, "theme": string, "hook": string, "newsRef": string, "language": "${lang}", "structure": string[], "text": string }
Dans "text", apostrophes brutes — jamais \\'. Sauts de ligne = \\n uniquement.`;
}

export async function runLyrics({
  keys,
  theme,
  artist: artistIn,
  trends,
  language,
  brief: clientBriefRaw = null,
  album: albumRaw = null,
  projectId = null,
}) {
  requireTextLlm(keys);
  // Réglages d’écriture à jour depuis le hub (le projet studio peut être ancien)
  const writing = await loadArtistWritingSettings(artistIn?.slug);
  const artist = { ...(artistIn || {}), ...writing };
  const lock = artist?.styleLock;
  const form = detectLyricsForm(lock, artist);
  const feat = normalizeFeatArtist(artist?.featArtist);
  const langRules = duoLanguageRules(artist, feat, language);
  const lang = langRules.leadLang;
  const langName = languagePromptName(lang);
  const featLangName = languagePromptName(langRules.featLang);
  const duoBlock = feat ? duoLyricsInstruction(artist, feat, form, language) : "";

  const userTheme = cleanStr(theme, 300);
  const album = sanitizeAlbum(albumRaw);
  const history = await loadArtistSongHistory({
    slug: artist?.slug,
    name: artist?.name,
    limit: 10,
    excludeProjectId: projectId,
  });
  const brief = await resolveBrief({
    clientBrief: sanitizeBrief(clientBriefRaw),
    userTheme,
    artist,
    history,
    album,
    lang,
  });

  const promptArgs = {
    lang,
    langName,
    langBlock: langRules.block,
    bilingual: langRules.bilingual,
    featLangName,
    theme: userTheme,
    userTheme,
    artist,
    trends,
    lock,
    feat,
    form,
    duoBlock,
    brief,
    history,
    album,
  };
  let data = await llmJson(keys, buildLyricsPrompt(promptArgs), { temperature: 1 });
  let normalized = normalizeAndValidateLyrics(data, form);

  if (!normalized._validation?.ok) {
    const repairNote = (normalized._validation?.errors || []).join("; ") || "structure invalide";
    data = await llmJson(keys, buildLyricsPrompt({ ...promptArgs, repairNote }), { temperature: 0.9 });
    normalized = normalizeAndValidateLyrics(data, form);
  }

  // Passe anti-clichés : seulement si le texte en est chargé (1 appel LLM en plus).
  const polishMode = String(keys?.lyricsPolish || "auto").toLowerCase();
  let hits = findCliches(normalized.text, lang);
  let polished = false;
  const threshold = polishMode === "always" ? 0 : 3;
  if (polishMode !== "off" && normalized._validation?.ok && clicheScore(hits) >= threshold && (hits.length || polishMode === "always")) {
    try {
      const rewrite = await llmJson(
        keys,
        buildPolishPrompt({ lyrics: normalized, hits, lang, langName, form, artist, brief }),
        { temperature: 0.8 },
      );
      const candidate = normalizeAndValidateLyrics({ ...normalized, ...rewrite }, form);
      const nextHits = findCliches(candidate.text, lang);
      if (candidate._validation?.ok && clicheScore(nextHits) < clicheScore(hits)) {
        normalized = candidate;
        hits = nextHits;
        polished = true;
      }
    } catch (e) {
      console.warn("[lyrics] polish:", e.message);
    }
  }

  const { _validation, ...lyrics } = normalized;
  const newsRef = cleanStr(lyrics.newsRef, 240);
  return {
    ...lyrics,
    hook: cleanStr(lyrics.hook, 160) || extractHookLine(lyrics.text),
    newsRef: newsRef || undefined,
    brief: {
      angleId: brief.angleId,
      category: brief.category,
      pov: brief.pov,
      tone: brief.tone,
      anchors: brief.anchors,
      news: Boolean(brief.news),
    },
    quality: { cliches: hits.map((h) => h.phrase), polished },
    language: lang,
    ...(langRules.bilingual ? { featLanguage: langRules.featLang } : {}),
    lyricsForm: form.id,
  };
}
