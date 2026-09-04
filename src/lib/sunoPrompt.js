import {
  normalizeMusicArrange,
  musicArrangeFromStyleLock,
  musicArrangeToSongGen,
  isDefaultMusicArrange,
} from "./musicArrange.js";
import { resolveArtistGender } from "./artistGender.js";
import {
  normalizeFeatArtist,
  duoVocalPromptBits,
  duoStylePromptBits,
  displayArtistCredit,
  resolveDuoLanguages,
} from "./featArtist.js";
import { defaultBpmForGenre, isMetalLane, metalFlavorTags, metalVoiceHint, styleLockGenreBlob, withKnownArtistLane } from "./musicLane.js";
import { languageLabel, languagePrompt } from "./studio.js";

function voiceHintFromArtist(artist) {
  const g = resolveArtistGender(artist)?.code;
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
  const lock = withKnownArtistLane(styleLock || artist?.styleLock || {});
  const seed = lock.seedTrack;
  const feat = normalizeFeatArtist(artist?.featArtist);

  let arrange = normalizeMusicArrange(musicArrange ?? artist?.musicArrange);
  if (isDefaultMusicArrange(arrange) && lock && Object.keys(lock).length) {
    arrange = musicArrangeFromStyleLock(lock);
  }
  const packed = musicArrangeToSongGen(arrange, {
    styleLockInstruments: lock.instruments,
    styleLock: lock,
  });

  const genreBlob = styleLockGenreBlob(lock, [artist?.genre]);
  const metal = isMetalLane(genreBlob);

  const bpmNum = Number(
    bpmGuess ?? arrange.bpm ?? lock.bpm ?? artist?.track?.bpm ?? defaultBpmForGenre(genreBlob),
  );
  const bpm =
    Number.isFinite(bpmNum) && bpmNum >= 60 && bpmNum <= 200 ? Math.round(bpmNum) : 110;

  const instruRaw =
    (packed?.instruments && String(packed.instruments)) ||
    (Array.isArray(lock.instruments) ? lock.instruments.slice(0, 6).join(", ") : "") ||
    (metal
      ? "distorted electric guitar, rhythm guitar, bass guitar, double kick drums"
      : "bass, keys, soft drums, synth pads");
  const instru = instruRaw
    .split(",")
    .map((s) => s.trim().replace(/^lead\s+/i, ""))
    .filter(Boolean)
    .filter((s, i, arr) => arr.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i)
    .slice(0, 8)
    .join(", ");

  let production = String(lock.production || (metal ? "metal mix, distorted guitars, live kit" : "contemporary polished mix")).trim();
  if (!metal && /sparse|intimate|minimal/i.test(production)) {
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

  const keywords = (
    metal
      ? [
          ...(Array.isArray(lock.sonicKeywords) ? lock.sonicKeywords : []),
          ...metalFlavorTags(lock),
        ]
      : [
          ...(Array.isArray(lock.sonicKeywords) ? lock.sonicKeywords : []),
          "atmospheric pads",
          "subtle electronic",
          "warm bass",
          "soft drums",
        ]
  )
    .filter(Boolean)
    .filter((k, i, arr) => arr.findIndex((x) => x.toLowerCase() === k.toLowerCase()) === i)
    .slice(0, 10)
    .join(", ");

  const duoBits = feat
    ? [...duoVocalPromptBits(artist, feat), ...duoStylePromptBits(artist, feat)].join(". ")
    : "";
  // En duo, ne jamais laisser un vocalHint mono-sexe écraser les bits duo.
  const voice = feat
    ? duoBits
    : vocalHint ||
      (metal
        ? metalVoiceHint(resolveArtistGender(artist)?.code, genreBlob, lock)
        : voiceHintFromArtist(artist));

  const duoLangs = resolveDuoLanguages(
    artist,
    feat,
    lyrics?.language || artist?.language,
  );
  const langCode = duoLangs.leadLang;
  const langName = languagePrompt(langCode);
  const langUi = languageLabel(langCode);
  const langLine = duoLangs.bilingual
    ? `Language: bilingual duet — singer 1 (${artist?.name || "lead"}) in ${langUi} (${langCode}), singer 2 (${feat.name}) in ${languageLabel(duoLangs.featLang)} (${duoLangs.featLang}); each stays in their own language`
    : `Language: ${langUi} (${langCode}) — vocals and lyrics sung entirely in ${langName}`;

  return `Style: ${lock.genreSummary || artist?.genre || (metal ? "metal" : "indie pop")}${
    lock.matchedName || seed?.artistName
      ? ` (lane of ${lock.matchedName || seed.artistName})`
      : ""
  }. ${voice}. Mood: ${artist?.mood || lock.mood || (metal ? "aggressive" : "emotional")}.
${langLine}
Artist: ${displayArtistCredit(artist, feat)}
Production: ${production}
Keywords: ${keywords}
Instruments: ${instru}
Groove: ${lock.rhythmFeel || arrange?.drums || (metal ? "live kit" : "natural soft groove")} · BPM ${bpm}${
    seed?.title ? ` · ref « ${seed.title} »` : ""
  }${arrangeLine ? `\nArrange: ${arrangeLine}` : ""}${
    feat && duoBits ? `\nDuo: ${duoBits}` : ""
  }
Title: ${lyrics?.title || "Untitled"}
Lyrics:
${lyrics?.text || ""}`.trim();
}
