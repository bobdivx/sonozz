/**
 * Clichés de parolier à bannir (FR / EN).
 * Écrits avec accents (affichés tels quels dans le prompt) ; détection insensible à la casse / aux accents. Les entrées sont des expressions
 * (pas des mots isolés trop courants) pour éviter les faux positifs.
 */

export const BANNED_CLICHES = {
  fr: [
    "dans la nuit",
    "au cœur de la nuit",
    "jusqu'au bout de la nuit",
    "nuit blanche",
    "mon cœur",
    "cœur brisé",
    "cœur en feu",
    "je brûle",
    "ça brûle",
    "brûle en moi",
    "le feu en moi",
    "flamme",
    "liberté",
    "libre comme",
    "ensemble on est plus fort",
    "plus forts ensemble",
    "on lâche rien",
    "je me relève",
    "toucher le ciel",
    "déployer mes ailes",
    "mes ailes",
    "sous les étoiles",
    "les étoiles",
    "nos rêves",
    "mes rêves",
    "pour toujours",
    "à jamais",
    "mon âme",
    "au fond de mon âme",
    "dans le noir",
    "les ombres",
    "néon",
    "le temps qui passe",
    "au fil du temps",
    "sans toi je ne suis rien",
    "briser mes chaînes",
    "briser les chaînes",
    "vivre à fond",
    "me sentir vivant",
    "danser jusqu'à l'aube",
    "jusqu'à l'aube",
    "mes cicatrices",
    "océan de larmes",
    "sous la pluie",
    "la tempête",
    "l'horizon",
    "mon destin",
    "lumière dans le noir",
    "plus jamais",
    "on ira loin",
    "rien ne nous arrêtera",
    "c'est notre moment",
    "vibrer",
    "ça vient du cœur",
    "du fond du cœur",
    "tourne, tourne",
    "le temps s'est emballé",
    "le temps s'arrête",
    "comme si j'étais",
    "voyager sans bouger",
    "les yeux fermés",
    "au bout du monde",
  ],
  en: [
    "in the night",
    "through the night",
    "all night long",
    "my heart",
    "broken heart",
    "heart on fire",
    "set me free",
    "burning",
    "on fire",
    "fire inside",
    "touch the sky",
    "spread my wings",
    "fly away",
    "under the stars",
    "the stars align",
    "forever and always",
    "dancing in the dark",
    "lost in the moment",
    "stronger together",
    "rise up",
    "break the chains",
    "chasing dreams",
    "chasing my dreams",
    "neon lights",
    "city lights",
    "ocean of tears",
    "in the shadows",
    "my soul",
    "feel alive",
    "never let go",
    "end of time",
    "light up the sky",
    "against the world",
    "we own the night",
    "can't stop won't stop",
    "into the unknown",
    "this is our moment",
    "nothing can stop us",
    "straight from the heart",
    "from the bottom of my heart",
    "round and round",
    "time stood still",
    "time flies",
    "as if i was",
    "as if i were",
    "travel without moving",
    "with my eyes closed",
  ],
};

/**
 * Clichés « motifs » (regex sur texte normalisé sans accents) — ex. le temps personnifié.
 * label = forme affichée dans le prompt et dans les défauts.
 */
export const CLICHE_PATTERNS = {
  fr: [
    {
      label: "le temps personnifié (« le temps s'est emballé », « le temps est une… », « le temps me vole »)",
      re: /(?:^|\s)le temps (?:est (?:un|une|mon|ma|le|la|ce|cette)|s'est \p{L}+|s'emball\p{L}*|s'enfuit|s'echappe|file|me (?:vole|ment|tue|nargue|ronge|fuit|guette)|nous (?:vole|ment|tue|fuit|guette)|m'a (?:vole|tue|trahi)|joue contre)(?=\s|$)/gu,
    },
  ],
  en: [
    {
      label: "personified time (« time is a thief », « time is running out », « time won't wait »)",
      re: /(?:^|\s)time (?:is (?:a|an|my|the|running out)|won't wait|slips away|steals|stole|keeps running|is against)(?=\s|$)/gu,
    },
  ],
};

export function normalizeForCliche(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Liste des clichés pour une langue (fr/en ; autre langue → aucun). */
export function clichesFor(lang = "fr") {
  const code = String(lang || "fr").toLowerCase().slice(0, 2);
  return BANNED_CLICHES[code] || [];
}

/**
 * Retourne les clichés trouvés (uniques, dans l’ordre de la liste) + nombre d’occurrences.
 * @returns {{ phrase: string, count: number }[]}
 */
export function findCliches(text, lang = "fr") {
  const hay = ` ${normalizeForCliche(text)} `;
  if (!hay.trim()) return [];
  const out = [];
  for (const phrase of clichesFor(lang)) {
    const needle = normalizeForCliche(phrase);
    // L’apostrophe compte comme lettre (« l'a jamais » ≠ « à jamais »)
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}'])${escapeRe(needle)}(?=$|[^\\p{L}\\p{N}'])`, "gu");
    const m = hay.match(re);
    if (m?.length) out.push({ phrase, count: m.length });
  }
  const code = String(lang || "fr").toLowerCase().slice(0, 2);
  for (const { label, re } of CLICHE_PATTERNS[code] || []) {
    const m = hay.match(new RegExp(re.source, re.flags));
    if (m?.length) out.push({ phrase: label, count: m.length });
  }
  return out;
}

/** Score simple : nombre de clichés distincts + bonus si répétés (refrain). */
export function clicheScore(hits = []) {
  return hits.reduce((s, h) => s + 1 + Math.min(2, Math.max(0, h.count - 1)) * 0.5, 0);
}

/** Bloc prompt « interdits » (langue des paroles). */
export function clicheBanBlock(lang = "fr") {
  const list = clichesFor(lang);
  const fr = lang === "fr" ? list : BANNED_CLICHES.fr;
  const en = lang === "en" ? list : BANNED_CLICHES.en;
  const shown = lang === "fr" ? fr : lang === "en" ? en : [...fr.slice(0, 25), ...en.slice(0, 20)];
  return `CLICHÉS INTERDITS (ni tels quels, ni traduits, ni à peine reformulés) : ${shown
    .slice(0, 80)
    .map((p) => `« ${p} »`)
    .join(", ")}${(CLICHE_PATTERNS[lang] || []).map((p) => `, ${p.label}`).join("")}.
Pas de vocabulaire « poster motivationnel » (rêves, ailes, étoiles, flamme, destin, liberté, âme) sauf si c’est détourné de façon concrète et inattendue.`;
}
