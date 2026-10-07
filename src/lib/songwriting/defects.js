/**
 * Détecteurs de défauts « paroles d’IA » au-delà des clichés :
 * didascalies (beat / instru / silence chantés), tics de fin de phrase,
 * lignes-prose trop longues, peu de rimes, refrain trop long,
 * artiste qui se nomme, couplets rap de longueurs incohérentes.
 * Tout est heuristique et sert à déclencher (et guider) la passe de réécriture.
 */
import { parseLyricsSections } from "../lyricsStructure.js";
import { getLyricsFormPreset } from "../musicLane/lyricsForms.js";
import { findCliches, clicheScore, normalizeForCliche } from "./cliches.js";

/** Longueur de ligne cible (mots) par forme — max = au-delà c’est un défaut. */
export const LINE_LENGTH_RULES = {
  rap_trap: { min: 8, max: 14, hookMax: 10, label: "rap : 8–14 mots (~10–16 syllabes) par mesure" },
  radio_pop: { min: 5, max: 10, hookMax: 8, label: "pop : 5–10 mots par ligne" },
  indie_alt: { min: 5, max: 11, hookMax: 8, label: "indie : 5–11 mots par ligne" },
  ballad: { min: 6, max: 12, hookMax: 9, label: "ballade : 6–12 mots par ligne" },
  edm: { min: 3, max: 8, hookMax: 6, label: "EDM : 3–8 mots par ligne" },
  metal: { min: 4, max: 10, hookMax: 8, label: "metal : 4–10 mots par ligne" },
};

export function lineRulesFor(form) {
  const id = getLyricsFormPreset(form).id;
  return LINE_LENGTH_RULES[id] || LINE_LENGTH_RULES.radio_pop;
}

/** Tics de fin de phrase / remplissage (max 1 par chanson). */
export const FILLER_TAGS = {
  fr: {
    anywhere: ["je te le jure", "je te jure", "je te le promets", "je te promets", "crois-moi", "crois moi"],
    tagEnd: ["tu vois", "tu sais", "hein", "n'est-ce pas", "pas vrai", "t'sais", "tu comprends"],
  },
  en: {
    anywhere: ["i swear", "believe me", "i promise you"],
    tagEnd: ["you know", "you see", "right", "ya know", "y'know", "you feel me"],
  },
};

const HOOK_TAGS = /^(chorus|hook|drop|refrain)$/i;
const NARRATIVE_TAGS = /^(verse|build)$/i;

function langCode(lang) {
  return String(lang || "fr").toLowerCase().slice(0, 2);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rawLower(line) {
  return String(line || "").toLowerCase().replace(/[’‘`´]/g, "'");
}

/** Lignes chantées (hors tags, hors vides). */
function sungLines(body) {
  return String(body || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^\[[^\]]+\]$/.test(l));
}

/** Mots d’une ligne hors ad-libs entre parenthèses. */
export function wordCount(line) {
  const t = String(line || "").replace(/\([^)]*\)/g, " ").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const META_WORDS_RE =
  /(?:^|\s)(?:instru|instrus|instrumentale?s?|instrumental|melodie|melodies|melody|melodies|bpm|808s?|kick|snare|hi ?hats?|hihats?|bassline|prod|production|synthes?|synths?|reverb|autotune|auto tune|vocodeur|vocoder|refrain|couplet|ce son|le son monte)(?=\s|$)/u;
const BEAT_RE =
  /(?:^|\s)(?:(?:le|un|ce|mon|ton|son|du|the|this|that|a|my) beats?|beats? (?:monte|montent|tombe|tombent|s'arrete|s'arretent|cogne|drops?|kicks? in|stops?|starts?|fades?|demarre))(?=\s|$)/u;
const MUSIC_ACTION_RE =
  /(?:^|\s)(?:la musique|le son|le rythme|the music|the sound|the rhythm) (?:monte|s'arrete|s'eteint|baisse|demarre|commence|tombe|explose|ralentit|s'accelere|reprend|fades?|stops?|drops?|builds?|kicks? in|slows? down)(?=\s|$)/u;
const SILENCE_ONLY_RE =
  /^(?:(?:silence|presque|pause|stop|noir|fade|out|fin|rien|break|the|end|nothing|almost|quiet|puis|then|et)\s*)+$/u;

/** Vrai si la ligne décrit la musique / la prod / le silence au lieu d’être chantée. */
export function isStageDirectionLine(line) {
  const raw = String(line || "").trim();
  if (!raw || /^\[[^\]]+\]$/.test(raw)) return false;
  const n = normalizeForCliche(raw);
  if (!n) return false;
  const words = n.split(" ").length;
  if (/^\*.*\*$/.test(raw) && words > 2) return true; // didascalie entre *astérisques*
  if (SILENCE_ONLY_RE.test(n)) return true;
  if (/(?:^|\s)(?:silence|silencio)(?=\s|$)/u.test(n) && words <= 4) return true;
  if (BEAT_RE.test(n) || MUSIC_ACTION_RE.test(n)) return true;
  if (META_WORDS_RE.test(n)) return true;
  return false;
}

/** Supprime les lignes-didascalies (post-filtre). */
export function stripStageDirections(text) {
  let removed = 0;
  const out = String(text || "")
    .split("\n")
    .filter((line) => {
      if (isStageDirectionLine(line)) {
        removed += 1;
        return false;
      }
      return true;
    })
    .join("\n");
  return { text: out, removed };
}

/** Compte les tics de remplissage. */
export function findFillerTags(text, lang = "fr") {
  const conf = FILLER_TAGS[langCode(lang)];
  if (!conf) return [];
  const counts = new Map();
  for (const line of sungLines(text)) {
    const low = rawLower(line);
    const norm = normalizeForCliche(line);
    for (const phrase of conf.anywhere) {
      const re = new RegExp(`(?:^|[^\\p{L}])${escapeRe(phrase)}(?=$|[^\\p{L}])`, "gu");
      const m = low.match(re);
      if (m) counts.set(phrase, (counts.get(phrase) || 0) + m.length);
    }
    for (const phrase of conf.tagEnd) {
      const p = escapeRe(phrase);
      const atEnd = new RegExp(`(?:^|\\s)${escapeRe(normalizeForCliche(phrase))}$`, "u").test(norm);
      const punct = new RegExp(`(?:^|[\\s,])${p}\\s*[?!,]`, "u").test(low);
      const comma = new RegExp(`,\\s*${p}(?=$|[^\\p{L}])`, "u").test(low);
      if (atEnd || punct || comma) counts.set(phrase, (counts.get(phrase) || 0) + 1);
    }
  }
  return [...counts.entries()].map(([phrase, count]) => ({ phrase, count }));
}

const VOWELS = "aeiouyéèêëàâîïôûùœ";
const VOWEL_RUN_RE = new RegExp(`[${VOWELS}]+[^${VOWELS}]*$`, "u");

/** Fin phonétique approximative d’un mot : { nucleus, key }. */
export function rhymeEnding(word, lang = "fr") {
  let w = String(word || "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}]/gu, "");
  if (!w) return { nucleus: "", key: "" };
  if (langCode(lang) === "fr") {
    if (w.length > 2) w = w.replace(/[sx]$/, "");
    w = w
      .replace(/(eau|au|ô|ot|op|os)$/u, "o")
      .replace(/(ets?|ez|er|ée|ai|ais|ait|aient)$/u, "é")
      .replace(/(.)\1e?$/u, "$1")
      .replace(/([^aeiouyéèêëàâîïôûùœ])e$/u, "$1")
      .replace(/([aeiouyéèêëàâîïôûù])(t|d|p)$/u, "$1")
      .replace(/mp$/u, "m")
      .replace(/(ain|ein|in|un|im)$/u, "ĩ")
      .replace(/(an|en|am|em|ent)$/u, "ã")
      .replace(/(on|om)$/u, "õ")
      .replace(/[èêë]/gu, "e")
      .replace(/[àâ]/gu, "a")
      .replace(/[îï]/gu, "i")
      .replace(/[ûù]/gu, "u");
    const m = w.match(new RegExp(`[${VOWELS}ĩãõ]+[^${VOWELS}ĩãõ]*$`, "u"));
    const key = m ? m[0] : w.slice(-2);
    const nucleus = (key.match(new RegExp(`^[${VOWELS}ĩãõ]+`, "u")) || [key])[0];
    return { nucleus, key };
  }
  if (w.length > 3) w = w.replace(/(es|s)$/, "");
  w = w.replace(/([^aeiouy])e$/, "$1");
  const m = w.match(VOWEL_RUN_RE);
  const key = m ? m[0] : w.slice(-2);
  const nucleus = (key.match(/^[aeiouy]+/) || [key])[0];
  return { nucleus, key };
}

function lastWordRaw(line) {
  const words = String(line || "")
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .map((x) => x.replace(/[^\p{L}\p{N}'’]/gu, ""))
    .filter(Boolean);
  return words[words.length - 1] || "";
}

/** Rime exacte, ou assonance (même voyelle, syllabes toutes deux ouvertes ou toutes deux fermées). */
function rhymes(a, b) {
  if (a.key === b.key) return true;
  if (a.nucleus !== b.nucleus) return false;
  const aOpen = a.key === a.nucleus;
  const bOpen = b.key === b.nucleus;
  return aOpen === bOpen;
}

/** Part des lignes de couplet qui riment avec une ligne voisine (±2). */
export function endRhymeRatio(lines, lang = "fr") {
  const ends = lines.map((l) => rhymeEnding(lastWordRaw(l), lang));
  if (ends.length < 2) return 1;
  let ok = 0;
  ends.forEach((e, i) => {
    if (!e.key) return;
    for (const j of [i - 2, i - 1, i + 1, i + 2]) {
      const o = ends[j];
      // rime (même fin) ou assonance (même voyelle finale) — suffisant pour le rap
      if (o && o.key && rhymes(o, e)) {
        ok += 1;
        break;
      }
    }
  });
  return ok / ends.length;
}

function countName(text, names) {
  let inParens = 0;
  let outside = 0;
  for (const name of names) {
    const n = normalizeForCliche(name);
    if (!n || n.length < 2) continue;
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(n)}(?=$|[^\\p{L}\\p{N}])`, "gu");
    for (const line of sungLines(text)) {
      const parens = (line.match(/\([^)]*\)/g) || []).join(" ");
      const inP = (` ${normalizeForCliche(parens)} `.match(re) || []).length;
      const all = (` ${normalizeForCliche(line)} `.match(re) || []).length;
      inParens += inP;
      outside += Math.max(0, all - inP);
    }
  }
  return { inParens, outside, total: inParens + outside };
}

/**
 * Analyse complète.
 * @returns {{ score: number, reasons: string[], cliches: {phrase:string,count:number}[], fillers: {phrase:string,count:number}[], stageLines: string[], longLines: {line:string,words:number}[], rhymeRatio: number|null, hookIssues: string[], selfName: {inParens:number,outside:number,total:number} }}
 */
export function analyzeLyricsDefects(text, { lang = "fr", form = null, artistNames = [] } = {}) {
  const preset = getLyricsFormPreset(form);
  const rules = lineRulesFor(preset);
  const isRap = preset.id === "rap_trap";
  const sections = parseLyricsSections(text);
  const reasons = [];
  let score = 0;

  const cliches = findCliches(text, lang);
  if (cliches.length) {
    score += clicheScore(cliches);
    reasons.push(`clichés : ${cliches.map((h) => `« ${h.phrase} »${h.count > 1 ? ` ×${h.count}` : ""}`).join(", ")}`);
  }

  const fillers = findFillerTags(text, lang);
  const fillerTotal = fillers.reduce((s, f) => s + f.count, 0);
  if (fillerTotal > 1) {
    score += fillerTotal - 1;
    reasons.push(
      `tics de remplissage répétés (${fillerTotal}×, max 1 par chanson) : ${fillers.map((f) => `« ${f.phrase} »${f.count > 1 ? ` ×${f.count}` : ""}`).join(", ")}`,
    );
  }

  const stageLines = [];
  for (const s of sections) for (const l of sungLines(s.body)) if (isStageDirectionLine(l)) stageLines.push(l);
  if (stageLines.length) {
    score += 3 * Math.min(2, stageLines.length);
    reasons.push(
      `didascalies chantées (décrire le beat / l’instru / la mélodie / le silence est interdit) : ${stageLines.slice(0, 4).map((l) => `« ${l.slice(0, 80)} »`).join(" ; ")}`,
    );
  }

  const longLines = [];
  for (const s of sections) {
    if (HOOK_TAGS.test(s.canonical || s.tag)) continue;
    for (const l of sungLines(s.body)) {
      if (isStageDirectionLine(l)) continue;
      const w = wordCount(l);
      if (w > rules.max) longLines.push({ line: l, words: w });
    }
  }
  if (longLines.length) {
    const prose = longLines.some((l) => l.words >= rules.max + 6);
    score += Math.min(4, longLines.length) + (prose ? 3 : 0);
    reasons.push(
      `${longLines.length} ligne(s) trop longues, écriture en prose (${rules.label}) : ${longLines.slice(0, 3).map((l) => `« ${l.line.slice(0, 70)}… » (${l.words} mots)`).join(" ; ")}`,
    );
  }

  const verseBodies = sections.filter((s) => NARRATIVE_TAGS.test(s.canonical || s.tag)).map((s) => sungLines(s.body));
  const verseLines = verseBodies.flat().filter((l) => !isStageDirectionLine(l));
  let rhymeRatio = null;
  if (verseLines.length >= 4 && ["fr", "en"].includes(langCode(lang)) && preset.id !== "edm") {
    rhymeRatio = endRhymeRatio(verseLines, lang);
    if (rhymeRatio < 0.4) {
      score += 2;
      reasons.push(
        `peu de rimes de fin dans les couplets (${Math.round(rhymeRatio * 100)} % des lignes riment avec une voisine)${isRap ? " — il faut des rimes de fin + rimes internes / multisyllabiques / assonances" : " — rimes AABB ou ABAB attendues"}`,
      );
    }
  }

  if (isRap && verseBodies.length >= 2) {
    const counts = verseBodies.map((b) => b.length);
    const bad = counts.some((c) => c < 6) || Math.max(...counts) - Math.min(...counts) > 4;
    if (bad) {
      score += 1;
      reasons.push(`couplets rap de longueurs incohérentes (${counts.join(" / ")} lignes) — vise 8 ou 16 mesures, même nombre par couplet`);
    }
  }

  const hookIssues = [];
  const hook = sections.find((s) => HOOK_TAGS.test(s.canonical || s.tag));
  if (hook) {
    const lines = sungLines(hook.body);
    if (lines.length > 4) hookIssues.push(`refrain de ${lines.length} lignes (2–4 attendues)`);
    const longHook = lines.filter((l) => wordCount(l) > rules.hookMax);
    if (longHook.length) hookIssues.push(`lignes de refrain trop longues (> ${rules.hookMax} mots) : ${longHook.slice(0, 2).map((l) => `« ${l.slice(0, 60)} »`).join(" ; ")}`);
  }
  if (hookIssues.length) {
    score += 2 * hookIssues.length;
    reasons.push(`refrain pas assez punchy : ${hookIssues.join(" ; ")}`);
  }

  const names = [...new Set(artistNames.map((n) => String(n || "").trim()).filter((n) => n.length >= 2))];
  const selfName = countName(text, names);
  const nameAllowed = isRap && selfName.outside === 0 && selfName.inParens <= 1;
  if (selfName.total > 0 && !nameAllowed) {
    score += 3;
    reasons.push(
      `l’artiste se nomme dans ses paroles (${selfName.total}×) — interdit${isRap ? " (sauf UNE signature ad-lib entre parenthèses en intro/outro)" : ""}`,
    );
  }

  return { score, reasons, cliches, fillers, stageLines, longLines, rhymeRatio, hookIssues, selfName };
}
