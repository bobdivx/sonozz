import {
  isMetalLane,
  metalBandInstruments,
  metalFlavorTags,
  sectionDynamicsStyleTags,
} from "../../lib/musicLane.js";
import {
  FEMININE_TIMBRE_RE,
  MASCULINE_TIMBRE_RE,
  stripOppositeGender,
} from "./voice.js";

/** Emotion Studio : anglais court (LeVo ignore souvent le FR). */
function mapEmotionForStudio(
  mood = "",
  { gospel = false, wantsChoir = false, genreHint = "" } = {},
) {
  const raw = String(mood || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  const blob = `${raw} ${genreHint}`;
  if (isMetalLane(blob) || /brutal|growl|guttural|blast/.test(blob)) {
    return "aggressive";
  }
  if (!raw) {
    if (gospel) return "uplifting";
    if (wantsChoir) return "soulful";
    return "energetic";
  }
  if (/festif|dansant|party|upbeat|joyeux|energie|energetic|hype|fire|soleil|summer/.test(raw)) {
    return "energetic";
  }
  if (/agress|rage|angry|hard|raw|brutal/.test(raw)) return "aggressive";
  if (/melancol|sad|triste|dark|sombre|intim/.test(raw)) return "melancholic";
  if (/romanti|love|doux|tendre|sensual/.test(raw)) return "romantic";
  if (/chill|cool|laid.?back|relax|zen/.test(raw)) return "chill";
  if (/soulful|emotion|profond/.test(raw)) return "soulful";
  // Premier token si déjà anglais court
  const first = raw.split(/[,/|·]/)[0].trim();
  if (/^[a-z][a-z\s-]{1,28}$/.test(first) && !/[àâäéèêëïîôùûüç]/.test(first)) {
    return first.slice(0, 40);
  }
  return "energetic";
}

/** Tags genre libres (sans styleLock) — complètent le genre Studio trop grossier. */
function genreFlavorTags(genreHint = "") {
  const raw = String(genreHint || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const tags = [];
  const add = (t) => {
    if (t && !tags.includes(t)) tags.push(t);
  };
  if (/afro-?trap|afrobeat|afrobeats/.test(raw)) {
    add("afrobeats");
    add("afrobeat");
    add("dancehall");
    add("tropical percussion");
    add("syncopated groove");
  } else if (/dancehall/.test(raw)) {
    add("dancehall");
    add("caribbean");
    add("offbeat guitar");
  } else if (/trap|drill|hip[\s-]?hop|rap/.test(raw)) {
    add("trap drums");
    add("808 bass");
    add("hip hop");
  } else if (/hyperpop|electro/.test(raw)) {
    add("hyperpop");
    add("glitchy synths");
  } else if (isMetalLane(raw)) {
    for (const t of metalFlavorTags(raw)) add(t);
  }
  return tags;
}

/**
 * Tags courts pour descriptions LeVo (pas de pavés anglais — ça aplatit le mix).
 * @param {object|null} lock
 * @param {ReturnType<typeof musicArrangeToSongGen>} fromArrange
 * @param {"male"|"female"} genderCode
 * @param {{ language?: string }} [opts]
 */
function buildSongGenStyleTags(
  lock,
  fromArrange,
  genderCode = "male",
  { language, metal = false, extreme = false } = {},
) {
  const tags = [];
  const push = (v, max = 36) => {
    let s0 = stripOppositeGender(v, genderCode);
    s0 = String(s0 || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
    if (!s0 || s0.length < 2) return;
    // Couper tout ce qui pousse un lit à 1 piste
    if (/\b(sparse|minimal|stripped|strip-?back|solo piano|a cappella|vocals only)\b/i.test(s0)) {
      return;
    }
    if (/\b(with|and the|never|like a|full mixed)\b/i.test(s0) && s0.split(/\s+/).length > 5) {
      return;
    }
    if (
      !metal &&
      genderCode === "male" &&
      FEMININE_TIMBRE_RE.test(s0) &&
      !MASCULINE_TIMBRE_RE.test(s0)
    ) {
      return;
    }
    const low = s0.toLowerCase();
    if (tags.some((t) => t.toLowerCase() === low)) return;
    tags.push(s0);
  };

  if (metal) {
    push("full band mix", 20);
    push("crushing guitars", 20);
    push("double kick drums", 20);
    if (extreme) {
      push("guttural growls", 20);
      push("brutal death metal", 22);
    } else {
      push("aggressive metal vocals", 24);
    }
    push("no clean singing", 18);
    push("no synth pads", 16);
    push("no pop polish", 16);
  } else {
    // Mix d’abord — trop de tags « vocals » → bande étroite / voix artefactée
    push("full band mix", 20);
    push("balanced drums", 16);
    push("audible bass", 16);
    if (genderCode === "female") {
      push("natural female vocals", 24);
    } else {
      push("natural male vocals", 24);
    }
    push("clear lead vocal", 14);
    push("clean mix", 12);
  }
  for (const t of sectionDynamicsStyleTags()) {
    push(t, 20);
  }
  const lang = String(language || "").toLowerCase();
  if (lang.startsWith("fr")) push("french lyrics", 16);
  else if (lang.startsWith("en")) push("english lyrics", 16);

  if (Array.isArray(lock?.sonicKeywords)) {
    for (const k of lock.sonicKeywords.slice(0, 8)) push(k, 32);
  }
  if (Array.isArray(lock?.genres)) {
    for (const g of lock.genres.slice(0, 3)) push(g, 28);
  }

  if (lock?.production) {
    const prodBits = String(lock.production)
      .split(/[,;/|]/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 3 && x.length <= 36)
      .slice(0, 3);
    for (const p of prodBits) push(p, 36);
  }

  if (lock?.rhythmFeel) {
    const groove = String(lock.rhythmFeel).split(/[,;/]/)[0].trim();
    if (groove) push(groove, 28);
  }
  if (lock?.tempoFeel) push(String(lock.tempoFeel).split(/[,;/]/)[0], 24);

  if (metal) {
    push("high energy");
    push("dense layers");
    push("wall of sound");
    for (const t of metalFlavorTags(lock)) push(t, 32);
    for (const d of (lock?.doNot || []).slice(0, 3)) {
      push(`no ${String(d).split(/[,;/]/)[0].trim()}`.slice(0, 28), 28);
    }
  } else {
    if (lock?.energy === "high") push("high energy");
    else if (lock?.energy === "low") push("moody");
    else push("polished mix");

    // Toujours densifier — « intimate/sparse » = mix nul chez LeVo
    push("full band");
    push("dense layers");
    push("rich arrangement");
    push("multi instrument");
  }

  if (fromArrange?.gospel) {
    push("gospel choir");
    push("church organ");
    push("call and response");
  } else if (fromArrange?.wantsChoir && !metal) {
    push("backing vocals");
    push("vocal harmonies");
  }

  if (fromArrange?.summary && !metal) {
    for (const bit of String(fromArrange.summary).split(/\s*·\s*/)) {
      push(bit.replace(/^Lead:\s*/i, ""), 28);
    }
  }

  if (!metal) {
    push("layered instruments");
    push("wide stereo");
  }
  return tags.slice(0, 18);
}

/** Bande complète forcée selon le genre Studio — jamais 1 seul instrument. */
function bandForStudioGenre(studioGenre = "Pop", { gospel = false } = {}) {
  if (gospel) return ["gospel choir", "church organ", "piano", "bass", "drums", "electric guitar"];
  const g = String(studioGenre || "Pop").toLowerCase();
  if (g.includes("electronic") || g === "dance") {
    return ["synth bass", "drum machine", "synth pads", "electric piano", "arpeggiator", "soft synth lead"];
  }
  if (g.includes("metal")) {
    return metalBandInstruments();
  }
  if (g.includes("rock")) {
    return ["electric guitar", "bass guitar", "drum kit", "rhythm guitar"];
  }
  if (g.includes("r&b") || g.includes("jazz") || g.includes("soul")) {
    return ["electric piano", "bass", "drum kit", "synth pads", "keys", "soft guitar"];
  }
  if (g.includes("folk")) {
    return ["acoustic guitar", "bass", "soft drums", "piano", "strings"];
  }
  if (g.includes("reggae")) {
    return [
      "guitar",
      "bass",
      "drums",
      "organ",
      "percussion",
      "shaker",
      "808 bass",
      "synth pads",
    ];
  }
  // Pop / défaut
  return ["electric guitar", "bass", "drum kit", "piano", "synth pads", "keys"];
}

/** Instruments concrets (tags) — styleLock + arrangement, jamais 1 seul. */
function buildSongGenInstruments(lock, fromArrange, { gospel = false, studioGenre = "Pop" } = {}) {
  const metal = /metal/i.test(String(studioGenre));
  const skipSoft = (x) =>
    metal && /\b(piano|keys|synth|pad|organ|choir)\b/i.test(x) && !/hammond/i.test(x);
  const bits = [];
  const add = (t) => {
    const x = String(t || "")
      .replace(/^lead\s+/i, "")
      .trim();
    if (!x) return;
    if (/\b(sparse|minimal|a cappella)\b/i.test(x)) return;
    if (skipSoft(x)) return;
    if (bits.some((b) => b.toLowerCase() === x.toLowerCase())) return;
    bits.push(x);
  };

  // Base forcée d’abord (évite le lit mono-instrument de la réf.)
  for (const i of bandForStudioGenre(studioGenre, { gospel })) add(i);

  if (Array.isArray(lock?.instruments)) {
    for (const i of lock.instruments.slice(0, 4)) add(i);
  }

  const arranged = String(fromArrange?.instruments || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  for (const i of arranged) add(i);

  // Minimum 5 instruments, toujours
  if (bits.length < 5) {
    for (const i of bandForStudioGenre(studioGenre, { gospel })) add(i);
  }

  return bits.slice(0, 8).join(", ").slice(0, 180);
}

export {
  mapEmotionForStudio,
  genreFlavorTags,
  buildSongGenStyleTags,
  buildSongGenInstruments,
};
