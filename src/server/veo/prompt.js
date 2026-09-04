/** Extrait thème / refrain des paroles (sans tags MiniMax), pour ancrer le clip. */
function lyricsFocus(lyrics, max = 260) {
  const raw = String(lyrics?.text || lyrics || "");
  if (!raw.trim()) return "";
  const chorus = raw.match(/\[Chorus\]([\s\S]*?)(?=\[|$)/i);
  const verse = raw.match(/\[Verse[^\]]*\]([\s\S]*?)(?=\[|$)/i);
  const chunk = (chorus?.[1] || verse?.[1] || raw)
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/["«»]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return chunk.slice(0, max);
}

function sanitizeVisualBit(s, max = 140) {
  return String(s || "")
    .replace(/\b(feat\.?|ft\.?|with)\s+[A-Z][\w'-]+/gi, "")
    .replace(/\bby\s+["']?[\w .'-]{2,40}["']?/gi, "")
    .replace(/["«»]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function formatAudioBriefInline(audioBrief) {
  if (!audioBrief) return "";
  try {
    // import dynamique évité — duplication légère pour garder veo autonome
    const beats = Array.isArray(audioBrief.visualBeats)
      ? audioBrief.visualBeats.map((s) => String(s).trim()).filter(Boolean).slice(0, 3).join(" → ")
      : "";
    return [
      audioBrief.veoDirection ? String(audioBrief.veoDirection).trim().slice(0, 400) : "",
      `energy ${audioBrief.energy || "mid"}, mood ${audioBrief.mood || ""}, feel ${audioBrief.genreFeel || ""}`,
      audioBrief.bpmEstimate ? `~${Math.round(audioBrief.bpmEstimate)} BPM` : "",
      beats ? `beats: ${beats}` : "",
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 700);
  } catch {
    return "";
  }
}

/**
 * Prompt cinéma 9:16 — sans noms réels (filtre Veo « celebrity / likeness »).
 * Ancré sur le morceau (style, BPM, paroles, veoPromptHint) + look artiste.
 */
export function buildVeoShortPrompt(
  { artist, track, cover, social, lyrics, audioBrief },
  { safe = false } = {},
) {
  const vi = artist?.visualIdentity || {};
  const palette = (artist?.palette || []).slice(0, 4).join(", ");
  const scenesFromSocial = (social?.scenes || [])
    .slice(0, 3)
    .map((s) => sanitizeVisualBit(s, 120))
    .filter(Boolean);
  const scenesFromAudio = Array.isArray(audioBrief?.visualBeats)
    ? audioBrief.visualBeats.map((s) => sanitizeVisualBit(s, 120)).filter(Boolean)
    : [];
  // Priorité : battements calés sur l’audio entendu
  const scenes = (scenesFromAudio.length ? scenesFromAudio : scenesFromSocial).join(" → ");

  const mood = audioBrief?.mood || track?.mood || artist?.mood || "emotional";
  const genre = audioBrief?.genreFeel || track?.style || artist?.genre || "pop";
  const bpmRaw = audioBrief?.bpmEstimate || track?.bpm;
  const bpm = Number(bpmRaw) > 0 ? Math.round(Number(bpmRaw)) : null;
  const key = track?.key ? String(track.key).slice(0, 8) : "";
  const titleTheme = sanitizeVisualBit(track?.title || lyrics?.title || lyrics?.theme || "", 80);
  const lyricBit = lyricsFocus(lyrics, 220);
  const veoHint = sanitizeVisualBit(social?.veoPromptHint || "", 200);
  const heard = formatAudioBriefInline(audioBrief);
  const look = vi.look || mood || "cinematic";
  const wardrobe = vi.wardrobe || "contemporary stage outfit";
  const photo = vi.photographyStyle || "film grain, shallow depth of field";
  const energyLabel = audioBrief?.energy || "";
  const energy =
    energyLabel === "high" || (bpm && bpm >= 120)
      ? "high-energy, rhythmic camera moves and body language matching the heard beat"
      : energyLabel === "low" || (bpm && bpm <= 85)
        ? "slow, intimate, contemplative pacing matching the heard ballad"
        : "mid-tempo emotional energy locked to the heard groove";

  if (safe) {
    return [
      "Native vertical 9:16 TikTok frame, FULL BLEED edge-to-edge, ZERO letterboxing, ZERO black bars, ZERO widescreen mattes inside the frame.",
      "Photorealistic live-action. The lead is an original fictional musician matching the attached reference image (same face and style).",
      heard
        ? `CRITICAL — visuals MUST match this heard soundtrack excerpt: ${heard}`
        : `Song vibe: ${genre}, ${mood}${bpm ? `, ~${bpm} BPM` : ""}.`,
      titleTheme ? `Song theme (imagery only): ${titleTheme}.` : "",
      lyricBit ? `Lyric imagery: ${lyricBit}.` : "",
      `Look: ${look}. Wardrobe: ${wardrobe}. Motion: ${energy}.`,
      "Prefer wide and mid shots, silhouette, hands, environment — AVOID tight mouth/singing close-ups (no reliable lip-sync).",
      "Cinematic camera. No celebrities, logos, watermarks, or on-screen text.",
      "Do NOT invent a different song — motion follows the provided track energy only.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    "Native vertical 9:16 TikTok phone frame, FULL BLEED edge-to-edge — ZERO letterboxing, ZERO black bars, ZERO cinematic widescreen crop inside the frame.",
    "Photorealistic live-action music-video short, shot on ARRI Alexa / 35mm cinema lens, portrait orientation only.",
    "Lead performer: original fictional musician matching the attached reference portrait (face, hair, skin tone, age, vibe) — natural pores, real fabric, believable light.",
    heard
      ? `CRITICAL — a real music excerpt was analyzed; MATCH THIS HEARD TRACK: ${heard}`
      : `THIS CLIP MUST MATCH THE SONG — genre ${genre}, mood ${mood}${bpm ? `, ~${bpm} BPM` : ""}${key ? `, key ${key}` : ""}.`,
    `Body language and camera energy locked to audio: ${energy}. Do NOT attempt lip-sync or mouth phonemes.`,
    titleTheme ? `Central theme (visualize, no text): ${titleTheme}.` : "",
    lyricBit ? `Storyboard from lyrics (no readable captions): ${lyricBit}.` : "",
    veoHint ? `Director hint: ${veoHint}.` : "",
    `Visual direction: ${look}; wardrobe ${wardrobe}; photography ${photo}.`,
    `Color world: palette ${palette || "warm brass and deep ink"}, naturalistic color grade, subtle film grain.`,
    cover?.style || cover?.prompt
      ? `Cover art mood (colors/composition only): ${sanitizeVisualBit(cover.style || cover.prompt, 120)}.`
      : "",
    `Narrative beats synced to the music rhythm: ${scenes || "wide establishing → lyric metaphor environment → mid shot silhouette / hands on mic"}.`,
    "Camera: handheld micro-movement + slow push-ins timed to the heard beat. Prefer wide/mid; AVOID tight singing mouth close-ups.",
    "Fictional original character only — not a celebrity.",
    "No logos, watermarks, UI, or on-screen text.",
    "Do not invent another soundtrack; visuals only — the final edit will use the user's real track.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Prompts d’extension sûrs — scènes + vibe du morceau. */
export function buildExtendPrompts(social = {}, track = {}) {
  const scenes = (social?.scenes || [])
    .map((s) => sanitizeVisualBit(s, 140))
    .filter(Boolean);
  const genre = track?.style || "";
  const mood = track?.mood || "";
  const vibe = [genre, mood].filter(Boolean).join(", ");
  const hint = sanitizeVisualBit(social?.veoPromptHint || "", 100);
  const defaults = [
    `Continue seamlessly: environment that mirrors the song${vibe ? ` (${vibe})` : ""}, cinematic follow, emotional energy.`,
    "Continue seamlessly: intimate close-up, shallow depth of field, character looks to camera, music-video lighting.",
    "Continue seamlessly: wider shot, dynamic movement matching the track energy, same fictional character.",
  ];
  const out = [];
  for (let i = 0; i < 3; i++) {
    const beat = scenes[i] || defaults[i];
    out.push(
      [
        "Continue the music video seamlessly, staying faithful to the song's mood and lyrics imagery.",
        `Next beat: ${String(beat).slice(0, 140)}.`,
        hint && i === 0 ? `Keep director hint: ${hint}.` : "",
        "Same fictional character, no celebrities, no text, no logos, no invented song.",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  return out;
}
