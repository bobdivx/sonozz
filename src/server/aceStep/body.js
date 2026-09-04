import {
  aceStepInferenceForModel,
  ACE_SFT_GUIDANCE,
  ACE_NORMALIZATION_DB,
} from "./models.js";
import {
  resolveAceVocalLanguage,
  aceVocalLanguageStyleBit,
  aceDuoVocalLanguageStyleBit,
  lyricsForAceStepPreview,
  stripAceStageDirections,
} from "./lyrics.js";
import { isAceHostedAudioUrl } from "./gradio.js";
import {
  aceStepCommercialBandBits,
  aceStepSectionDynamicsLine,
  composeAceStepStyle,
  aceStepProductionQualityFloor,
} from "../../lib/musicLane.js";
import {
  normalizeFeatArtist,
  prepareAceStepLyrics,
  ensureAceStepDuoSingerTags,
  buildAceStepDuoStyle,
  vocalLockForArtist,
  vocalTimbreLine,
  resolveDuoLanguages,
} from "../../lib/featArtist.js";
import { normalizeMusicArrange } from "../../lib/musicArrange.js";

/** Force du source audio en mode cover (0 = texte seul, 1 = clone).
 * 0.5 = groove / structure du titre phare, paroles originales.
 * Duo : plus bas pour garder le groove SANS coller un 2e morceau mono-voix.
 */
export const ACE_STYLE_TRANSFER_STRENGTH = 0.5;
export const ACE_DUO_STYLE_TRANSFER_STRENGTH = 0.18;
/** Première version duo (f9f0bf6, 31 août) — avant baisse à 0.18. */
export const ACE_DUO_STYLE_TRANSFER_STRENGTH_INTRO = 0.22;

/** BPM max conseillé quand un feat doit rester audible (évite 172 Lose Yourself). */
export const ACE_DUO_BPM_CAP = 118;

/** Noise cover : solo stable ; duo intro (0.5) puis actuel (0.28). */
export const ACE_COVER_NOISE_SOLO = 0.35;
export const ACE_COVER_NOISE_DUO_INTRO = 0.5;
export const ACE_COVER_NOISE_DUO = 0.28;

/** Plage durée titres complets (secondes) — hits radio typiques. */
export const ACE_FULL_DURATION_MIN = 140; // ~2:20
export const ACE_FULL_DURATION_MAX = 250; // ~4:10

/**
 * Durée ACE-Step : preview courte, sinon explicite, sinon tirage commercial aléatoire.
 */
export function pickAceStepDurationSec({ preview = false, durationSec } = {}) {
  if (preview) {
    const n = Number(durationSec);
    return Math.min(45, Number.isFinite(n) && n > 0 ? Math.round(n) : 30);
  }
  const explicit = Number(durationSec);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.min(480, Math.max(60, Math.round(explicit)));
  }
  const span = ACE_FULL_DURATION_MAX - ACE_FULL_DURATION_MIN;
  return Math.round(ACE_FULL_DURATION_MIN + Math.random() * span);
}

/**
 * Snapshot compact des params envoyés à ACE (persisté sur la version pour QA Gemini).
 */
export function snapshotAceGenParams(body, extras = {}) {
  const b = body && typeof body === "object" ? body : {};
  const gpu = extras.gpu && typeof extras.gpu === "object" ? extras.gpu : null;
  return {
    at: new Date().toISOString(),
    lab: Boolean(extras.lab),
    duo: Boolean(extras.duo),
    model: String(extras.modelId || b.ditModel || "").trim() || null,
    pickReason: extras.pickReason || null,
    taskType: String(b.taskType || "text2music").slice(0, 32),
    inferenceSteps: b.inferenceSteps ?? null,
    guidanceScale: b.guidanceScale ?? null,
    durationSec: b.duration ?? null,
    bpm: b.bpm ?? null,
    vocalLanguage: b.vocalLanguage || null,
    audioFormat: b.audioFormat || null,
    enableNormalization: b.enableNormalization ?? null,
    normalizationDb: b.normalizationDb ?? null,
    mp3Bitrate: b.mp3Bitrate || null,
    usedReference: Boolean(b.referenceAudioUrl || b.sourceAudioUrl),
    referenceAudioTitle: b.referenceAudioTitle || null,
    audioCoverStrength: b.audioCoverStrength ?? null,
    coverNoiseStrength: b.coverNoiseStrength ?? null,
    style: String(b.style || "").slice(0, 900) || null,
    lyrics: String(b.lyrics || b.prompt || "").slice(0, 2500) || null,
    instruction: b.instruction ? String(b.instruction).slice(0, 400) : null,
    gpu: gpu
      ? {
          name: gpu.name || null,
          usedGb: gpu.usedGb ?? null,
          freeGb: gpu.freeGb ?? null,
          totalGb: gpu.totalGb ?? null,
        }
      : null,
  };
}

function labOverrideNumber(raw, { min, max, integer = false } = {}) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  let v = integer ? Math.round(n) : n;
  if (Number.isFinite(min)) v = Math.max(min, v);
  if (Number.isFinite(max)) v = Math.min(max, v);
  return v;
}

/**
 * Body lab : style/paroles bruts + overrides manuels (steps/CFG/cover).
 * Sans override → defaults du DiT (`aceStepInferenceForModel`).
 */
export function buildLabAceStepBody({
  title,
  style,
  lyrics,
  language = "en",
  bpm,
  preview = false,
  durationSec,
  referenceAudioUrl,
  referenceAudioTitle,
  audioCoverStrength,
  modelId,
  overrides = null,
} = {}) {
  const o = overrides && typeof overrides === "object" ? overrides : {};
  const infer = aceStepInferenceForModel(modelId);
  const styleFinal = String(style || "").trim().slice(0, 2000) || "pop music";
  const lyricsClean = String(lyrics || "").trim().slice(0, 8000);
  const langCode = resolveAceVocalLanguage(language, lyricsClean);
  const styleWithLang = [aceVocalLanguageStyleBit(langCode), styleFinal]
    .filter(Boolean)
    .join(". ")
    .slice(0, 2000);
  const steps =
    labOverrideNumber(o.inferenceSteps, { min: 1, max: 200, integer: true }) ??
    infer.inferenceSteps;
  const guidance =
    labOverrideNumber(o.guidanceScale, { min: 0, max: 20 }) ?? infer.guidanceScale;
  const coverDefault =
    labOverrideNumber(o.audioCoverStrength, { min: 0.05, max: 1 }) ??
    labOverrideNumber(audioCoverStrength, { min: 0.05, max: 1 }) ??
    ACE_STYLE_TRANSFER_STRENGTH;
  const noiseDefault =
    labOverrideNumber(o.coverNoiseStrength, { min: 0, max: 1 }) ?? ACE_COVER_NOISE_SOLO;

  const body = {
    customMode: true,
    title: String(preview ? `${title || "LAB"} · extrait` : title || "ACE Lab").slice(0, 120),
    style: styleWithLang,
    lyrics: lyricsClean,
    prompt: lyricsClean,
    instrumental: !lyricsClean,
    vocalLanguage: langCode,
    duration: pickAceStepDurationSec({
      preview,
      durationSec: preview ? 30 : durationSec,
    }),
    bpm: Number.isFinite(Number(bpm))
      ? Math.min(200, Math.max(60, Math.round(Number(bpm))))
      : undefined,
    inferenceSteps: steps,
    guidanceScale: guidance,
    ditModel: modelId || undefined,
    audioFormat: String(o.audioFormat || "mp3").slice(0, 8),
    enableNormalization: o.enableNormalization === false ? false : true,
    normalizationDb:
      labOverrideNumber(o.normalizationDb, { min: -12, max: 0 }) ?? ACE_NORMALIZATION_DB,
    mp3Bitrate: String(o.mp3Bitrate || "320k").slice(0, 8),
    randomSeed: o.randomSeed === false ? false : true,
    pollinations: { enabled: false },
  };
  const seed = labOverrideNumber(o.seed, { integer: true });
  if (seed != null && body.randomSeed === false) {
    body.seed = seed;
  }

  const refUrl = String(referenceAudioUrl || "").trim();
  if (/^https?:\/\//i.test(refUrl)) {
    body.referenceAudioUrl = refUrl;
    body.sourceAudioUrl = refUrl;
    const refTitle = String(referenceAudioTitle || "").trim();
    if (refTitle) body.referenceAudioTitle = refTitle.slice(0, 160);
    body.audioCoverStrength = coverDefault;
    body.coverNoiseStrength = noiseDefault;
    body.taskType = String(o.taskType || "cover").slice(0, 32);
  }
  return body;
}

export function buildAceStepBody({
  title,
  style,
  lyrics,
  language = "fr",
  bpm,
  durationSec,
  modelId,
  preview = false,
  referenceAudioUrl,
  referenceAudioTitle,
  audioCoverStrength,
  studioBase,
  styleLock,
  artist = null,
  featArtist = null,
}) {
  const infer = aceStepInferenceForModel(modelId);
  const duration = pickAceStepDurationSec({ preview, durationSec });
  let refUrl = String(referenceAudioUrl || "").trim();
  if (isAceHostedAudioUrl(studioBase, refUrl)) refUrl = "";

  const lead = artist && typeof artist === "object" ? artist : null;
  const feat = normalizeFeatArtist(featArtist || lead?.featArtist);
  const isDuo = Boolean(feat?.name);
  const sameSexDuo = Boolean(
    isDuo &&
      vocalLockForArtist(lead)?.genderCode &&
      vocalLockForArtist(feat)?.genderCode &&
      vocalLockForArtist(lead).genderCode === vocalLockForArtist(feat).genderCode,
  );
  const lyricsRaw = stripAceStageDirections(
    String(preview ? lyricsForAceStepPreview(lyrics) : lyrics || ""),
  );
  let lyricsClean = isDuo
    ? prepareAceStepLyrics(lyricsRaw, lead || { name: "Lead" }, feat)
    : lyricsRaw;
  if (isDuo) {
    lyricsClean = ensureAceStepDuoSingerTags(lyricsClean, lead || { name: "Lead" }, feat);
  }

  const strengthNum = Number(audioCoverStrength);
  const defaultStrength = isDuo ? ACE_DUO_STYLE_TRANSFER_STRENGTH : ACE_STYLE_TRANSFER_STRENGTH;
  const strength = Number.isFinite(strengthNum)
    ? Math.min(1, Math.max(0.05, strengthNum))
    : defaultStrength;

  let bpmOut = Number.isFinite(Number(bpm))
    ? Math.min(200, Math.max(60, Math.round(Number(bpm))))
    : undefined;
  if (isDuo && bpmOut != null && bpmOut > ACE_DUO_BPM_CAP) {
    bpmOut = ACE_DUO_BPM_CAP;
  }

  const styleBase = String(style || "");
  // Duo : style dédié depuis les genres réels — jamais « male rap + female » hardcodé,
  // et on évite le DNA mono-voix du styleLock (Eminem, etc.).
  // Qualité de prod = plancher commun (genre/sexe changent le DNA, pas le polish).
  // Style proche du Lab : court, positif, genre + voix + langue.
  // Les litanie « no vocoder / no autotune » embrouillent ACE sans corriger la cause.
  const qualityFloor = aceStepProductionQualityFloor({ duo: isDuo });
  const sectionDynamics = aceStepSectionDynamicsLine({ duo: isDuo });
  const bandBits = aceStepCommercialBandBits(styleLock);
  const duoLangs = isDuo ? resolveDuoLanguages(lead, feat, language) : null;
  // API ACE = une seule vocalLanguage ; en bilingue on garde le lead + consignes style.
  const langCode = duoLangs?.bilingual
    ? duoLangs.leadLang
    : resolveAceVocalLanguage(language, lyricsClean);
  const langBit = duoLangs?.bilingual
    ? aceDuoVocalLanguageStyleBit(duoLangs.leadLang, duoLangs.featLang)
    : aceVocalLanguageStyleBit(langCode);
  const leadLock = vocalLockForArtist(lead);
  const STYLE_CAP = 850;
  let styleFinal;
  if (isDuo) {
    const duoStyle = buildAceStepDuoStyle(lead || { name: "Lead" }, feat, {
      genreSummary: styleLock?.genreSummary || lead?.genre,
      mood: styleLock?.mood || lead?.mood,
      styleLock,
      styleBase,
    });
    // Casting duo d’abord (critique), puis dynamics — troncature en fin.
    styleFinal = [
      langBit,
      duoStyle || composeAceStepStyle(styleBase, styleLock),
      sectionDynamics,
      ...bandBits.slice(0, 1),
      qualityFloor,
    ]
      .filter(Boolean)
      .join(". ")
      .slice(0, STYLE_CAP);
  } else {
    const gender =
      leadLock?.genderCode === "female"
        ? "female lead vocal"
        : leadLock?.genderCode === "male"
          ? "male lead vocal"
          : "lead vocal";
    const genre =
      String(styleLock?.genreSummary || lead?.genre || styleBase || "pop")
        .trim()
        .slice(0, 120) || "pop";
    const mood =
      String(styleLock?.mood || lead?.mood || "").trim().slice(0, 60);
    const arrange = normalizeMusicArrange(lead?.musicArrange);
    const instruFromLock = Array.isArray(styleLock?.instruments)
      ? styleLock.instruments
          .map((x) => String(x || "").trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];
    if (arrange.leadInstrument && !instruFromLock.includes(arrange.leadInstrument)) {
      instruFromLock.unshift(arrange.leadInstrument);
    }
    const instru = instruFromLock.slice(0, 5).join(", ");
    const timbre = vocalTimbreLine(leadLock);
    const densityBit =
      arrange.density === "dense"
        ? "rich arrangement with clear space for the lead vocal"
        : arrange.density === "sparse"
          ? "intimate arrangement with air around the lead vocal"
          : "open mix, lead vocal prominent over the band";
    const featureBit = Array.isArray(arrange.features)
      ? arrange.features.filter(Boolean).slice(0, 3).join(", ")
      : "";
    // Dynamics tôt après identité, avant polish (troncature en fin).
    styleFinal = [
      `${genre}, ${gender}`,
      langBit,
      sectionDynamics,
      mood || null,
      densityBit,
      instru ? `instruments: ${instru}` : null,
      featureBit || null,
      timbre ? `voice: ${timbre}`.slice(0, 80) : null,
      ...bandBits.slice(0, 1),
      qualityFloor,
    ]
      .filter(Boolean)
      .join(". ")
      .slice(0, STYLE_CAP);
  }

  let steps = infer.inferenceSteps;
  let guidance = infer.guidanceScale;
  // Duo same-sex sur SFT : un peu plus de steps ; CFG plafonné (CFG trop haut → voix saturée).
  if (sameSexDuo && !infer.isTurbo) {
    steps = Math.max(Number(steps) || 50, 60);
    guidance = Math.min(6.0, Math.max(Number(guidance) || ACE_SFT_GUIDANCE, ACE_SFT_GUIDANCE));
  }

  const body = {
    customMode: true,
    title: String(preview ? `${title || "SONOZZ"} · extrait` : title || "SONOZZ Track").slice(0, 120),
    style: styleFinal,
    lyrics: lyricsClean.slice(0, 8000),
    // ACE Studio captions = `style` ; `prompt` est un alias UI des paroles — on aligne sur lyrics.
    prompt: lyricsClean.slice(0, 8000),
    instrumental: false,
    vocalLanguage: langCode,
    duration,
    bpm: bpmOut,
    inferenceSteps: steps,
    guidanceScale: guidance,
    ditModel: modelId || undefined,
    audioFormat: "mp3",
    enableNormalization: true,
    normalizationDb: ACE_NORMALIZATION_DB,
    mp3Bitrate: "320k",
    randomSeed: true,
    pollinations: { enabled: false },
  };
  if (/^https?:\/\//i.test(refUrl)) {
    body.referenceAudioUrl = refUrl;
    body.sourceAudioUrl = refUrl;
    const refTitle = String(referenceAudioTitle || "").trim();
    if (refTitle) body.referenceAudioTitle = refTitle.slice(0, 160);
    body.audioCoverStrength = strength;
    // Noise bas en duo : trop haut → ACE remix « 2 titres en même temps ».
    body.coverNoiseStrength = isDuo ? ACE_COVER_NOISE_DUO : ACE_COVER_NOISE_SOLO;
    body.taskType = "cover";
    body.instruction = isDuo
      ? "ONE coherent duet song: balanced mix with headroom (no clipping, no brickwall limiting); lead vocals prominent and clear with space; chorus instrumentation lifts vs verse (thicker bed, wider snare); bridge contrasts; final chorus biggest; keep groove/BPM energy from the reference only; do NOT clone its single-singer performance; obey [singer 1]/[singer 2] tags; same production lane intro→outro; never glue two different songs or switch genre mid-track; full band, not a cappella:"
      : "Generate a polished commercial song with multi-instrument arrangement and dynamic section changes (not a flat loop); chorus instrumentation lifts vs verse; bridge contrasts; final chorus biggest; lead vocal prominent and clear; instrumental mix with ample space for the vocal; warm organic textures; leave peak headroom, avoid clipping and harsh brickwall limiting:";
    if (!infer.isTurbo && (body.guidanceScale == null || body.guidanceScale < ACE_SFT_GUIDANCE)) {
      body.guidanceScale = ACE_SFT_GUIDANCE;
    }
  }
  return body;
}
