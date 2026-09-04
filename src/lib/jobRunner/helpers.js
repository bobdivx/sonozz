import { createClipId } from "../clipsModel.js";

export function slimContext(ctx = {}) {
  return {
    projectId: ctx.projectId || null,
    clipId: ctx.clipId || createClipId(),
    artist: ctx.artist
      ? {
          name: ctx.artist.name,
          imageUrl: ctx.artist.imageUrl,
          mood: ctx.artist.mood,
          genre: ctx.artist.genre,
        }
      : null,
    track: ctx.track
      ? {
          title: ctx.track.title,
          audioUrl: ctx.track.audioUrl,
          bpm: ctx.track.bpm,
          mood: ctx.track.mood,
          style: ctx.track.style,
        }
      : null,
    cover: ctx.cover?.imageUrl ? { imageUrl: ctx.cover.imageUrl } : null,
    social: ctx.social
      ? {
          caption: ctx.social.caption,
          hashtags: ctx.social.hashtags,
          scenes: ctx.social.scenes,
          audioBrief: ctx.social.audioBrief,
          veo: ctx.social.veo,
        }
      : null,
    lyrics: ctx.lyrics
      ? { text: String(ctx.lyrics.text || ctx.lyrics || "").slice(0, 4000) }
      : null,
  };
}

export async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
