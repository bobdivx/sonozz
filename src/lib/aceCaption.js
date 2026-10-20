/**
 * Caption ACE-Step en TAGS COURTS (recette validée Skarlvind v3/v4, oct. 2026).
 *
 * Leçons encodées :
 *  - pas de prose, pas de noms d'artistes / chanteurs (le modèle ne les connaît pas, ou un homonyme) ;
 *  - le grain de voix passe par des mots de VOIX (raspy, gravelly, distorted shouted vocals…) ;
 *  - « trap », « 808 », « dubstep », « drill » NETTOIENT une voix rauque : retirés quand on vise un grain rauque ;
 *  - « no guitars » quand la référence n'est pas rock / metal (catalogue réel) ;
 *  - duo : « male and female vocal duet, both voices clearly audible » en tête ;
 *  - genres : uniquement ceux confirmés par le CATALOGUE (Deezer / Spotify / iTunes / Qobuz…) ou par
 *    plusieurs sources — jamais un tag d'écoute audio seul (c'est ce qui avait produit « dubstep »).
 */

export const ACE_CAPTION_MAX = 420;

const ROUGH_RX = /\b(rasp(y|iness)?|gravel+(y|ly)?|grit(ty)?|husky|hoarse|distort(ed|ion)|growl(ed|ing|s)?|scream(ed|ing|s)?|shout(ed|ing|s)?|rough|harsh|throaty|gruff|raw)\b/i;
const CLEANING_GENRE_RX = /\b(trap|808s?|dubstep|drill|hyperpop|auto-?tune(d)?|vocoder)\b/i;
const ROCK_RX = /\b(rock|metal|punk|grunge|hardcore|emo|shoegaze|stoner|thrash|djent|metalcore)\b/i;
const RAP_RX = /\b(rap|hip[- ]?hop|drill|grime|trap)\b/i;
const GUITARLESS_LANE_RX = /\b(electro(nic|nica)?|edm|techno|house|dubstep|trap|hip[- ]?hop|rap|drill|dance|synth|dnb|drum and bass|bass music|trance|phonk)\b/i;
const VOICE_WORDS = [
  "high-pitched", "deep", "low", "raspy", "gravelly", "husky", "hoarse", "gritty", "distorted", "shouted",
  "growled", "screamed", "belting", "belted", "powerful", "breathy", "airy", "smooth", "clean", "soft",
  "warm", "bright", "nasal", "soulful", "falsetto", "crooning", "intimate", "whispered", "operatic",
  "melismatic", "rough", "throaty", "sweet", "velvety", "dark", "strong", "tender",
];
const RANGE_WORDS = ["bass", "baritone", "tenor", "alto", "mezzo", "soprano", "countertenor"];

const lc = (s) => String(s || "").toLowerCase();
const words = (s) => lc(s).replace(/[^a-z0-9\- ]+/g, " ").split(/\s+/).filter(Boolean);
const uniq = (arr) => arr.filter((v, i, a) => v && a.findIndex((x) => lc(x) === lc(v)) === i);

/** Retire noms propres connus (artistes de réf., similaires, membres) et formules « in the style of ». */
export function stripNames(text, names = []) {
  let out = String(text || "");
  for (const n of names.filter((x) => String(x || "").trim().length >= 3)) {
    const esc = String(n).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${esc}\\b`, "gi"), "");
  }
  return out
    .replace(/\b(exactly )?in the style of\b[^,.;]*/gi, "")
    .replace(/\b(like|similar to|inspired by|à la)\s+[A-Z][\w'’-]*(\s+[A-Z][\w'’-]*)*/g, "")
    .replace(/\s*,\s*(,\s*)+/g, ", ")
    .replace(/^\s*[,.]\s*|\s*[,.]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Mots de voix (grain / hauteur / registre) depuis un texte libre. */
const ROUGH_SYNONYMS = new Set(["gritty", "rough", "raw", "harsh", "hoarse", "throaty", "gruff", "grit", "raspiness"]);
const VOICE_ALIASES = { shouting: "shouted", shout: "shouted", screaming: "screamed", growling: "growled", belted: "belting", belt: "belting", breathiness: "breathy", husk: "husky" };

export function voiceTags(text, { max = 4 } = {}) {
  const w = words(text).map((x) => VOICE_ALIASES[x] || x);
  let grain = VOICE_WORDS.filter((v) => w.includes(v));
  // synonymes de rugosité → « raspy » (mot de voix qu'ACE rend le mieux)
  if (w.some((x) => ROUGH_SYNONYMS.has(x))) grain = ["raspy", ...grain.filter((g) => !ROUGH_SYNONYMS.has(g))];
  let range = RANGE_WORDS.find((r) => w.includes(r)) || null;
  const t = lc(text);
  const high = /\bhigh(-pitched)?\b|\bhigh baritone\b/.test(t);
  if (range === "baritone" && /high baritone/.test(t)) range = "tenor";
  if (high && !grain.includes("high-pitched")) grain = ["high-pitched", ...grain];
  return { grain: uniq(grain).slice(0, max), range };
}

/** Genres retenus : confirmés par le catalogue, ou présents ≥ 2 fois parmi les sources. */
export function confirmedGenres({ catalogGenres = [], lockGenres = [], listenedGenres = [] } = {}, max = 3) {
  const cat = catalogGenres.map(lc).filter(Boolean);
  const all = [...lockGenres, ...listenedGenres].map(lc).filter(Boolean);
  const keep = [];
  for (const g of uniq([...lockGenres.map(lc), ...cat])) {
    if (g.length > 30 || /[,;/]/.test(g)) continue; // tag court uniquement (pas de résumé en prose)
    const toks = words(g);
    const inCat = cat.some((c) => c === g || toks.some((t) => t.length > 3 && words(c).includes(t)));
    const count = all.filter((x) => x === g).length + (inCat ? 1 : 0);
    // un genre « nettoyant » (dubstep, trap…) doit être dans le CATALOGUE lui-même
    if (CLEANING_GENRE_RX.test(g) && !cat.some((c) => CLEANING_GENRE_RX.test(c))) continue;
    if (inCat || count >= 2) keep.push(g);
  }
  return uniq(keep).slice(0, max);
}

function voicePhrase(gender, vt, fallback) {
  const g = gender === "male" ? "male" : gender === "female" ? "female" : "";
  const grain = vt.grain.filter((x) => !["dark"].includes(x));
  if (!grain.length && !vt.range && fallback) return fallback;
  const head = grain.slice(0, 3).join(" ");
  // Registre aigu en tête : « high-pitched male tenor, raspy shouted » (sinon ACE dérive vers un baryton grave).
  if (g === "male" && grain.includes("high-pitched")) {
    const rest = grain.filter((x) => x !== "high-pitched").slice(0, 2).join(" ");
    return [`high-pitched male ${vt.range || "tenor"}`, rest ? `${rest} vocals` : null].filter(Boolean).join(", ");
  }
  if (g === "male") return [head, "male", vt.range || "vocal"].filter(Boolean).join(" ");
  if (g === "female") return [head, "female", vt.range && vt.range !== "tenor" ? vt.range : "vocal"].filter(Boolean).join(" ");
  return [head, vt.range || "lead vocal"].filter(Boolean).join(" ");
}

/**
 * Construit la caption à partir du styleLock (réel) + catalogue + profil mesuré (facultatif).
 * @param {object} p
 * @param {object} p.styleLock      lock résolu (genres, instruments, timbre, vocalStyle, duoVocals, bpm…)
 * @param {string[]} [p.catalogGenres] genres catalogue (albums Deezer, Spotify, iTunes, Qobuz)
 * @param {boolean} [p.duo]
 * @param {"male"|"female"|null} [p.leadGender]
 * @param {string[]} [p.names]      noms à ne jamais écrire (référence, similaires, membres)
 * @param {object} [p.measured]     profil audio mesuré de la référence (quality/profile)
 */
export function buildAceCaption({ styleLock = {}, catalogGenres = [], duo = false, leadGender = null, names = [], measured = null } = {}) {
  const lock = styleLock || {};
  const catalog = uniq([...(catalogGenres || []), ...(Array.isArray(lock.catalogGenres) ? lock.catalogGenres : [])]);
  const genres = confirmedGenres({
    catalogGenres: catalog,
    lockGenres: [...(lock.genres || []), ...(lock.genreSummary ? [lock.genreSummary] : [])].slice(0, 6),
    listenedGenres: [],
  });
  const male = lock.duoVocals?.male || null;
  const female = lock.duoVocals?.female || null;
  const isDuo = Boolean(duo || (male && female));
  const voiceText = isDuo
    ? `${[male?.range, male?.texture, male?.delivery, male?.timbre].filter(Boolean).join(" ")}`
    : `${lock.timbre || ""} ${lock.vocalStyle || ""} ${lock.vocalRegister || ""}`;
  const femaleText = isDuo ? [female?.range, female?.texture, female?.delivery, female?.timbre].filter(Boolean).join(" ") : "";
  const leadVt = voiceTags(voiceText);
  const femVt = voiceTags(femaleText);
  const measuredRough = measured?.voice && Number.isFinite(measured.voice.maleHnr ?? measured.voice.hnr)
    ? (measured.voice.maleHnr ?? measured.voice.hnr) < 10.0 // net seulement (voix ACE propres : 10,4–15)
    : false;
  const rough = ROUGH_RX.test(voiceText) || measuredRough;
  const rockRef = catalog.some((g) => ROCK_RX.test(g));
  // « no guitars » : référence non rock ET (lane électronique / hip-hop au catalogue, ou voix rauque visée
  // — voix rauque + grosse batterie = ACE ajoute des guitares saturées). Pas pour la pop / chanson.
  const lockInstrText = (Array.isArray(lock.instruments) ? lock.instruments : []).join(" ");
  const noGuitars = !rockRef && !/guitar/i.test(lockInstrText.replace(/no guitars?/gi, "")) &&
    (catalog.some((g) => GUITARLESS_LANE_RX.test(g)) || ROUGH_RX.test(voiceText));
  const rap = !isDuo && (genres.some((g) => RAP_RX.test(g)) || catalog.some((g) => RAP_RX.test(g)));

  const tags = [];
  const lead = [];
  if (isDuo) lead.push("male and female vocal duet, both voices clearly audible");
  // genres (sans mots « nettoyants » si voix rauque visée)
  for (const g of genres) {
    if (rough && CLEANING_GENRE_RX.test(g)) continue;
    tags.push(g);
  }
  if (isDuo) {
    tags.push(voicePhrase("male", leadVt, "male vocal"));
    if (rough && !leadVt.grain.includes("distorted") && /shout|scream|distort|growl/i.test(voiceText)) tags.push("distorted shouted vocals");
    if (rough && !leadVt.grain.includes("gravelly") && /gravel|belt/i.test(voiceText)) tags.push("gravelly belting");
    tags.push(voicePhrase("female", femVt, "female vocal"));
  } else {
    const g = leadGender === "male" || leadGender === "female" ? leadGender : null;
    tags.push(voicePhrase(g, leadVt, g ? `${g} lead vocal` : "lead vocal"));
  }
  // instruments réels (sans guitares si référence non rock ; sans 808/trap si voix rauque)
  const instr = uniq(
    (Array.isArray(lock.instruments) ? lock.instruments : [])
      .map((x) => String(x || "").toLowerCase().replace(/\(.*?\)/g, "").trim())
      .map((x) => (rough ? x.replace(/\b808s?\b( bass)?/g, "deep sub bass").replace(/\btrap\b/g, "").trim() : x))
      .filter((x) => x && x.split(/\s+/).length <= 4)
      .filter((x) => !noGuitars || !/guitar/.test(x))
      .filter((x) => !(rough && CLEANING_GENRE_RX.test(x))),
  ).slice(0, 5);
  tags.push(...instr);
  if (noGuitars) tags.push("no guitars");
  const bpm = Number(lock.bpm);
  if (Number.isFinite(bpm) && bpm >= 60 && bpm <= 200) tags.push(`${Math.round(bpm)} BPM`);
  if (isDuo && /call|response|trade|altern/i.test(String(lock.duoVocals?.interaction || ""))) tags.push("call and response");
  const tail = rap ? "clear rapped lyrics, upfront vocal" : "clear sung lyrics, airy mix";
  const body = stripNames(uniq(tags.map((t) => String(t).trim()).filter(Boolean)).join(", "), [
    lock.matchedName,
    lock.query,
    ...(lock.influences || []),
    ...(lock.related || []),
    ...(lock.similarArtists || []),
    ...names,
  ]);
  let caption = [lead.join(""), body, tail].filter(Boolean).join(". ") + ".";
  if (caption.length > ACE_CAPTION_MAX) caption = caption.slice(0, ACE_CAPTION_MAX).replace(/,[^,]*$/, "") + ".";
  return { caption, rough, rockRef, noGuitars, genres, duo: isDuo };
}

/** Garde-fou appliqué à une caption proposée par le LLM : mêmes règles que buildAceCaption. */
export function sanitizeAceCaption(text, { names = [], rough = false, noGuitars = false, duo = false } = {}) {
  let t = stripNames(String(text || "").replace(/\s+/g, " "), names);
  // pas de prose : on coupe les phrases longues en tags
  t = t
    .split(/[.;]\s*/)
    .flatMap((s) => s.split(/,\s*/))
    .map((s) => s.trim())
    .filter((s) => s && s.split(/\s+/).length <= 8)
    .filter((s) => !(rough && CLEANING_GENRE_RX.test(s)))
    .filter((s) => !noGuitars || !/\bguitars?\b/i.test(s) || /^no guitars$/i.test(s))
    .join(", ");
  if (noGuitars && !/no guitars/i.test(t)) t += ", no guitars";
  if (duo && !/male and female vocal duet/i.test(t)) t = `male and female vocal duet, both voices clearly audible. ${t}`;
  return t.slice(0, ACE_CAPTION_MAX).replace(/^[,\s]+/, "");
}

/** Bloc de règles pour le prompt LLM (même contenu que les garde-fous). */
export function aceCaptionLlmRules({ duo = false, rough = false, noGuitars = false } = {}) {
  return [
    "Écris la caption ACE-Step en TAGS COURTS anglais séparés par des virgules (pas de phrases, ≤ 400 caractères).",
    "AUCUN nom d'artiste, de chanteur, de groupe ou de titre.",
    "Le grain de voix se dit avec des mots de VOIX (ex. raspy, gravelly, husky, distorted shouted vocals, breathy, smooth, clean).",
    rough ? "Voix RAUQUE visée : n'écris PAS trap, 808, dubstep, drill, autotune (ces mots nettoient la voix)." : "",
    noGuitars ? "La référence n'est pas rock (lane électronique / voix rauque) : ajoute « no guitars » et aucun instrument guitare." : "N'ajoute pas « no guitars » (inutile pour cette lane).",
    duo ? "Commence par « male and female vocal duet, both voices clearly audible »." : "",
    "Genres : seulement ceux confirmés par le catalogue fourni ; ne te fie jamais au seul tag d'écoute audio.",
    "Termine par le BPM (ex. « 90 BPM ») puis « clear sung lyrics » (ou « clear rapped lyrics » pour du rap).",
  ].filter(Boolean).join("\n");
}
