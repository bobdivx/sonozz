/**
 * Plan de montage « méthode créateurs » :
 * plans courts (3–5 s), 1 phrase musicale / plan, pas de chant face caméra.
 */

const SHOT_TYPES = [
  "wide establishing shot — environment / atmosphere matching the lyric metaphor, performer small or absent",
  "silhouette of the lead against strong backlight — face unreadable, NO mouth detail, body language only",
  "detail cutaway — hands, fabric, instrument, light flares, symbolic object from the lyric line",
  "profile or over-shoulder mid shot — mouth not readable, eyes/mood only",
  "pure lyric metaphor landscape or symbolic action — no singing performance",
  "kinetic camera through the space of the song mood — empty stage / street / room, no lip movement",
];

/** Découpe les paroles en phrases utiles (sans tags [Verse]). */
export function extractLyricPhrases(lyricsText = "", max = 12) {
  const cleaned = String(lyricsText || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && !/^(chorus|verse|bridge|outro|intro)\b/i.test(l));

  const phrases = [];
  for (const line of cleaned) {
    const parts = line.split(/[,;]+/).map((p) => p.trim()).filter((p) => p.length > 3);
    if (parts.length > 1) phrases.push(...parts);
    else phrases.push(line);
  }
  return phrases.slice(0, max);
}

/**
 * @returns {Array<{ index: number, offsetSec: number, durationSec: number, lyricPhrase: string, sceneHint: string, shotType: string }>}
 */
export function planMusicVideoShots({
  lyrics,
  social,
  audioBrief,
  shotCount = 5,
  shotSec = 5,
} = {}) {
  const phrases = extractLyricPhrases(lyrics?.text || lyrics?.lyrics || "");
  const scenes = (social?.scenes || []).map((s) => String(s).trim()).filter(Boolean);
  const visualBeats = (audioBrief?.visualBeats || [])
    .map((s) => String(s).trim())
    .filter(Boolean);

  return Array.from({ length: shotCount }, (_, i) => {
    const lyricPhrase = phrases[i] || phrases[i % Math.max(1, phrases.length)] || "";
    const sceneHint =
      visualBeats[i] ||
      scenes[i] ||
      scenes[i % Math.max(1, scenes.length)] ||
      visualBeats[i % Math.max(1, visualBeats.length)] ||
      "";
    return {
      index: i,
      offsetSec: i * shotSec,
      durationSec: shotSec,
      lyricPhrase: String(lyricPhrase).slice(0, 120),
      sceneHint: String(sceneHint).slice(0, 160),
      shotType: SHOT_TYPES[i % SHOT_TYPES.length],
    };
  });
}

/** Phrase EN pour injection prompt (Seedance / Veo). */
export function formatShotPromptFocus(shot) {
  if (!shot) return "";
  return [
    `This is SHORT CLIP ${shot.index + 1} only (~${shot.durationSec}s) — one musical phrase, not a full song.`,
    `Camera / framing: ${shot.shotType}.`,
    shot.lyricPhrase
      ? `Illustrate THIS lyric moment as imagery only (no on-screen text): "${shot.lyricPhrase}".`
      : "",
    shot.sceneHint ? `Director beat: ${shot.sceneHint}.` : "",
    "CRITICAL: do NOT show singing mouth / lip-sync / karaoke face. Cutaways, silhouette, metaphor, or profile only.",
  ]
    .filter(Boolean)
    .join(" ");
}
