/** Réglages d’arrangement SongGen (projet) — défauts prudents = mix complet. */

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
    en: "large gospel choir backing vocals with SATB harmonies, call-and-response with the lead singer on every chorus, church organ and piano bed, never drums-only",
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

export function normalizeMusicArrange(raw) {
  const base = emptyMusicArrange();
  if (!raw || typeof raw !== "object") return base;
  const choirIds = new Set(CHOIR_OPTIONS.map((c) => c.id));
  const densityIds = new Set(DENSITY_OPTIONS.map((d) => d.id));
  const featureIds = new Set(FEATURE_TAGS.map((f) => f.id));
  const bpmNum = Number(raw.bpm);
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
  };
}

function looksLikeDrums(tag = "") {
  return /\b(drum|drums|kit|808|trap|perc|beat|hi-?hat|snare)\b/i.test(String(tag));
}

/** Complète une liste d’instruments pour éviter les sorties « 1 piste seule ». */
function ensureFullBandInstruments(bits, { gospel = false } = {}) {
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
export function musicArrangeToSongGen(arrange, { styleLockInstruments } = {}) {
  const a = normalizeMusicArrange(arrange);
  const parts = [];
  const instrumentBits = [];
  const wantsChoir = a.choir && a.choir !== "none";
  const gospel = a.choir === "gospel";

  const choir = CHOIR_OPTIONS.find((c) => c.id === a.choir);
  // Chœur EN TÊTE — sinon SongGen / LeVo ignore le hint noyé derrière « drums »
  if (choir?.en) {
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
  const density = gospel && a.density === "mid" ? "dense" : a.density;
  if (density === "sparse") parts.push("sparse arrangement, space and air");
  else if (density === "dense") {
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
  const fullInstruments = ensureFullBandInstruments(instrumentBits, { gospel });

  parts.unshift(
    gospel
      ? "commercial gospel-soul production quality, radio-ready full mix"
      : "commercial radio-ready full-band production, polished multi-instrument arrangement like a streaming hit",
  );

  parts.push(
    gospel
      ? "full mixed song: lead vocal + gospel choir + band, never drums-only or instrumental bed alone"
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
