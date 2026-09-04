/**
 * SongGeneration Studio client — barrel public.
 * @see https://github.com/BazedFrog/SongGeneration-Studio
 */

export { mapGenreForStudio } from "./models.js";

export {
  resolveSongGenBaseUrl,
  pickSongGenModel,
  resolveQualityPreset,
  normalizeSongGenCatalog,
} from "./models.js";

export { songGenLanHint } from "./client.js";

export {
  uploadSongGenReference,
  ensureSongGenVoiceReference,
  resolveVocalGender,
} from "./voice.js";

export {
  lyricsToSections,
  formatLyricsForSongGen,
  lyricsToPreviewSections,
} from "./lyrics.js";

export {
  startSongGenModelDownload,
  cancelSongGenModelDownload,
  deleteSongGenModel,
  unloadSongGenModel,
  loadSongGenModel,
  testSongGeneration,
} from "./catalog.js";

export {
  startSongGeneration,
  pollSongGeneration,
  generateMusicWithSongGeneration,
  isSongGenMusicProvider,
} from "./generate.js";
