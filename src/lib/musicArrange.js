/** Réglages d’arrangement SongGen (projet) — défauts prudents = mix complet. */

import { artefactGuardsFromLock, isMetalLane, metalBandInstruments, styleLockGenreBlob } from "./musicLane.js";

export const LEAD_INSTRUMENTS = [
  { id: "", label: "Auto (style artiste)" },
  { id: "piano", label: "Piano" },
  { id: "electric guitar", label: "Guitare élec" },
  { id: "acoustic guitar", label: "Guitare acoustique" },
  { id: "organ", label: "Orgue" },
  { id: "synth lead", label: "Synth lead" },
  { id: "808 bass", label: "808 / basse" },
  { id: "strings", label: "Cordes" },
  { id: "brass section", label: "Cuivres" },
  { id: "saxophone", label: "Saxophone" },
  { id: "trumpet", label: "Trompette" },
];

export const CHOIR_OPTIONS = [
  { id: "none", label: "Pas de chœur", en: "" },
  {
    id: "harmonies",
    label: "Harmonies backing",
    en: "soft layered backing vocal harmonies behind the lead throughout",
  },
  {
    id: "gospel",
    label: "Chœur gospel",
    en: "Sister Act style gospel: joyful church choir SATB with clear lead singer, call-and-response, Hammond organ, piano, handclaps — never drums-only",
  },
  {
    id: "stacked",
    label: "Doubles empilés",
    en: "stacked vocal doubles and ad-libs around the lead",
  },
  {
    id: "pads",
    label: "Pads chorale",
    en: "ethereal choir pads supporting the lead in the background",
  },
];

export const DRUM_OPTIONS = [
  { id: "", label: "Auto" },
  { id: "live kit", label: "Batterie live" },
  { id: "trap 808s", label: "Trap 808" },
  { id: "boom bap", label: "Boom-bap" },
  { id: "four-on-floor", label: "Four-on-floor" },
  { id: "brush jazz", label: "Jazz brushes" },
  { id: "latin percussion", label: "Percus latines" },
];

export const DENSITY_OPTIONS = [
  { id: "sparse", label: "Épuré" },
  { id: "mid", label: "Équilibré" },
  { id: "dense", label: "Dense / maximaliste" },
];

/** Tags optionnels (multi). */
export const FEATURE_TAGS = [
  { id: "gospel choir", label: "Chœur gospel" },
  { id: "call and response", label: "Call & response" },
  { id: "brass stabs", label: "Cuivres stabs" },
  { id: "string swell", label: "Montée de cordes" },
  { id: "organ pads", label: "Orgue pads" },
  { id: "fingerpicked guitar", label: "Guitare fingerpick" },
  { id: "sidechain pump", label: "Sidechain" },
  { id: "live audience energy", label: "Énergie live" },
  { id: "spoken intro", label: "Intro parlée" },
  { id: "breakdown drop", label: "Breakdown / drop" },
];

export function emptyMusicArrange() {
  return {
    leadInstrument: "",
    choir: "none",
    drums: "",
    density: "mid",
    bpm: null,
    features: [],
    notes: "",
  };
}

/** True si l’utilisateur n’a rien personnalisé (valeurs par défaut). */
export function isDefaultMusicArrange(raw) {
  const a = normalizeMusicArrange(raw);
  const d = emptyMusicArrange();
  return (
    a.leadInstrument === d.leadInstrument &&
    a.choir === d.choir &&
    a.drums === d.drums &&
    a.density === d.density &&
    a.bpm == null &&
    a.features.length === 0 &&
    !a.notes
  );
}

/**
 * Déduit un arrangement depuis le styleLock (artiste / titre de référence).
 * Priorité DNA titre (instruments, BPM, groove, chœur…).
 */
export function musicArrangeFromStyleLock(styleLock) {
  const lock = styleLock && typeof styleLock === "object" ? styleLock : null;
  if (!lock) return emptyMusicArrange();

  const bits = [
    ...(Array.isArray(lock.instruments) ? lock.instruments : []),
    ...(Array.isArray(lock.sonicKeywords) ? lock.sonicKeywords : []),
    ...(Array.isArray(lock.genres) ? lock.genres : []),
    lock.production,
    lock.rhythmFeel,
    lock.tempoFeel,
    lock.genreSummary,
    lock.mood,
    lock.energy,
    lock.musicPrompt,
    lock.vocalStyle,
    lock.matchedName,
    lock.seedTrack?.title,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const metal = isMetalLane(bits) || isMetalLane(styleLockGenreBlob(lock));

  let choir = "none";
  if (metal) {
    choir = "none";
  } else if (/gospel|church choir|satb|call and response|call-and-response/.test(bits)) {
    choir = "gospel";
  } else if (/choir pad|ethereal choir|ambient choir|atmospheric (vocal|pad)/.test(bits)) {
    choir = "pads";
  } else if (/backing vocal|vocal harmon|harmonies|bgv/.test(bits)) {
    choir = "harmonies";
  } else if (/stacked|vocal double|ad-?libs|ad libs/.test(bits)) {
    choir = "stacked";
  } else if (/\bchoir\b|\bchoeur\b/.test(bits)) {
    choir = "harmonies";
  } else if (/ambient|atmospheric|ethereal|dream pop|shoegaze/.test(bits)) {
    // Pads doux plutôt que « pas de chœur » pour l’indie ambient
    choir = "pads";
  }

  const isElectronicLane =
    /electro|synth|indie electronic|electronic pop|ambient|hyperpop|edm|\bdance\b|dream pop/.test(
      bits,
    );

  let leadInstrument = "";
  if (metal) {
    leadInstrument = "electric guitar";
  } else {
  const leadRules = [
    { re: /\borgan\b|church organ|hammond/, id: "organ" },
    { re: /synth lead|lead synth|arvo|synth pad|analog synth/, id: "synth lead" },
    { re: /\bpiano\b|keys\b|rhodes|wurlitzer/, id: "piano" },
    // Acoustique seulement si vraiment mis en avant (pas juste « organic textures »)
    { re: /acoustic guitar|fingerpick|nylon|fingerstyle/, id: "acoustic guitar" },
    { re: /electric guitar|distorted guitar|guitar riff/, id: "electric guitar" },
    { re: /\bguitar\b/, id: isElectronicLane ? "synth lead" : "electric guitar" },
    { re: /808 bass|\b808\b|sub bass/, id: "808 bass" },
    { re: /\bstrings\b|string section|orchestral/, id: "strings" },
    { re: /brass section|horn section/, id: "brass section" },
    { re: /\bsaxophone\b|\bsax\b/, id: "saxophone" },
    { re: /\btrumpet\b/, id: "trumpet" },
  ];
  for (const { re, id } of leadRules) {
    if (re.test(bits)) {
      leadInstrument = id;
      break;
    }
  }
  // Indie electronic + « organic » sans lead clair → synth + textures, pas guitare seule
  if (!leadInstrument && isElectronicLane) {
    leadInstrument = "synth lead";
  }
  }

  let drums = "";
  if (metal) {
    drums = "live kit";
  } else {
  const drumRules = [
    { re: /trap|808s|hi-?hat roll/, id: "trap 808s" },
    { re: /boom[\s-]?bap|boom bap/, id: "boom bap" },
    { re: /four[\s-]?on[\s-]?floor|4 on the floor|house beat|disco/, id: "four-on-floor" },
    { re: /brush|jazz kit|brushed/, id: "brush jazz" },
    { re: /latin perc|conga|bongo|timbale|afrobeats perc/, id: "latin percussion" },
    { re: /live kit|live drum|acoustic drum|rock drum|indie drum/, id: "live kit" },
    { re: /programmed drum|electronic drum|soft beat|subtle (electronic )?drum|drum machine/, id: "live kit" },
    { re: /\bdrums?\b|\bkit\b/, id: "live kit" },
  ];
  for (const { re, id } of drumRules) {
    if (re.test(bits) || (lock.rhythmFeel && re.test(String(lock.rhythmFeel).toLowerCase()))) {
      drums = id;
      break;
    }
  }
  // Electronic lane sans groove explicite → kit léger (évite lit vide « Auto »)
  if (!drums && isElectronicLane) {
    drums = "live kit";
  }
  }

  // Densité : « intimate » ≠ mix vide. Sparse explicite OK, sauf lane electronic (pads + groove).
  // En pratique LeVo + sparse = 1 instrument → on refuse sparse sauf demande ultra-claire.
  const explicitlySparse =
    /\bsparse\b|\bminimal(ist)?\b|\bstripped\b|\bstrip(ped)?[\s-]?back\b/.test(bits) ||
    /sparse and intimate|sparse production|minimal production/.test(bits);
  const explicitlyDense =
    /dense|maximal|wall of sound|layered|full band|lush|thick|maximalist/.test(bits);

  let density = "mid";
  if (metal || lock.energy === "high" || explicitlyDense || isElectronicLane) {
    density = "dense";
  } else if (explicitlySparse && !isElectronicLane && lock.energy === "low") {
    density = "mid"; // plus de sparse → lit mono chez SongGen
  } else if (lock.energy === "low") {
    density = "mid";
  }

  const features = [];
  const pushFeat = (id) => {
    if (!features.includes(id) && FEATURE_TAGS.some((f) => f.id === id)) features.push(id);
  };
  for (const f of FEATURE_TAGS) {
    const id = f.id.toLowerCase();
    if (bits.includes(id)) {
      if (metal && (f.id === "organ pads" || f.id === "gospel choir" || f.id === "fingerpicked guitar"))
        continue;
      pushFeat(f.id);
      continue;
    }
    if (f.id === "gospel choir" && /gospel/.test(bits)) pushFeat(f.id);
    else if (f.id === "call and response" && /call.?and.?response/.test(bits)) pushFeat(f.id);
    else if (f.id === "brass stabs" && /brass|horn stab/.test(bits)) pushFeat(f.id);
    else if (f.id === "string swell" && /string swell|string rise|strings/.test(bits))
      pushFeat(f.id);
    else if (f.id === "organ pads" && !metal && /organ pad|pad organ|ambient|atmospheric|synth pad/.test(bits))
      pushFeat(f.id);
    else if (
      f.id === "fingerpicked guitar" &&
      (/fingerpick|fingerstyle/.test(bits) ||
        (leadInstrument === "acoustic guitar" && /organic|acoustic/.test(bits)))
    ) {
      pushFeat(f.id);
    } else if (f.id === "sidechain pump" && /sidechain/.test(bits)) pushFeat(f.id);
  }
  if (isElectronicLane && !metal) {
    pushFeat("organ pads");
    if (/organic|acoustic|finger/.test(bits)) pushFeat("fingerpicked guitar");
  }

  const bpmNum = Number(lock.bpm);
  const bpm =
    Number.isFinite(bpmNum) && bpmNum >= 60 && bpmNum <= 200 ? Math.round(bpmNum) : null;

  const seed = lock.seedTrack;
  const notes = seed?.title
    ? `Réf. « ${seed.title} »${seed.artistName ? ` — ${seed.artistName}` : ""}`
    : lock.matchedName
      ? `Réf. artiste ${lock.matchedName}`
      : "";

  return normalizeMusicArrange({
    leadInstrument,
    choir,
    drums,
    density,
    bpm,
    features: features.slice(0, 6),
    notes,
    source: "ref",
  });
}

export function normalizeMusicArrange(raw) {
  const base = emptyMusicArrange();
  if (!raw || typeof raw !== "object") return base;
  const choirIds = new Set(CHOIR_OPTIONS.map((c) => c.id));
  const densityIds = new Set(DENSITY_OPTIONS.map((d) => d.id));
  const featureIds = new Set(FEATURE_TAGS.map((f) => f.id));
  const bpmNum = Number(raw.bpm);
  const source = raw.source === "manual" || raw.source === "ref" ? raw.source : null;
  return {
    leadInstrument: String(raw.leadInstrument || "").trim().slice(0, 60),
    choir: choirIds.has(raw.choir) ? raw.choir : "none",
    drums: String(raw.drums || "").trim().slice(0, 40),
    density: densityIds.has(raw.density) ? raw.density : "mid",
    bpm:
      Number.isFinite(bpmNum) && bpmNum >= 60 && bpmNum <= 200 ? Math.round(bpmNum) : null,
    features: (Array.isArray(raw.features) ? raw.features : [])
      .map((f) => String(f || "").trim())
      .filter((f) => featureIds.has(f))
      .slice(0, 8),
    notes: String(raw.notes || "").trim().slice(0, 240),
    source,
  };
}

function looksLikeDrums(tag = "") {
  return /\b(drum|drums|kit|808|trap|perc|beat|hi-?hat|snare)\b/i.test(String(tag));
}

/** Complète une liste d’instruments pour éviter les sorties « 1 piste seule ». */
function ensureFullBandInstruments(bits, { gospel = false, metal = false } = {}) {
  const list = [...bits].filter(Boolean);
  const has = (re) => list.some((t) => re.test(String(t)));
  const add = (tag) => {
    if (!list.some((t) => String(t).toLowerCase() === tag.toLowerCase())) list.push(tag);
  };

  if (gospel) {
    add("gospel choir");
    add("church organ");
    add("piano");
    add("bass");
    add("drums");
  } else if (metal) {
    for (const tag of metalBandInstruments()) add(tag);
  } else {
    // Toujours une section rythmique + harmonique + mélodie
    if (!has(/\bbass|808\b/i)) add("bass");
    if (!has(/\bpiano|keys|organ|synth\b/i)) add("piano");
    if (!has(/\bguitar|strings|brass|sax|trumpet\b/i)) add("electric guitar");
    if (!has(/\bdrum|kit|perc|808|trap\b/i)) add("drums");
    if (!has(/\bsynth|pad\b/i)) add("synths");
  }

  return list.slice(0, 8);
}

/**
 * Convertit les réglages UX en champs SongGen (instruments + fragments custom_style).
 * Priorité : chœur / lead utilisateur > style lock (sauf si chœur gospel → on filtre le biais batterie).
 */
export function musicArrangeToSongGen(arrange, { styleLockInstruments, styleLock } = {}) {
  const a = normalizeMusicArrange(arrange);
  const metal = isMetalLane(styleLockGenreBlob(styleLock, [a.notes, a.leadInstrument]));
  const parts = [];
  const instrumentBits = [];
  const wantsChoir = !metal && a.choir && a.choir !== "none";
  const gospel = !metal && a.choir === "gospel";

  const choir = CHOIR_OPTIONS.find((c) => c.id === a.choir);
  // Chœur EN TÊTE — sinon SongGen / LeVo ignore le hint noyé derrière « drums »
  if (!metal && choir?.en) {
    parts.push(choir.en);
    if (gospel) {
      instrumentBits.push("gospel choir", "church organ", "piano");
      parts.push("prominent gospel choir and organ, balanced rhythm section underneath");
    } else if (a.choir === "harmonies" || a.choir === "stacked") {
      instrumentBits.push("backing vocals");
    } else if (a.choir === "pads") {
      instrumentBits.push("choir pads");
    }
  }

  if (a.leadInstrument) {
    instrumentBits.unshift(`lead ${a.leadInstrument}`);
    parts.push(`prominent lead ${a.leadInstrument}`);
  }

  // Style-lock : couleur, sans monopoliser (surtout batteries)
  if (Array.isArray(styleLockInstruments) && styleLockInstruments.length) {
    const lockTags = styleLockInstruments.filter(Boolean).slice(0, 4);
    for (const tag of lockTags) {
      if (wantsChoir && looksLikeDrums(tag)) continue;
      if (metal && /\b(piano|keys|synth|pad|organ|choir)\b/i.test(tag)) continue;
      if (!instrumentBits.includes(tag)) instrumentBits.push(tag);
    }
  }

  if (a.drums) {
    instrumentBits.push(a.drums);
    parts.push(
      gospel
        ? `${a.drums} supporting the choir, not dominating`
        : `${a.drums} drums`,
    );
  }

  // Densité : gospel → densifier un peu pour forcer les couches vocales
  const density = a.density === "sparse" ? "mid" : gospel && a.density === "mid" ? "dense" : a.density;
  if (density === "sparse") {
    parts.push(
      "intimate arrangement with space, still full band: bass, soft drums, pads and lead — never thin or single-instrument",
    );
  } else if (metal) {
    parts.push(styleLock?.rhythmFeel || styleLock?.production || "dense distorted guitars, live drums");
  } else if (density === "dense") {
    parts.push(
      gospel
        ? "dense layered gospel production, thick choir stacks, organ and keys"
        : "dense maximalist production, rich layers, full band",
    );
  } else {
    parts.push("balanced full-band mix with clear lead vocal and multiple instruments");
  }

  for (const f of a.features) {
    parts.push(f);
    if (!instrumentBits.includes(f)) instrumentBits.push(f);
  }

  if (a.notes) parts.push(a.notes);

  // Toujours compléter en bande complète (évite 1 seul instrument du style-lock)
  const fullInstruments = ensureFullBandInstruments(instrumentBits, { gospel, metal });

  const lockVoice = String(styleLock?.vocalStyle || "").trim();
  const lockBans = [
    ...(Array.isArray(styleLock?.doNot) ? styleLock.doNot.slice(0, 4).map((d) => `never ${d}`) : []),
    ...artefactGuardsFromLock(styleLock).map((d) => d.replace(/^no /, "never ")),
  ];
  parts.unshift(
    gospel
      ? "commercial gospel-soul production quality, radio-ready full mix"
      : metal
        ? styleLock?.production || "metal production, distorted guitars, live drums"
        : "commercial radio-ready full-band production, polished multi-instrument arrangement like a streaming hit",
  );

  parts.push(
    gospel
      ? "full mixed song: lead vocal + gospel choir + band, never drums-only or instrumental bed alone"
      : metal
        ? [lockVoice || "aggressive metal vocals over distorted guitars and drums", ...lockBans]
            .filter(Boolean)
            .join(" — ")
        : "full mixed song with lead vocals AND full band (bass, keys/guitar, drums, pads) — never a single instrument loop, never drums-only, never vocals-only",
  );

  return {
    instruments: fullInstruments.join(", ").slice(0, 160),
    customFragments: parts.filter(Boolean),
    bpm: a.bpm,
    choir: a.choir,
    wantsChoir,
    gospel,
    summary: [
      a.leadInstrument ? `Lead: ${a.leadInstrument}` : null,
      choir && a.choir !== "none" ? choir.label : null,
      a.drums || null,
      a.features.length ? a.features.join(" · ") : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}
