import { norm, uniqStrings, isLock } from "./util.js";
import { styleLockGenreBlob, isMetalLane } from "./genres.js";
import { artefactGuardsFromLock, metalBandInstruments } from "./metal.js";

/**
 * Plancher de qualité prod ACE — court (le plafond style ~700 tronque la fin).
 * Voix dry + air — évite vocoder / saturation. (Le lit band est ailleurs, en tête.)
 */
export function aceStepProductionQualityFloor({ duo = false } = {}) {
  return duo
    ? "dry clear vocals, light compression, natural dynamics, peak headroom, no clipping"
    : "dry clear lead vocal, light compression, natural dynamics, peak headroom, no clipping";
}

/**
 * Arc sectionnel COURT — changements d’INSTRUMENTS (pas seulement la batterie).
 * À placer TÔT dans le style (survit au plafond ~700).
 */
export function aceStepSectionDynamicsCompact({ duo = false } = {}) {
  const core =
    "NOT one flat loop: verse = guitar+bass+light drums → pre-chorus adds keys/pads → chorus = fuller band (extra guitar layers, bigger drums, pads, wider snare) → thinner bridge → biggest final chorus";
  if (duo) return `${core}; band lifts under the active tagged singer`;
  return core;
}

/**
 * Lit multi-instruments COURT — en tête du style (évite drums-only / boucle unique).
 */
export function aceStepBandBedCompact(lock = null, arrange = null) {
  const genre = norm(
    [
      lock?.genreSummary,
      ...(Array.isArray(lock?.genres) ? lock.genres : []),
      arrange?.leadInstrument,
      ...(Array.isArray(arrange?.features) ? arrange.features : []),
    ]
      .filter(Boolean)
      .join(" "),
  );
  const fromLock = Array.isArray(lock?.instruments)
    ? lock.instruments.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 5)
    : [];

  let band = fromLock;
  if (band.length < 3) {
    if (/trap|hip[\s-]?hop|drill|\brap\b|boom\s*bap|grime/.test(genre)) {
      band = ["808 bass", "trap drums", "hi-hats", "synth pads", "piano"];
    } else if (/r&?b|soul|gospel|neo[\s-]?soul|sister act|church/.test(genre)) {
      band = ["drum kit", "bass", "piano", "Hammond organ", "pads"];
    } else if (/electro|edm|\bdance\b|house|techno|hyperpop|synth/.test(genre)) {
      band = ["kick", "bass", "synth pads", "arpeggios", "lead synth"];
    } else if (/metal|hardcore|punk/.test(genre)) {
      band = metalBandInstruments().slice(0, 5);
    } else if (/indie|folk|acoustic|singer|americana|dream pop|chamber/.test(genre)) {
      band = ["acoustic guitar", "electric bass", "drum kit", "piano", "warm pads"];
    } else if (/rock|grunge/.test(genre)) {
      band = ["drum kit", "bass guitar", "rhythm guitars", "lead guitar", "cymbals"];
    } else if (/afro|dancehall|reggae|amapiano/.test(genre)) {
      band = ["drums", "bass", "guitar", "keys", "percussion"];
    } else if (/pop|radio|ballad/.test(genre)) {
      band = ["drums", "bass", "keys", "guitars", "pads"];
    } else {
      band = ["drums", "bass", "guitars", "keys", "pads"];
    }
  }

  const lead = String(arrange?.leadInstrument || "").trim();
  if (lead && !band.some((b) => b.toLowerCase().includes(lead.toLowerCase().slice(0, 8)))) {
    band = [lead, ...band].slice(0, 5);
  }

  return `full band always: ${band.join(", ")} — never drums-only, never single-instrument loop`;
}

/**
 * Consignes d’arc sectionnel (compactes pour le plafond ACE ~700–850 chars).
 * Verse réduit → chorus plus large → bridge contraste → final chorus max.
 */
export function aceStepSectionDynamicsLine({ duo = false } = {}) {
  const core =
    "section dynamics: lean verse → pre-chorus lift → thicker chorus (extra layers, wider snare) → contrasting bridge → biggest final chorus — never one flat loop";
  if (duo) {
    return `${core}; band lifts under the active tagged singer`;
  }
  return core;
}

/**
 * Bits courts pour SongGen / MiniMax (pas de pavés — LeVo les ignore).
 */
export function sectionDynamicsStyleTags() {
  return ["chorus lift", "section dynamics"];
}

/**
 * Fragment arrangement (SongGen custom / MiniMax quality).
 */
export function sectionDynamicsArrangeFragment() {
  return "section lifts: chorus thicker than verse, bridge contrasts, final chorus biggest — not one flat instrumental loop";
}

function artefactGuardsFromBlob(blob = "", lock = null) {
  const g = norm(blob);
  const voice = norm(lock?.vocalStyle || "");
  const harsh = /growl|guttural|scream|harsh/.test(voice || g);
  if (!harsh) return [];
  if (blobLooksIndustrial(g) || blobLooksIndustrial(voice)) return [];
  // Uniquement si growl metal : éviter le glitch vocal industriel non voulu
  return ["clean recorded vocals"];
}

/**
 * Style ACE-Step : DNA du lock en tête (tronqué), sans bible de genre.
 */
export function composeAceStepStyle(style = "", lock = null) {
  const raw = String(style || "pop, emotional, radio-ready").trim();
  const head = isLock(lock)
    ? uniqStrings(
        [lock.genreSummary, lock.vocalStyle, ...(Array.isArray(lock.sonicKeywords) ? lock.sonicKeywords : [])],
        6,
      )
    : [];
  const bans = isLock(lock)
    ? uniqStrings(
        [
          ...(Array.isArray(lock.doNot) ? lock.doNot.map((d) => `not ${d}`) : []),
          ...artefactGuardsFromLock(lock).map((d) => d.replace(/^no /, "not ")),
        ],
        6,
      )
    : [];
  const combined = [...head, raw, ...bans].filter(Boolean).join(". ");
  return (combined || raw).slice(0, 1000);
}

/**
 * Arrangement « hit commercial » pour ACE-Step (solo ou duo).
 * Priorité : multi-instruments + arcs dynamiques (pas de boucle linéaire drums-only).
 * Le genre choisit les instruments ; le polish reste le même pour tous.
 */
export function aceStepCommercialArrangementBits(lock = null, { duo = false } = {}) {
  const genre = norm(
    [lock?.genreSummary, ...(Array.isArray(lock?.genres) ? lock.genres : [])].filter(Boolean).join(" "),
  );
  const fromLock = Array.isArray(lock?.instruments)
    ? lock.instruments.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 6)
    : [];

  let band = fromLock;
  if (band.length < 3) {
    if (/trap|hip[\s-]?hop|drill|\brap\b|boom\s*bap|grime/.test(genre)) {
      band = ["808 bass", "trap drums", "hi-hats", "synth pads", "piano chords", "melodic hook"];
    } else if (/r&?b|soul|gospel|neo[\s-]?soul|sister act|church/.test(genre)) {
      band = ["drum kit", "bass", "Hammond organ", "piano", "handclaps", "gospel choir pads"];
    } else if (/electro|edm|\bdance\b|house|techno|hyperpop|synth/.test(genre)) {
      band = ["kick", "bass", "synth pads", "arpeggios", "risers", "lead synth"];
    } else if (/metal|hardcore|punk/.test(genre)) {
      band = metalBandInstruments().slice(0, 5);
    } else if (/rock|grunge|indie rock/.test(genre)) {
      band = ["drum kit", "bass guitar", "rhythm guitars", "lead guitar", "cymbals"];
    } else if (/afro|dancehall|reggae|amapiano/.test(genre)) {
      band = ["drums", "bass", "guitar skank", "keys", "percussion", "pads"];
    } else if (/pop|radio|ballad/.test(genre)) {
      band = ["drums", "bass", "keys", "guitars", "pads", "catchy melodic hook"];
    } else {
      band = ["drums", "bass", "keys or guitars", "pads", "percussion", "catchy melodic hook"];
    }
  }

  const prod = String(lock?.production || "").trim();
  const rhythm = String(lock?.rhythmFeel || "").trim();

  return [
    "streaming-ready commercial hit — Billboard / playlist quality (same bar for every genre)",
    `layered multi-instrument bed: ${band.join(", ")}`,
    "never drums-only, never sparse bed, never thin loop under vocals",
    aceStepSectionDynamicsLine({ duo }),
    rhythm ? `groove: ${rhythm}` : null,
    prod
      ? `production: ${prod}`
      : "wide stereo, controlled low-end, lead vocal prominent with air in the midrange, polished mix with peak headroom, no clipping",
    duo
      ? "duet vocals sit cleanly inside a full commercial band mix"
      : "lead vocal sits cleanly on top of a full commercial band mix, instruments leave space for the voice",
  ].filter(Boolean);
}

/** 1–2 bits band courts pour le style ACE (évite de saturer le plafond 700 chars). */
export function aceStepCommercialBandBits(lock = null) {
  const bits = aceStepCommercialArrangementBits(lock, { duo: false });
  // [0]=streaming, [1]=layered bed, [2]=never drums-only
  return [bits[1], bits[2]].filter(Boolean);
}
