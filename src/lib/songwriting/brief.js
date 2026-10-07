/**
 * Brief d’écriture par morceau : angle / point de vue / ton / ancrages concrets.
 * Objectif : qu’un même artiste ne réécrive pas toujours la même chanson.
 * - Pool d’angles (catégories de sujets) + anti-répétition sur l’historique.
 * - Mode actualité optionnel par artiste (jamais / parfois / souvent / auto).
 */

export const SONG_ANGLES = [
  { id: "objet", cat: "objet", text: "Partir d’un objet précis et banal (ticket de caisse, clé, vieux téléphone, veste prêtée…) et dérouler tout ce qu’il raconte." },
  { id: "portrait", cat: "portrait", text: "Portrait d’une AUTRE personne (voisin·e, collègue, oncle, inconnu·e du bus) — l’artiste observe, ne parle pas de lui/elle-même." },
  { id: "lettre", cat: "adresse", text: "Chanson-lettre adressée à quelqu’un de précis (un parent, un·e ancien·ne ami·e, soi à 15 ans, un propriétaire, un prof…)." },
  { id: "travail", cat: "travail", text: "Le travail / l’argent : un shift, une fin de mois, un chef, une envie de démission — détails matériels (horaires, prix, uniforme)." },
  { id: "lieu_heure", cat: "lieu", text: "Un lieu précis à une heure précise (laverie à 7h, parking de supermarché le dimanche, quai de RER, station-service) — la chanson est une scène." },
  { id: "enfance", cat: "memoire", text: "Un souvenir d’enfance ultra-précis (une odeur, un goûter, un jeu, la voiture familiale) qui éclaire le présent." },
  { id: "humour", cat: "humour", text: "Autodérision / humour : une situation un peu ridicule assumée (rendez-vous raté, s’être perdu, plat brûlé) — drôle sans être parodique." },
  { id: "dispute", cat: "conflit", text: "Une dispute banale (vaisselle, retard, message « vu ») qui révèle quelque chose de plus grand, avec des répliques de dialogue." },
  { id: "amitie", cat: "amitie", text: "L’amitié : une bande, un pote perdu de vue, une loyauté mise à l’épreuve — PAS d’amour romantique." },
  { id: "famille", cat: "famille", text: "La famille : un repas, un héritage, un frère ou une sœur, des non-dits — scène concrète." },
  { id: "ambition", cat: "ambition", text: "Ambition et doute : une audition, un refus, un premier succès bizarre — chiffres, lieux, noms de choses." },
  { id: "lendemain", cat: "fete", text: "La fête vue du lendemain matin : ce qui reste (verres, messages envoyés, quelqu’un sur le canapé)." },
  { id: "ecrans", cat: "tech", text: "Écrans / réseaux : notifications, stories, un algorithme, une appli de rencontre — ironique ou tendre." },
  { id: "route", cat: "voyage", text: "Voyage ou exil : un trajet précis (bus de nuit, aire d’autoroute, retour au pays, valise), avec des noms de lieux." },
  { id: "corps", cat: "corps", text: "Le corps : fatigue, sport, maladie d’un proche, vieillir, un tatouage — sensations physiques précises." },
  { id: "saison", cat: "nature", text: "Une saison ou une météo vécue concrètement (canicule dans un studio, première neige au boulot) — pas de métaphore cosmique." },
  { id: "personnage", cat: "fiction", text: "Fiction : l’histoire d’un personnage inventé (métier, prénom, ville) à la 3e personne, avec un retournement." },
  { id: "rituel", cat: "quotidien", text: "Un rituel du quotidien (café du matin, trajet, courses du samedi) qui devient le refrain." },
  { id: "amour_oblique", cat: "amour", text: "L’amour par un angle inattendu (l’inventaire après une rupture, la routine heureuse, un crush au travail, une séparation polie)." },
  { id: "quartier", cat: "societe", text: "Observation sociale à hauteur d’humain : le quartier qui change, les loyers, une file d’attente administrative — pas de slogan." },
  { id: "fierte", cat: "fierte", text: "Fierté / egotrip crédible et spécifique (ce que l’artiste a réellement construit, d’où il/elle vient) — pas de clichés de richesse." },
  { id: "lieu_disparu", cat: "memoire", text: "Un lieu disparu (une boîte fermée, l’appart d’avant, un terrain vague bétonné) et ce qu’il emporte avec lui." },
];

export const SONG_POVS = [
  "je — confession directe",
  "tu — adressé à une personne précise",
  "il/elle — narration extérieure",
  "nous — une bande, un couple ou une génération",
  "dialogue — deux voix / répliques rapportées",
];

export const SONG_TONES = [
  "tendre",
  "ironique",
  "rageur",
  "pince-sans-rire",
  "euphorique",
  "mélancolique mais lucide",
  "joueur",
  "solennel",
];

export const CONCRETE_ANCHORS = [
  "un prénom",
  "un lieu nommé (rue, quartier, ville, commerce)",
  "une heure ou une date",
  "un objet du quotidien très précis",
  "un chiffre (prix, distance, âge, étage)",
  "un son ou une odeur",
  "une phrase entendue, citée telle quelle",
  "un geste physique",
];

export const NEWS_MODES = ["auto", "never", "sometimes", "often"];

const NEWS_PROBABILITY = { never: 0, sometimes: 0.25, often: 0.6 };

/** Lanes où l’actu est naturelle si l’artiste n’a rien réglé (mode « auto »). */
const ENGAGED_LANE_RE =
  /\b(rap|hip[\s-]?hop|drill|grime|chanson|punk|reggae|ska|folk|protest|slam|conscious|zouk|afro|rock)\b/i;

export function normalizeNewsMode(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (["jamais", "never", "off", "0", "non"].includes(v)) return "never";
  if (["parfois", "sometimes", "rarement"].includes(v)) return "sometimes";
  if (["souvent", "often", "toujours"].includes(v)) return "often";
  return "auto";
}

/** Probabilité qu’un nouveau titre parte d’une actu (0–1). */
export function newsProbability(artist = {}) {
  const mode = normalizeNewsMode(artist?.newsMode);
  if (mode !== "auto") return NEWS_PROBABILITY[mode];
  const blob = [artist?.genre, ...(Array.isArray(artist?.genres) ? artist.genres : [])]
    .filter(Boolean)
    .join(" ");
  return ENGAGED_LANE_RE.test(blob) ? 0.15 : 0;
}

export function shouldUseNews(artist, rng = Math.random) {
  const p = newsProbability(artist);
  return p > 0 && rng() < p;
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length) % list.length];
}

function pickN(list, n, rng) {
  const pool = [...list];
  const out = [];
  while (pool.length && out.length < n) {
    out.push(pool.splice(Math.floor(rng() * pool.length) % pool.length, 1)[0]);
  }
  return out;
}

function splitTopics(raw) {
  if (Array.isArray(raw)) return raw.map((s) => String(s || "").trim()).filter(Boolean);
  return String(raw || "")
    .split(/[\n,;·|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Choisit un brief pour UN titre.
 * @param {object} opts
 * @param {object} [opts.artist] profil (favoriteTopics, avoidTopics, newsMode…)
 * @param {{ category?: string, angleId?: string, pov?: string, tone?: string }[]} [opts.recent] derniers titres (le plus récent d’abord)
 * @param {string[]} [opts.excludeCategories] catégories déjà prises (ex. autres pistes de l’album)
 * @param {object|null} [opts.news] actu choisie (titre/résumé) si mode actu
 * @param {() => number} [opts.rng]
 */
export function pickSongBrief({
  artist = {},
  recent = [],
  excludeCategories = [],
  news = null,
  rng = Math.random,
} = {}) {
  const recentCats = recent.slice(0, 6).map((r) => r?.category).filter(Boolean);
  const blocked = new Set([...recentCats, ...excludeCategories]);
  let pool = SONG_ANGLES.filter((a) => !blocked.has(a.cat));
  if (pool.length < 4) pool = SONG_ANGLES.filter((a) => !recentCats.slice(0, 3).includes(a.cat));
  if (!pool.length) pool = SONG_ANGLES;

  const favorite = splitTopics(artist?.favoriteTopics);
  const useFavorite = !news && favorite.length > 0 && rng() < 0.35;

  const angle = pick(pool, rng);
  const recentPovs = recent.slice(0, 2).map((r) => r?.pov).filter(Boolean);
  const recentTones = recent.slice(0, 2).map((r) => r?.tone).filter(Boolean);
  const povPool = SONG_POVS.filter((p) => !recentPovs.includes(p));
  const tonePool = SONG_TONES.filter((t) => !recentTones.includes(t));

  const brief = {
    angleId: news ? "actu" : useFavorite ? "favori" : angle.id,
    category: news ? "actu" : useFavorite ? "favori" : angle.cat,
    angle: news
      ? "Partir d’un fait d’actualité récent (ci-dessous) et le raconter à hauteur d’humain : une scène vécue par une personne ordinaire, pas un éditorial."
      : useFavorite
        ? `Sujet de prédilection de l’artiste : « ${pick(favorite, rng)} » — mais traité par une scène concrète et un angle neuf.`
        : angle.text,
    pov: pick(povPool.length ? povPool : SONG_POVS, rng),
    tone: pick(tonePool.length ? tonePool : SONG_TONES, rng),
    anchors: pickN(CONCRETE_ANCHORS, 3, rng),
  };
  if (news) brief.news = news;
  return brief;
}

/** Première ligne chantée après le premier tag hook (Chorus / Hook / Drop / Refrain). */
export function extractHookLine(text) {
  const lines = String(text || "").split(/\r?\n/);
  let inHook = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const tag = line.match(/^\[([^\]]+)\]/);
    if (tag) {
      inHook = /\b(chorus|hook|drop|refrain)\b/i.test(tag[1]);
      continue;
    }
    if (inHook) return line.replace(/^\(|\)$/g, "").slice(0, 120);
  }
  return "";
}

/** Bloc prompt « déjà écrit par cet artiste — ne pas refaire ». */
export function buildAntiRepeatBlock(history = [], { label = "TITRES RÉCENTS DE L’ARTISTE" } = {}) {
  const items = (Array.isArray(history) ? history : [])
    .filter((h) => h && (h.title || h.theme || h.hook))
    .slice(0, 12);
  if (!items.length) return "";
  const lines = items.map((h) => {
    const bits = [
      h.title ? `« ${String(h.title).slice(0, 70)} »` : "",
      h.theme ? `thème: ${String(h.theme).slice(0, 110)}` : "",
      h.hook ? `hook: « ${String(h.hook).slice(0, 90)} »` : "",
      h.newsRef ? `actu déjà traitée: ${String(h.newsRef).slice(0, 100)}` : "",
    ].filter(Boolean);
    return `- ${bits.join(" · ")}`;
  });
  return `${label} (NE PAS refaire : ni le même sujet, ni la même situation, ni les mêmes images, ni un hook proche, ni un titre ressemblant) :
${lines.join("\n")}`;
}

/** Bloc prompt du brief choisi. */
export function buildBriefBlock(brief) {
  if (!brief) return "";
  const lines = [
    "BRIEF DE CE MORCEAU (imposé — c’est LUI qui définit le sujet, pas la bio) :",
    `- Angle: ${brief.angle} (exemples entre parenthèses = indicatifs : invente les tiens)`,
    `- Point de vue: ${brief.pov}`,
    `- Ton du texte: ${brief.tone} (le mood sonore de l’artiste reste, mais le texte peut contraster)`,
    `- Ancrages concrets OBLIGATOIRES (au moins 3 au total dans le texte, inventés et précis): ${(brief.anchors || []).join(" ; ")}`,
  ];
  if (brief.news) {
    const cands = Array.isArray(brief.news.candidates)
      ? brief.news.candidates
      : brief.news.title
        ? [brief.news]
        : [];
    if (cands.length) {
      lines.push(
        "- Actu de départ: choisis UNE seule de ces actus récentes, celle qui colle le mieux à l’univers de l’artiste (si aucune ne colle, garde l’esprit « chronique du quotidien d’aujourd’hui » sans actu précise) :",
        ...cands.slice(0, 8).map((n, i) => `  ${i + 1}. « ${String(n.title || "").slice(0, 200)} »${n.source ? ` (${n.source})` : ""}`),
        "- Garde-fous actu: AUCUN nom de personne réelle (politiques, célébrités, victimes, accusés) ; aucune accusation ni fait inventé présenté comme vrai ; pas de récit d’un drame réel avec victimes ; pas de marque ; pas de slogan partisan. Transforme l’actu en vécu universel (le prix du plein, une manif vue du balcon, une file d’attente…). Le titre ne cite pas l’actu littéralement.",
        "- Renseigne \"newsRef\" dans le JSON avec l’actu choisie (texte court) ou \"\" si aucune.",
      );
    }
  }
  return lines.join("\n");
}
