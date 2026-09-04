import { norm } from "./util.js";
import { styleLockGenreBlob, isMetalLane, coalesceGenres } from "./genres.js";

/**
 * Presets de forme paroles (tags MiniMax/ACE anglais).
 * Variés par lane — pas toujours le même arc radio.
 */
export const LYRICS_FORM_PRESETS = {
  radio_pop: {
    id: "radio_pop",
    label: "Radio / pop",
    tagsArc:
      "[Intro], [Verse], [Pre-Chorus], [Chorus], [Verse], [Pre-Chorus], [Chorus], [Bridge], [Chorus], [Outro]",
    requiredTags: ["Intro", "Verse", "Pre-Chorus", "Chorus", "Bridge", "Outro"],
    hookTag: "Chorus",
    requireDistinctVerses: true,
    craftNotes:
      "Hit radio: Pre-Chorus monte la tension; Chorus porte le hook mémorable; Bridge contraste (nouveau angle, pas un 3e verse); dernier Chorus plus large (ad-libs OK).",
  },
  rap_trap: {
    id: "rap_trap",
    label: "Rap / trap",
    tagsArc: "[Intro], [Verse], [Hook], [Verse], [Hook], [Bridge], [Hook], [Outro]",
    requiredTags: ["Intro", "Verse", "Hook", "Outro"],
    hookTag: "Hook",
    requireDistinctVerses: true,
    craftNotes:
      "Rap/trap: Verses denses (punchlines, flux); Hook COURT et collant (2–4 lignes); Bridge optionnel mais utile pour casser le rythme; pas de Pre-Chorus long.",
  },
  edm: {
    id: "edm",
    label: "EDM / dance",
    tagsArc: "[Intro], [Build], [Drop], [Break], [Build], [Drop], [Outro]",
    requiredTags: ["Intro", "Build", "Drop", "Outro"],
    hookTag: "Drop",
    requireDistinctVerses: false,
    craftNotes:
      "EDM: peu de paroles hors Drop/Hook; Build = tension (phrases courtes / counts); Drop = hook chanté ou cris mélodiques; Break = respiration; éviter un récit linéaire couplet/refrain.",
  },
  ballad: {
    id: "ballad",
    label: "Ballade",
    tagsArc: "[Intro], [Verse], [Chorus], [Verse], [Chorus], [Bridge], [Chorus], [Outro]",
    requiredTags: ["Intro", "Verse", "Chorus", "Bridge", "Outro"],
    hookTag: "Chorus",
    requireDistinctVerses: true,
    craftNotes:
      "Ballade: pas de Pre-Chorus forcé; Verses narratifs et intimes; Chorus émotionnel avec hook simple; Bridge = pivot émotionnel; densités plus aérées (lignes plus longues OK).",
  },
  metal: {
    id: "metal",
    label: "Metal",
    tagsArc: "[Intro], [Verse], [Chorus], [Verse], [Chorus], [Breakdown], [Chorus], [Outro]",
    requiredTags: ["Intro", "Verse", "Chorus", "Breakdown", "Outro"],
    hookTag: "Chorus",
    requireDistinctVerses: true,
    craftNotes:
      "Metal: Chorus accrocheur; Breakdown = contraste rythmique / slogans courts (pas un 3e verse); Verses distincts (images, tension); Outro peut reprendre un motif du Chorus.",
  },
  indie_alt: {
    id: "indie_alt",
    label: "Indie / alt",
    tagsArc: "[Intro], [Verse], [Chorus], [Verse], [Chorus], [Bridge], [Outro]",
    requiredTags: ["Intro", "Verse", "Chorus", "Bridge", "Outro"],
    hookTag: "Chorus",
    requireDistinctVerses: true,
    craftNotes:
      "Indie/alt: Chorus moins « radio » (plus d’atmosphère); Bridge contrasté; forme un peu plus libre mais garder Intro/Verses distincts/Chorus/Bridge/Outro; éviter le Pre-Chorus mécanique.",
  },
};

/** Alias historique = arc radio pop (compat duo / ACE). */
export const ACE_COMMERCIAL_LYRICS_STRUCTURE = LYRICS_FORM_PRESETS.radio_pop.tagsArc;

export function getLyricsFormPreset(idOrPreset) {
  if (idOrPreset && typeof idOrPreset === "object" && idOrPreset.tagsArc) return idOrPreset;
  const id = String(idOrPreset || "").trim();
  return LYRICS_FORM_PRESETS[id] || LYRICS_FORM_PRESETS.radio_pop;
}

/**
 * Choisit une forme paroles selon le DNA genre (lock + artiste).
 * Priorité: rap → edm → ballad → metal → indie → radio_pop.
 */
export function detectLyricsForm(lock = null, artist = null) {
  const blob = norm(
    styleLockGenreBlob(lock, [
      artist?.genre,
      ...(Array.isArray(artist?.genres) ? artist.genres : []),
      artist?.mood,
      lock?.writingStyle,
    ]),
  );

  if (/\b(hip[\s-]?hop|trap|drill|\brap\b|boom\s*bap|grime|afro[\s-]?trap)\b/.test(blob)) {
    return LYRICS_FORM_PRESETS.rap_trap;
  }
  if (/\b(edm|house|techno|hyperpop|trance|dubstep|drum\s*and\s*bass|dnb)\b/.test(blob) || /\bdance\b/.test(blob)) {
    // dancehall / afro-dance restent hors EDM pur si déjà captés ailleurs
    if (!/\bdancehall\b/.test(blob)) return LYRICS_FORM_PRESETS.edm;
  }
  if (/\b(ballad|acoustic|soft\s*rock|lullaby|piano\s*ballad|power\s*ballad)\b/.test(blob)) {
    return LYRICS_FORM_PRESETS.ballad;
  }
  if (isMetalLane(blob)) {
    return LYRICS_FORM_PRESETS.metal;
  }
  if (/\b(indie|alternative|alt[\s-]?rock|shoegaze|post[\s-]?punk|dream\s*pop)\b/.test(blob)) {
    return LYRICS_FORM_PRESETS.indie_alt;
  }
  return LYRICS_FORM_PRESETS.radio_pop;
}

/** Brief songwriter commun + notes du preset (injecté dans runLyrics). */
export function buildLyricsCraftBrief(form) {
  const preset = getLyricsFormPreset(form);
  const hook = preset.hookTag || "Chorus";
  return `
CRAFT SONGWRITER (titre réel de prod, pas une litanie linéaire) :
- Forme imposée « ${preset.id} » (${preset.label}) — suis EXACTEMENT cet arc de tags: ${preset.tagsArc}
- Hook: 1 ligne ultra-mémorable, répétée / paraphrasée dans chaque [${hook}]
- Rôles: Intro = ambiance (peu ou pas de récit); sections narratives = storytelling; [${hook}] = émotion + hook; section contraste (Bridge / Breakdown / Break) = NOUVEL angle, pas un verse copié; Outro = résolution
- Densités indicatives: Verse/Build 4–8 lignes; ${hook} 2–4; Bridge/Breakdown/Break 2–4; Intro/Outro 0–3
- Les sections narratives répétées (2+ [Verse] ou 2+ [Build]) DOIVENT différer (pas de copier-coller)
- Interdit: même rythme de phrase partout, structure hors preset, tags FR (utilise les tags EN du preset)
- Notes lane: ${preset.craftNotes}
`.trim();
}

/**
 * Ne réécrit pas le DNA : coalesce les genres catalogue (Rock + Death Metal → Death Metal).
 */
export function withKnownArtistLane(lock) {
  if (!lock || typeof lock !== "object") return lock;
  const genres = coalesceGenres(lock.genres);
  return { ...lock, genres };
}
