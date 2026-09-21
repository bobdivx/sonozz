/**
 * Goût utilisateur ACE — remarques libres + pastilles + params « ça me plaît ».
 * Tout est modifiable à la volée et persisté sur l’artiste.
 */

const NOTES_MAX = 500;
const ADDON_MAX = 280;

/**
 * Pastilles UI — id stable, label FR, fragment style EN.
 * L’utilisateur clique → tag sauvé → appliqué à chaque génération.
 */
export const ACE_TASTE_CHIPS = [
  {
    id: "us-rap",
    label: "Plus rap US",
    hint: "cadence américaine, boom-bap / trap US",
    addon: "US hip-hop, American rap cadence, NYC/Atlanta pocket, English-leaning flow energy",
  },
  {
    id: "fr-rap",
    label: "Plus rap FR",
    hint: "flow francophone, drill / trap FR",
    addon: "French rap, francophone flow, clear French diction, FR trap/drill energy",
  },
  {
    id: "harder-rap",
    label: "Plus agressif / rappe",
    hint: "moins chanté, plus de flow",
    addon: "hard rapped delivery, rhythmic hip-hop flow, not melodic pop singing",
  },
  {
    id: "more-melodic",
    label: "Plus mélodique",
    hint: "hooks chantés, melodic rap",
    addon: "melodic rap, sung hooks, catchy melodic chorus, smooth vocal melody",
  },
  {
    id: "gospel-choir",
    label: "Plus de chœur gospel",
    hint: "orgue, claps, call-and-response",
    addon: "gospel choir call-and-response, Hammond organ, handclaps, church choir stacks on hooks",
  },
  {
    id: "clear-diction",
    label: "Paroles plus claires",
    hint: "diction, intelligibilité",
    addon: "every word intelligible, crisp enunciation, dry upfront lead vocal",
  },
  {
    id: "airy-mix",
    label: "Mix plus aéré",
    hint: "profondeur, moins plat",
    addon: "airy open mix, depth, lead vocal prominent over the beat",
  },
  {
    id: "heavier-808",
    label: "Plus de 808 / basse",
    hint: "low-end trap",
    addon: "heavy 808 bass, punchy trap low-end, deep sub",
  },
  {
    id: "softer-808",
    label: "Moins de 808",
    hint: "basse contrôlée",
    addon: "controlled 808, clean low-end, bass not overpowering vocals",
  },
  {
    id: "slower",
    label: "Plus lent",
    hint: "pocket plus large",
    addon: "slower moderate tempo, spacious pocket, clear phrasing",
  },
  {
    id: "faster",
    label: "Plus rapide / énergique",
    hint: "tempo up",
    addon: "higher energy tempo, driving beat, urgent flow",
  },
  {
    id: "live-band",
    label: "Plus live / band",
    hint: "guitares, batterie live",
    addon: "live full band feel, organic drums, warm guitars, less electronic-only",
  },
  {
    id: "more-trap",
    label: "Plus trap",
    hint: "hi-hats, 808, dark pads",
    addon: "modern trap beat, rolling hi-hats, dark pads, 808 slides",
  },
  {
    id: "boom-bap",
    label: "Plus boom bap",
    hint: "old school, samples",
    addon: "classic boom bap, dusty samples, hard-hitting drums, old-school hip-hop",
  },
  {
    id: "rnb-soul",
    label: "Plus R&B / soul",
    hint: "voix soul, grooves",
    addon: "R&B soul groove, smooth soulful vocals, warm keys",
  },
  {
    id: "less-autotune",
    label: "Moins d’autotune",
    hint: "voix naturelle",
    addon: "dry natural vocal, minimal pitch correction, organic tone",
  },
];

const CHIP_BY_ID = new Map(ACE_TASTE_CHIPS.map((c) => [c.id, c]));

export function normalizeAceTaste(raw) {
  if (!raw || typeof raw !== "object") {
    return emptyAceTaste();
  }
  const gs = Number(raw.guidanceScale);
  const steps = Number(raw.inferenceSteps);
  const tags = Array.isArray(raw.tags)
    ? [...new Set(raw.tags.map((t) => String(t || "").trim()).filter((id) => CHIP_BY_ID.has(id)))]
    : [];
  const base = {
    notes: String(raw.notes || "").trim().slice(0, NOTES_MAX),
    tags,
    styleAddon: String(raw.styleAddon || "").trim().slice(0, ADDON_MAX),
    likedAt: raw.likedAt ? String(raw.likedAt) : null,
    likedNote: String(raw.likedNote || "").trim().slice(0, NOTES_MAX),
    guidanceScale:
      raw.guidanceScale == null || raw.guidanceScale === ""
        ? null
        : Number.isFinite(gs)
          ? Math.min(20, Math.max(0, gs))
          : null,
    inferenceSteps:
      raw.inferenceSteps == null || raw.inferenceSteps === ""
        ? null
        : Number.isFinite(steps)
          ? Math.min(200, Math.max(1, Math.round(steps)))
          : null,
    preferredModel: String(raw.preferredModel || "").trim().slice(0, 120) || null,
  };
  // Toujours recalculer l’addon depuis tags + notes (source de vérité interactive).
  const computed = composeStyleAddon(base.tags, base.notes);
  return {
    ...base,
    styleAddon: computed || base.styleAddon,
  };
}

function emptyAceTaste() {
  return {
    notes: "",
    tags: [],
    styleAddon: "",
    likedAt: null,
    likedNote: "",
    guidanceScale: null,
    inferenceSteps: null,
    preferredModel: null,
  };
}

function fold(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Remarques FR/EN libres → fragments style (heuristique large). */
export function notesToStyleAddon(notes) {
  const n = fold(notes);
  if (!n.trim()) return "";
  const bits = [];

  // Régions / écoles
  if (/\bus\b|usa|americain|american|new\s*york|nyc|atlanta|chicago|west\s*coast|east\s*coast/.test(n)) {
    bits.push("US hip-hop, American rap cadence, NYC/Atlanta pocket");
  }
  if (/\bfr\b|francais|francophone|french\s*rap|rap\s*fr/.test(n) && !/\bus\b|americain|american/.test(n)) {
    bits.push("French rap, francophone flow, clear French diction");
  }
  if (/uk\s*drill|london|grime/.test(n)) {
    bits.push("UK drill, sliding 808s, British rap cadence");
  }

  // Delivery
  if (
    /pas\s+(du\s+)?rap|pas\s+assez\s+rap|manque\s+de\s+rap|trop\s+chant|trop\s+pop|not\s+rap|more\s+rap|plus\s+rapper/.test(
      n,
    )
  ) {
    bits.push("hard rapped delivery, hip-hop flow, not melodic pop singing");
  }
  if (
    /plus\s+melodi|plus\s+de\s+melodi|more\s+melodic|pas\s+assez\s+melodi|trop\s+agres|trop\s+dur|hooks?\s+chantes?|sung\s+hook/.test(
      n,
    )
  ) {
    bits.push("melodic rap, sung hooks, catchy melodic chorus");
  }
  if (/compr[eh]|intelligib|diction|marmonn|mumble|flou|bave|articulate|audibl|pas\s+clair|pas\s+comprehensible/.test(n)) {
    bits.push("every word intelligible, crisp enunciation, dry upfront vocal");
  }
  if (/autotune|auto-tune|vocoder|robot|traite/.test(n) && /moins|moins\s+d|sans|no\b|less/.test(n)) {
    bits.push("dry natural vocal, minimal pitch correction");
  } else if (/autotune|melodic\s*trap|t-pain/.test(n)) {
    bits.push("tasteful melodic-trap vocal processing");
  }

  // Gospel / chœur
  if (/gospel|choeur|chœur|choir|eglise|église|church|sister\s*act|call.?and.?response/.test(n)) {
    bits.push("gospel choir call-and-response, Hammond organ, handclaps, church choir on hooks");
  }

  // Genres / prod
  if (/\btrap\b|hi-?hats?|hihats/.test(n)) {
    bits.push("modern trap beat, rolling hi-hats, 808 slides");
  }
  if (/boom\s*bap|old\s*school|oldschool|sample/.test(n)) {
    bits.push("classic boom bap, dusty samples, hard-hitting drums");
  }
  if (/drill/.test(n) && !/uk\s*drill/.test(n)) {
    bits.push("drill energy, dark sliding 808s, sparse menacing beat");
  }
  if (/r&?b|soul|neo[\s-]?soul/.test(n)) {
    bits.push("R&B soul groove, warm keys, smooth soulful tone");
  }
  if (/live|groupe|band|guitare|organique/.test(n)) {
    bits.push("live full band feel, organic drums, warm guitars");
  }

  // Mix / basse / tempo
  if (/808|basse|bass|sub|boum/.test(n)) {
    if (/moins|trop\s+(de\s+)?(808|basse)|overpower|ecrase/.test(n)) {
      bits.push("controlled 808, clean low-end, bass not overpowering vocals");
    } else if (/plus|manque|pas\s+assez|heavier|plus\s+de/.test(n)) {
      bits.push("heavy 808 bass, punchy trap low-end");
    } else {
      bits.push("controlled 808, clean low-end");
    }
  }
  if (/plat|mix|profondeur|airy|air|etouffe|enterre|buried/.test(n)) {
    bits.push("airy open mix, depth, lead vocal prominent");
  }
  if (/lent|ralent|bpm\s+bas|trop\s+vite|trop\s+rapide|slower|faster|plus\s+lent|plus\s+rapide|energie/.test(n)) {
    if (/lent|ralent|slower|bpm\s+bas|trop\s+vite|trop\s+rapide/.test(n) && !/plus\s+rapide|faster|energie/.test(n)) {
      bits.push("slower moderate tempo, spacious pocket");
    } else if (/plus\s+rapide|faster|plus\s+d.?energie|energetique/.test(n)) {
      bits.push("higher energy tempo, driving beat");
    }
  }

  if (!bits.length) {
    bits.push(`follow user taste: ${String(notes).trim().slice(0, 120)}`);
  }
  return dedupeBits(bits).join(", ").slice(0, ADDON_MAX);
}

function dedupeBits(bits) {
  const seen = new Set();
  const out = [];
  for (const b of bits) {
    const key = fold(b).slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

/** Compose addon final : pastilles + remarques libres. */
export function composeStyleAddon(tags = [], notes = "") {
  const fromTags = (Array.isArray(tags) ? tags : [])
    .map((id) => CHIP_BY_ID.get(id)?.addon)
    .filter(Boolean);
  const fromNotes = notesToStyleAddon(notes);
  const noteBits = fromNotes
    ? fromNotes.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  return dedupeBits([...fromTags, ...noteBits]).join(", ").slice(0, ADDON_MAX);
}

export function toggleAceTasteTag(currentTaste, tagId) {
  const base = normalizeAceTaste(currentTaste);
  const id = String(tagId || "").trim();
  if (!CHIP_BY_ID.has(id)) return base;
  const has = base.tags.includes(id);
  const tags = has ? base.tags.filter((t) => t !== id) : [...base.tags, id];
  return normalizeAceTaste({
    ...base,
    tags,
    styleAddon: composeStyleAddon(tags, base.notes),
  });
}

/**
 * Sauvegarde « ça me plaît » : fige params du take + goût actuel.
 */
export function saveLikedAceTaste(currentTaste, { aceGen = null, notes = "", tags } = {}) {
  const base = normalizeAceTaste(currentTaste);
  const note = String(notes ?? base.notes ?? "").trim().slice(0, NOTES_MAX);
  const nextTags = Array.isArray(tags) ? tags : base.tags;
  const gen = aceGen && typeof aceGen === "object" ? aceGen : {};
  const gs = Number(gen.guidanceScale);
  const steps = Number(gen.inferenceSteps);
  const addon = composeStyleAddon(nextTags, note);
  return normalizeAceTaste({
    ...base,
    notes: note,
    tags: nextTags,
    likedNote: note,
    likedAt: new Date().toISOString(),
    styleAddon: addon,
    guidanceScale: Number.isFinite(gs) ? gs : base.guidanceScale,
    inferenceSteps: Number.isFinite(steps) ? steps : base.inferenceSteps,
    preferredModel: String(gen.model || base.preferredModel || "").trim() || null,
  });
}

/** Met à jour les remarques (recalcule addon avec tags). */
export function updateAceTasteNotes(currentTaste, notes) {
  const base = normalizeAceTaste(currentTaste);
  const note = String(notes || "").trim().slice(0, NOTES_MAX);
  return normalizeAceTaste({
    ...base,
    notes: note,
    styleAddon: composeStyleAddon(base.tags, note),
  });
}

export function clearAceTasteLiked(currentTaste) {
  const base = normalizeAceTaste(currentTaste);
  return normalizeAceTaste({
    notes: base.notes,
    tags: base.tags,
    styleAddon: composeStyleAddon(base.tags, base.notes),
    likedAt: null,
    likedNote: "",
    guidanceScale: null,
    inferenceSteps: null,
    preferredModel: null,
  });
}

/** Reset total (tags + notes + liked). */
export function clearAceTasteAll(currentTaste) {
  void currentTaste;
  return emptyAceTaste();
}

export function hasSavedAceTaste(taste) {
  const t = normalizeAceTaste(taste);
  return Boolean(
    t.likedAt || t.styleAddon || t.guidanceScale != null || t.notes || t.tags.length,
  );
}

/** Fragments courts pour SongGen / MiniMax (tags ou prompt). */
export function aceTastePromptBits(taste, { maxBits = 6, maxLen = 40 } = {}) {
  const t = normalizeAceTaste(taste);
  const addon = t.styleAddon || composeStyleAddon(t.tags, t.notes);
  if (!addon) return [];
  return addon
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, maxBits)
    .map((s) => s.slice(0, maxLen));
}

/**
 * Applique le goût utilisateur sur un body ACE déjà construit.
 */
export function applyAceTasteToBody(body, taste) {
  if (!body || typeof body !== "object") return body;
  const t = normalizeAceTaste(taste);
  const out = { ...body };

  if (t.guidanceScale != null) {
    out.guidanceScale = t.guidanceScale;
  }
  if (t.inferenceSteps != null) {
    out.inferenceSteps = t.inferenceSteps;
  }
  if (t.preferredModel) {
    out.ditModel = t.preferredModel;
  }

  const addon = t.styleAddon || composeStyleAddon(t.tags, t.notes);
  if (addon) {
    const style = String(out.style || "").trim();
    out.style = `${style}${style ? ". " : ""}${addon}`.slice(0, 700);
  }

  const noteBit = t.notes || t.likedNote;
  if (noteBit || addon || t.tags.length) {
    const tagLabels = t.tags
      .map((id) => CHIP_BY_ID.get(id)?.label)
      .filter(Boolean)
      .join(", ");
    const hint = [
      addon ? `User taste: ${addon}` : null,
      tagLabels ? `Prefs: ${tagLabels}` : null,
      noteBit ? `User notes: ${noteBit.slice(0, 140)}` : null,
    ]
      .filter(Boolean)
      .join("; ");
    const instr = String(out.instruction || "").trim();
    out.instruction = `${instr}${instr ? " " : ""}${hint}`.slice(0, 420);
  }

  return out;
}
