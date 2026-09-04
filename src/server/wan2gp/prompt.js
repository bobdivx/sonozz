/** Évite caractères qui cassent parfois le prompt_parser Wan2GP. */
export function sanitizeWan2gpPrompt(prompt) {
  return String(prompt || "")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2500);
}

export function buildWan2gpPrompt({
  artist,
  track,
  social,
  lyrics,
  audioBrief,
  shotIndex = 0,
  shotBrief,
} = {}) {
  const vi = artist?.visualIdentity || {};
  const mood = audioBrief?.mood || track?.mood || artist?.mood || "emotional";
  const energy = audioBrief?.energy || "mid";
  const genre = audioBrief?.genreFeel || track?.style || artist?.genre || "pop";
  const title = String(track?.title || lyrics?.title || "single").slice(0, 60);

  const focus = shotBrief
    ? [
        `SHORT CLIP ${Number(shotBrief.index || shotIndex) + 1} only — one musical phrase.`,
        `Framing: ${shotBrief.shotType || "cinematic mid shot"}.`,
        shotBrief.lyricPhrase
          ? `Illustrate this lyric moment as imagery only (no captions): "${String(shotBrief.lyricPhrase).slice(0, 120)}".`
          : "",
        shotBrief.sceneHint ? `Director beat: ${String(shotBrief.sceneHint).slice(0, 160)}.` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : (() => {
        const beat =
          (Array.isArray(audioBrief?.visualBeats) && audioBrief.visualBeats[shotIndex]) ||
          (social?.scenes || [])[shotIndex] ||
          "wide cinematic establishing shot — lyric metaphor, no singing face";
        return `Scene beat: ${String(beat).slice(0, 160)}.`;
      })();

  return [
    `Photorealistic live-action music video B-roll, vertical 9:16 TikTok, full bleed, no letterboxing.`,
    `Energy: ${genre}, ${mood}, ${energy}. Song "${title}".`,
    focus,
    `Look: ${vi.look || mood}; wardrobe ${vi.wardrobe || "contemporary stage outfit"}; ${vi.photographyStyle || "shallow depth of field, film grain"}.`,
    `CRITICAL: NO lip-sync, NO singing mouth, NO karaoke face, NO on-screen text, NO logos, NO watermarks.`,
    `Prefer cutaways, silhouette, hands, atmosphere, profile — cinematic motion, subtle camera move.`,
  ].join(" ");
}
