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
  composeAceStepStyle,
  aceStepProductionQualityFloor,
  aceStepSectionDynamicsCompact,
  aceStepBandBedCompact,
} from "../../lib/musicLane.js";
import {
  normalizeFeatArtist,
  prepareAceStepLyrics,
  ensureAceStepDuoSingerTags,
  buildAceStepDuoStyle,
  vocalLockForArtist,
  aceLeadVocalPhrase,
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
    styleSource: extras.styleSource || b._styleSource || null,
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

/** Plafond caption ACE — au-delà = troncature / mur de bruit. */
export const ACE_STYLE_CAP = 700;

/**
 * Assemble le style ACE déterministe (squelette / fallback LLM).
 * @returns {{ style: string, langCode: string, duo: boolean, bilingual: boolean, brief: object }}
 */
export function assembleAceStepStyle({
  style = "",
  language = "fr",
  styleLock = null,
  artist = null,
  featArtist = null,
  lyrics = "",
} = {}) {
  const lead = artist && typeof artist === "object" ? artist : null;
  const feat = normalizeFeatArtist(featArtist || lead?.featArtist);
  const isDuo = Boolean(feat?.name);
  const styleBase = String(style || "");
  const lyricsClean = String(lyrics || "");
  const qualityFloor = aceStepProductionQualityFloor({ duo: isDuo });
  const sectionDyn = aceStepSectionDynamicsCompact({ duo: isDuo });
  const duoLangs = isDuo ? resolveDuoLanguages(lead, feat, language) : null;
  const langCode = duoLangs?.bilingual
    ? duoLangs.leadLang
    : resolveAceVocalLanguage(language, lyricsClean);
  const langBit = duoLangs?.bilingual
    ? aceDuoVocalLanguageStyleBit(duoLangs.leadLang, duoLangs.featLang)
    : aceVocalLanguageStyleBit(langCode);
  const leadLock = vocalLockForArtist(lead);

  let styleFinal;
  if (isDuo) {
    const duoStyle = buildAceStepDuoStyle(lead || { name: "Lead" }, feat, {
      genreSummary: styleLock?.genreSummary || lead?.genre,
      mood: styleLock?.mood || lead?.mood,
      styleLock,
      styleBase,
    });
    styleFinal = [langBit, duoStyle || composeAceStepStyle(styleBase, styleLock), qualityFloor]
      .filter(Boolean)
      .join(". ")
      .slice(0, ACE_STYLE_CAP);
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
    const mood = String(styleLock?.mood || lead?.mood || "")
      .trim()
      .slice(0, 40);
    const arrange = normalizeMusicArrange(lead?.musicArrange);
    const bandBed = aceStepBandBedCompact(styleLock, arrange);
    const densityBit =
      arrange.density === "dense"
        ? "rich full band; chorus denser than verse"
        : arrange.density === "sparse"
          ? "space around vocals but always guitar+bass+drums+keys; chorus adds layers"
          : "open mix; every section changes instrumentation, chorus thicker than verse";
    const finger =
      Array.isArray(arrange.features) && arrange.features.includes("fingerpicked guitar");
    const leadInstru = String(arrange.leadInstrument || "").trim();
    const leadInstruBit = finger
      ? "acoustic fingerpicked guitar audible in verses and choruses"
      : leadInstru
        ? `${leadInstru} audible throughout`
        : null;
    const voiceBit = aceLeadVocalPhrase(leadLock, genre);
    styleFinal = [
      `${genre}, ${gender}`,
      bandBed,
      langBit,
      voiceBit,
      sectionDyn,
      mood || null,
      densityBit,
      leadInstruBit,
      qualityFloor,
    ]
      .filter(Boolean)
      .join(". ")
      .slice(0, ACE_STYLE_CAP);
  }

  const brief = {
    duo: isDuo,
    bilingual: Boolean(duoLangs?.bilingual),
    leadLang: duoLangs?.leadLang || langCode,
    featLang: duoLangs?.featLang || null,
    lead: lead
      ? {
          name: lead.name,
          gender: leadLock?.genderCode || lead.gender,
          genre: styleLock?.genreSummary || lead.genre,
          mood: styleLock?.mood || lead.mood,
        }
      : null,
    feat: feat
      ? {
          name: feat.name,
          gender: vocalLockForArtist(feat)?.genderCode || feat.gender,
          genre: feat.genre,
          language: feat.language,
        }
      : null,
    instruments: Array.isArray(styleLock?.instruments)
      ? styleLock.instruments.slice(0, 6)
      : null,
    skeleton: styleFinal,
    maxChars: 650,
    mustKeep: [
      "full multi-instrument band",
      "never drums-only",
      "dry clear natural vocals",
      "section dynamics (verse lean → thicker chorus → bridge → biggest final chorus)",
      isDuo ? "singer 1 / singer 2 distinct" : "lead vocal clear",
      duoLangs?.bilingual ? `bilingual singer1=${duoLangs.leadLang} singer2=${duoLangs.featLang}` : null,
    ].filter(Boolean),
    avoid: [
      "vocoder",
      "heavy autotune",
      "digital distortion",
      "Sister Act essay",
      "conflicting multi-genre paragraphs",
      "truncated mid-sentence",
    ],
  };

  return {
    style: styleFinal,
    langCode,
    duo: isDuo,
    bilingual: Boolean(duoLangs?.bilingual),
    brief,
  };
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
  /** Caption déjà résolu (LLM ou squelette) — saute le ré-assemblage. */
  styleOverride = null,
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
  const assembled = assembleAceStepStyle({
    style: styleBase,
    language,
    styleLock,
    artist: lead,
    featArtist: feat,
    lyrics: lyricsClean,
  });
  const STYLE_CAP = ACE_STYLE_CAP;
  const styleFinal = String(styleOverride || assembled.style || "")
    .trim()
    .slice(0, STYLE_CAP);
  const langCode = assembled.langCode;

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
      ? "ONE coherent duet song: balanced mix with headroom (no clipping, no brickwall limiting); dry natural vocals prominent and clear with space; chorus instrumentation lifts vs verse (thicker bed, wider snare); bridge contrasts; final chorus biggest; keep groove/BPM energy from the reference only; do NOT clone its single-singer performance; obey [singer 1]/[singer 2] tags; same production lane intro→outro; never glue two different songs or switch genre mid-track; full band, not a cappella:"
      : "Generate a polished commercial song with multi-instrument arrangement and dynamic section changes (not a flat loop); chorus instrumentation lifts vs verse; bridge contrasts; final chorus biggest; dry natural lead vocal, clear diction, light compression; instrumental mix with ample space for the vocal; warm organic textures; leave peak headroom, avoid clipping and harsh brickwall limiting:";
    if (!infer.isTurbo && (body.guidanceScale == null || body.guidanceScale < ACE_SFT_GUIDANCE)) {
      body.guidanceScale = ACE_SFT_GUIDANCE;
    }
  } else {
    // text2music : consignes COURTES (pavés → mur de bruit ACE).
    body.instruction = isDuo
      ? "ONE clean duet song, full band (never drums-only); verses lean, chorus thicker; obey [singer 1]/[singer 2]; no digital distortion:"
      : "Full multi-instrument band (guitar, bass, drums, keys — never drums-only); verse lean → thicker chorus → thin bridge → biggest final chorus; no digital distortion:";
  }
  return body;
}
