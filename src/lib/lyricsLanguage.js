/**
 * Contrôle de langue par chanteur (duo bilingue) — détecteur léger par mots-outils, sans dépendance.
 * Prod 20/10 « Station Essence Minuit » : 1er couplet de singer 2 (EN attendu) écrit en français.
 */
const STOP = {
  fr: "le la les un une des du de et est je tu il elle on nous vous ils pas ne plus mon ma mes ton ta tes son sa ses ce cette qui que dans sur pour avec sans mais ou où au aux comme tout rien jamais toujours moi toi lui leur nos vos suis es sommes êtes sont ai as avons ont fait va vais encore très".split(" "),
  en: "the a an and is are am i you he she we they it not no my your his her our their this that who what in on for with without but or to of at as all nothing never always me him them was were be been have has do does don't i'm it's we're you're can can't will won't just so up down out back go".split(" "),
  es: "el la los las un una y es yo tú él ella nosotros no mi tu su que en por para con sin pero o del al como todo nada nunca siempre soy eres somos".split(" "),
  de: "der die das ein eine und ist ich du er sie wir ihr nicht kein mein dein sein unser dass wer was in auf für mit ohne aber oder zu von bei wie alles nichts nie immer bin bist sind".split(" "),
  it: "il lo la gli le un una e è io tu lui lei noi voi non mio tuo suo che chi in su per con senza ma o di da come tutto niente mai sempre sono sei siamo".split(" "),
  pt: "o a os as um uma e é eu tu ele ela nós vós não meu teu seu que quem em no na por para com sem mas ou de do da como tudo nada nunca sempre sou és somos".split(" "),
};
const SETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v)]));

const tokens = (line) =>
  String(line || "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .split(/[^a-zà-ÿ']+/i)
    .flatMap((t) => (t.includes("'") && !/^(don't|i'm|it's|we're|you're|can't|won't)$/.test(t) ? t.split("'") : [t]))
    .filter(Boolean);

/** Scores par langue (mots-outils + indices orthographiques). */
export function languageScores(text) {
  const toks = tokens(text);
  const out = {};
  for (const [lang, set] of Object.entries(SETS)) out[lang] = toks.filter((t) => set.has(t)).length;
  const raw = String(text || "");
  out.fr += (raw.match(/[éèêàçùœ]/gi) || []).length * 0.5;
  out.en += (raw.match(/\b\w+'(s|t|re|ll|ve|m|d)\b/gi) || []).length * 0.5;
  return out;
}

/** Langue détectée parmi `candidates` (null si indécidable). */
export function detectLanguage(text, candidates = Object.keys(SETS)) {
  const sc = languageScores(text);
  const ranked = candidates.filter((c) => c in sc).map((c) => [c, sc[c]]).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 2) return null;
  if (ranked[1] && ranked[0][1] < ranked[1][1] * 1.5 + 1) return null;
  return ranked[0][0];
}

/** Découpe en blocs chantés par [singer N: …]. */
export function singerBlocks(text) {
  const blocks = [];
  let cur = null;
  let section = "";
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    const sing = line.match(/^\[singer\s*([12])\b[^\]]*\]$/i);
    if (sing) {
      cur = { singer: Number(sing[1]), section, lines: [] };
      blocks.push(cur);
      continue;
    }
    if (/^\[.*\]$/.test(line)) {
      section = line.slice(1, -1);
      cur = null;
      continue;
    }
    if (cur && line && !/^\(.*\)$/.test(line)) cur.lines.push(line);
  }
  return blocks.filter((b) => b.lines.length);
}

/**
 * Vérifie que chaque chanteur chante dans SA langue.
 * @returns {{ ok:boolean, checked:number, violations:Array<{singer:number, section:string, expected:string, detected:string, sample:string}> }}
 */
export function checkDuoLanguages(text, { singer1Lang, singer2Lang } = {}) {
  if (!singer1Lang || !singer2Lang || singer1Lang === singer2Lang) return { ok: true, checked: 0, violations: [] };
  const cands = [singer1Lang, singer2Lang].filter((l) => l in SETS);
  if (cands.length < 2) return { ok: true, checked: 0, violations: [] };
  const violations = [];
  let checked = 0;
  for (const b of singerBlocks(text)) {
    const expected = b.singer === 1 ? singer1Lang : singer2Lang;
    const detected = detectLanguage(b.lines.join("\n"), cands);
    if (!detected) continue;
    checked++;
    if (detected !== expected) {
      violations.push({ singer: b.singer, section: b.section, expected, detected, sample: b.lines[0].slice(0, 80) });
    }
  }
  return { ok: violations.length === 0, checked, violations };
}

/** Consigne de réparation lisible pour le LLM. */
export function duoLanguageRepairNote(check, names = {}) {
  if (!check?.violations?.length) return "";
  const list = check.violations
    .map((v) => `[${v.section || "?"}] singer ${v.singer}${names[v.singer] ? ` (${names[v.singer]})` : ""} écrit en ${v.detected} au lieu de ${v.expected} (« ${v.sample} »)`)
    .join(" ; ");
  return `LANGUE PAR CHANTEUR non respectée : ${list}. Réécris ces blocs dans la bonne langue — chaque chanteur chante UNIQUEMENT dans sa langue, sur TOUS ses blocs.`;
}
