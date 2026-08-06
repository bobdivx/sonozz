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
  { id: "harmonies", label: "Harmonies backing", en: "soft backing vocal harmonies" },
  { id: "gospel", label: "Chœur gospel", en: "powerful gospel choir call-and-response" },
  { id: "stacked", label: "Doubles empilés", en: "stacked vocal doubles and ad-libs" },
  { id: "pads", label: "Pads chorale", en: "ethereal choir pads in the background" },
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

/**
 * Convertit les réglages UX en champs SongGen (instruments + fragments custom_style).
 */
export function musicArrangeToSongGen(arrange, { styleLockInstruments } = {}) {
  const a = normalizeMusicArrange(arrange);
  const parts = [];
  const instrumentBits = [];

  if (Array.isArray(styleLockInstruments) && styleLockInstruments.length) {
    instrumentBits.push(...styleLockInstruments.filter(Boolean).slice(0, 4));
  }
  if (a.leadInstrument) {
    instrumentBits.unshift(`lead ${a.leadInstrument}`);
    parts.push(`prominent lead ${a.leadInstrument}`);
  }
  if (a.drums) {
    instrumentBits.push(a.drums);
    parts.push(`${a.drums} drums`);
  }

  const choir = CHOIR_OPTIONS.find((c) => c.id === a.choir);
  if (choir?.en) {
    parts.push(choir.en);
    if (a.choir === "gospel") instrumentBits.push("gospel choir");
  }

  if (a.density === "sparse") parts.push("sparse arrangement, space and air");
  else if (a.density === "dense") parts.push("dense maximalist production, rich layers");
  else parts.push("balanced full-band mix");

  for (const f of a.features) {
    parts.push(f);
    if (!instrumentBits.includes(f)) instrumentBits.push(f);
  }

  if (a.notes) parts.push(a.notes);

  // Toujours rappeler le mix complet
  parts.push("full mixed song with vocals and instruments, not a cappella");

  return {
    instruments: instrumentBits.filter(Boolean).slice(0, 8).join(", ").slice(0, 160),
    customFragments: parts.filter(Boolean),
    bpm: a.bpm,
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
