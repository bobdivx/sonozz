import {
  normalizeMusicArrange,
  musicArrangeFromStyleLock,
  musicArrangeToSongGen,
  isDefaultMusicArrange,
} from "./musicArrange.js";

function voiceHintFromArtist(artist) {
  const g = String(artist?.gender || "").toLowerCase();
  if (g === "female") return "female vocals, woman singer";
  if (g === "nonbinary") return "androgynous vocals";
  return "male vocals, man singer";
}

/**
 * Prompt Suno / export — reconstruit depuis styleLock + arrangement (pas un snapshot figé).
 * Reformule « sparse/intimate » pour éviter les lits vides.
 */
export function buildSunoPrompt({
  lyrics,
  artist,
  styleLock,
  bpmGuess,
  musicArrange,
  vocalHint,
} = {}) {
  const lock = styleLock || artist?.styleLock || {};
  const seed = lock.seedTrack;

  let arrange = normalizeMusicArrange(musicArrange ?? artist?.musicArrange);
  if (isDefaultMusicArrange(arrange) && lock && Object.keys(lock).length) {
    arrange = musicArrangeFromStyleLock(lock);
  }
  const packed = musicArrangeToSongGen(arrange, {
    styleLockInstruments: lock.instruments,
  });

  const bpmNum = Number(
    bpmGuess ?? arrange.bpm ?? lock.bpm ?? artist?.track?.bpm ?? 110,
  );
  const bpm =
    Number.isFinite(bpmNum) && bpmNum >= 60 && bpmNum <= 200 ? Math.round(bpmNum) : 110;

  const instruRaw =
    (packed?.instruments && String(packed.instruments)) ||
    (Array.isArray(lock.instruments) ? lock.instruments.slice(0, 6).join(", ") : "") ||
    "bass, keys, soft drums, synth pads";
  const instru = instruRaw
    .split(",")
    .map((s) => s.trim().replace(/^lead\s+/i, ""))
    .filter(Boolean)
    .filter((s, i, arr) => arr.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i)
    .slice(0, 8)
    .join(", ");

  let production = String(lock.production || "contemporary polished mix").trim();
  if (/sparse|intimate|minimal/i.test(production)) {
    const focusMatch = production.match(/with a focus on\s+(.+?)(?:\.|$)/i);
    const focus = (focusMatch?.[1] || "organic textures and subtle electronic elements")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\.+$/, "");
    production = `Intimate atmospheric production with a focus on ${focus} — full arrangement: warm bass, soft drums, atmospheric pads, subtle electronic layers, never thin or single-instrument`;
  }

  const arrangeLine = [
    arrange?.leadInstrument ? `lead ${arrange.leadInstrument}` : null,
    arrange?.choir && arrange.choir !== "none" ? `choir:${arrange.choir}` : null,
    arrange?.drums || null,
    arrange?.density ? `density ${arrange.density}` : null,
    Array.isArray(arrange?.features) && arrange.features.length
      ? arrange.features.join(", ")
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const keywords = [
    ...(Array.isArray(lock.sonicKeywords) ? lock.sonicKeywords : []),
    "atmospheric pads",
    "subtle electronic",
    "warm bass",
    "soft drums",
  ]
    .filter(Boolean)
    .filter((k, i, arr) => arr.findIndex((x) => x.toLowerCase() === k.toLowerCase()) === i)
    .slice(0, 10)
    .join(", ");

  const voice = vocalHint || voiceHintFromArtist(artist);

  return `Style: ${artist?.genre || lock.genreSummary || "indie pop"}${
    lock.matchedName || seed?.artistName
      ? ` (lane of ${lock.matchedName || seed.artistName})`
      : ""
  }. ${voice}. Mood: ${artist?.mood || lock.mood || "emotional"}.
Production: ${production}
Keywords: ${keywords}
Instruments: ${instru}
Groove: ${lock.rhythmFeel || arrange?.drums || "natural soft groove"} · BPM ${bpm}${
    seed?.title ? ` · ref « ${seed.title} »` : ""
  }${arrangeLine ? `\nArrange: ${arrangeLine}` : ""}
Title: ${lyrics?.title || "Untitled"}
Lyrics:
${lyrics?.text || ""}`.trim();
}
