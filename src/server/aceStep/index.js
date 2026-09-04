/**
 * ACE-Step Studio client — barrel public.
 * @see https://github.com/timoncool/ACE-Step-Studio
 */

export {
  resolveAceVocalLanguage,
  aceVocalLanguageStyleBit,
  lyricsForAceStepPreview,
  stripAceStageDirections,
} from "./lyrics.js";

export {
  DEFAULT_BASE,
  ACE_STEP_ENGINE_DIT_IDS,
  ACE_SFT_GUIDANCE,
  ACE_NORMALIZATION_DB,
  ACE_STEP_MODELS,
  ACE_FALLBACK_LIGHT_MODEL,
  resolveAceStepBaseUrl,
  isAceStepMusicProvider,
  isAceStepEngineDit,
  aceStepModelMeta,
  aceStepModelLabel,
  aceStepDitBasename,
  aceStepDitSame,
  aceStepInferenceForModel,
  listAceStepSwitchableModels,
  isAceStepSftModel,
  pickAceStepModel,
} from "./models.js";

export {
  DEFAULT_GPU_ARBITER,
  POLL_MS,
  MAX_POLLS,
  aceStepLanHint,
  resolveAceAudioUrl,
  interpretAceProbe,
} from "./client.js";

export {
  ACE_STYLE_TRANSFER_STRENGTH,
  ACE_DUO_STYLE_TRANSFER_STRENGTH,
  ACE_DUO_STYLE_TRANSFER_STRENGTH_INTRO,
  ACE_DUO_BPM_CAP,
  ACE_COVER_NOISE_SOLO,
  ACE_COVER_NOISE_DUO_INTRO,
  ACE_COVER_NOISE_DUO,
  ACE_FULL_DURATION_MIN,
  ACE_FULL_DURATION_MAX,
  pickAceStepDurationSec,
  snapshotAceGenParams,
  buildLabAceStepBody,
  buildAceStepBody,
} from "./body.js";

export {
  ensureAceGpuSlot,
  wakeAceStepPipeline,
  testAceStep,
  switchAceStepModel,
  waitForAceStepModel,
  waitForAceStepResidentVram,
  aceStepVramHeadroomGb,
  aceStepMinResidentVramGb,
  isAceStepGhostLoad,
  readAceStepGpu,
  ensureAceStepVram,
} from "./lifecycle.js";

export {
  isAceNanLatentsError,
  isAceVramError,
  isGradioReferenceCacheError,
  isUnusableAceReferenceError,
  looksLikeAudioBuffer,
} from "./errors.js";

export {
  resolveAceStepGradioUrl,
  gradioUploadBases,
  isAceHostedAudioUrl,
  gradioFileUrl,
  extractGradioUploadUrl,
  uploadReferenceToGradio,
  uploadAceStepReference,
  ensureAceStepStyleReference,
} from "./gradio.js";

export {
  startAceStep,
  pollAceStep,
  cancelAceStep,
  generateMusicWithAceStep,
} from "./generate.js";
