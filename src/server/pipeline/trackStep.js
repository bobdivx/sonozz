import {
  generateMusicWithReplicate,
  startMinimaxMusic,
  pollMinimaxMusic,
  cancelMinimaxMusic,
} from "../replicate.js";
import {
  generateMusicWithSongGeneration,
  startSongGeneration,
  pollSongGeneration,
  isSongGenMusicProvider,
  resolveVocalGender,
} from "../songGeneration.js";
import {
  generateMusicWithAceStep,
  startAceStep,
  pollAceStep,
  cancelAceStep,
  isAceStepMusicProvider,
  resolveAceVocalLanguage,
} from "../aceStep.js";
import { isLanguageOkForProvider, songGenLanguageHint } from "../../lib/studio.js";
import {
  artefactGuardsFromLock,
  defaultBpmForGenre,
  isMetalLane,
  metalFlavorTags,
  metalVoiceHint,
  sectionDynamicsArrangeFragment,
  sectionDynamicsStyleTags,
  styleLockGenreBlob,
  withKnownArtistLane,
} from "../../lib/musicLane.js";
import { isStudioEnabled } from "../../lib/keys.js";
import {
  normalizeFeatArtist,
  duoVocalPromptBits,
  duoStylePromptBits,
  vocalLockForArtist,
  displayArtistCredit,
} from "../../lib/featArtist.js";
import {
  musicArrangeToSongGen,
  normalizeMusicArrange,
  musicArrangeFromStyleLock,
  isDefaultMusicArrange,
} from "../../lib/musicArrange.js";
import { buildSunoPrompt } from "../../lib/sunoPrompt.js";
import { resolveArtistGender, withResolvedArtistGender } from "../../lib/artistGender.js";
import {
  resolveLanguage,
  languagePromptName,
  genderVisualLock,
  waveform,
  persistGeneratedAudio,
} from "./util.js";

function buildTrackMusicPrompt({ lyrics, artist }) {
  const lang = resolveLanguage(lyrics?.language, artist);
  const langName = languagePromptName(lang);
  const genderLock = genderVisualLock(artist?.gender, artist?.age);
  const styleLock = withKnownArtistLane(artist?.styleLock);
  const vocal = resolveVocalGender(artist);
  const feat = normalizeFeatArtist(artist?.featArtist);
  const duoVocalBits = feat ? duoVocalPromptBits(artist, feat) : [];
  const duoStyleBits = feat ? duoStylePromptBits(artist, feat) : [];
  let arrange = normalizeMusicArrange(artist?.musicArrange);
  if (isDefaultMusicArrange(arrange) && styleLock) {
    arrange = musicArrangeFromStyleLock(styleLock);
  }
  const packed = musicArrangeToSongGen(arrange, {
    styleLockInstruments: styleLock?.instruments,
    styleLock,
  });
  const arrangeBits = packed.customFragments || [];
  const genreBlob = styleLockGenreBlob(styleLock, [artist?.genre, lyrics?.title, lyrics?.theme]);
  const metal = isMetalLane(genreBlob);
  // Arrangement (chœur…) EN TÊTE pour MiniMax aussi + qualité production
  const qualityBits = packed.gospel
    ? [
        "commercial contemporary gospel-soul production",
        "full band with choir, organ, piano, bass and drums",
        "radio-ready streaming quality",
        sectionDynamicsArrangeFragment(),
      ]
    : metal
      ? [
          ...metalFlavorTags(styleLock),
          ...artefactGuardsFromLock(styleLock),
          ...sectionDynamicsStyleTags(),
        ]
      : [
          "commercial radio-ready full-band production",
          "polished multi-instrument arrangement like a Billboard hit",
          "rich bass, harmony instruments, drums and pads — never thin or single-instrument",
          sectionDynamicsArrangeFragment(),
        ];

  // Scrub fuites de sexe opposé depuis la référence lead.
  // En duo : NE PAS scrubber — le feat peut être du sexe opposé et doit rester audible.
  const scrubVoiceLeak = (text) => {
    const raw = String(text || "");
    if (feat) return raw;
    if (vocal.code === "male") {
      return raw
        .replace(/\b(female|woman|women|girl|soprano|mezzo|alto|feminine)\b/gi, "male")
        .replace(/\bfemale vocals?\b/gi, "male vocals");
    }
    return raw
      .replace(/\b(male|man|men|boy|baritone|tenor|masculine)\b/gi, "female")
      .replace(/\bmale vocals?\b/gi, "female vocals");
  };

  const safeMusicPrompt = scrubVoiceLeak(styleLock?.musicPrompt || "");
  // Duo : raccourcir le DNA lead (Eminem) pour ne pas noyer la 2e voix.
  const musicPromptForGen = feat
    ? String(safeMusicPrompt).slice(0, 180)
    : safeMusicPrompt;
  const voiceLine = feat
    ? duoVocalBits[0] || "distinct two-singer duet"
    : metal
      ? metalVoiceHint(vocal.code, genreBlob, styleLock)
      : vocal.voiceHint;
  const banBits = (Array.isArray(styleLock?.doNot) ? styleLock.doNot : [])
    .slice(0, 4)
    .map((d) => `avoid ${d}`);

  const prompt = (
    musicPromptForGen
      ? metal
        ? [
            ...(feat ? duoVocalBits : []),
            styleLock?.genreSummary || artist?.genre || "metal",
            voiceLine,
            ...duoVocalBits.slice(feat ? 99 : 1),
            ...duoStyleBits,
            ...qualityBits,
            musicPromptForGen,
            ...banBits,
            `${artist?.mood || styleLock.mood || "aggressive"} mood`,
            `vocals and lyrics in ${langName}`,
            "original composition inspired by that lane, not a cover",
          ]
        : [
            ...(feat ? duoVocalBits : [vocal.voiceHint]),
            ...duoStyleBits,
            ...arrangeBits,
            ...qualityBits,
            musicPromptForGen,
            `${artist?.mood || styleLock.mood || "emotional"} mood`,
            `vocals and lyrics in ${langName}`,
            "original composition",
          ]
      : metal
        ? [
            ...(feat ? duoVocalBits : [voiceLine]),
            ...duoVocalBits.slice(feat ? 99 : 1),
            ...duoStyleBits,
            ...qualityBits,
            artist?.genre || styleLock?.genreSummary || "metal",
            artist?.styleArtists?.length
              ? `in the sonic lane of ${artist.styleArtists.join(" and ")} (original, not a cover)`
              : artist?.styleArtist
                ? `in the sonic lane of ${artist.styleArtist} (original, not a cover)`
                : "",
            `${artist?.mood || styleLock?.mood || "aggressive"} mood`,
            `vocals and lyrics in ${langName}`,
            "original composition, not a cover",
          ]
        : [
          ...(feat ? duoVocalBits : [vocal.voiceHint]),
          ...duoStyleBits,
          ...arrangeBits,
          ...qualityBits,
          packed.gospel ? "contemporary gospel soul R&B" : `${artist?.genre || "pop"}`,
          artist?.styleArtists?.length
            ? `in the sonic lane of ${artist.styleArtists.join(" and ")} (original, not a cover)`
            : artist?.styleArtist
              ? `in the sonic lane of ${artist.styleArtist} (original, not a cover)`
              : "",
          `${artist?.mood || (packed.gospel ? "uplifting" : "emotional")} mood`,
          feat ? null : vocal.voiceForPrompt,
          `vocals and lyrics in ${langName}`,
          "emotional hook, wide stereo mix",
        ]
  )
    .filter(Boolean)
    .join(", ");

  return { prompt, styleLock, genderLock, vocal, arrangeBpm: packed.bpm, arrange, packed, feat };
}

function assembleTrackResult({
  lyrics,
  artist,
  styleLock,
  bpmGuess,
  audioUrl = null,
  audioS3Key = null,
  provider = "brief",
  durationLabel = "3:24",
  hasVocals = false,
  warning,
  vocal = null,
  arrange = null,
}) {
  const lock = withKnownArtistLane(styleLock);
  let arr = arrange || normalizeMusicArrange(artist?.musicArrange);
  if (isDefaultMusicArrange(arr) && lock) {
    arr = musicArrangeFromStyleLock(lock);
  }
  const voice = vocal || resolveVocalGender(artist);
  const genreBlob = styleLockGenreBlob(lock, [artist?.genre, lyrics?.title]);
  const metal = isMetalLane(genreBlob);

  const sunoPrompt = buildSunoPrompt({
    lyrics,
    artist,
    styleLock: lock,
    bpmGuess,
    musicArrange: arr,
    // Duo : laisser buildSunoPrompt injecter les bits deux voix (pas d’override mono-sexe).
    vocalHint: normalizeFeatArtist(artist?.featArtist)
      ? null
      : metal
        ? metalVoiceHint(voice?.code, genreBlob, lock)
        : voice?.voiceHint,
  });

  const noteReady =
    provider === "acestep-studio"
      ? "Chanson générée via ACE-Step Studio (local)."
      : provider === "songgeneration-studio"
        ? "Chanson générée via SongGeneration Studio (LeVo local)."
        : hasVocals
          ? "Chanson générée via MiniMax Music 2.6 (voix + paroles)."
          : "Piste instrumentale (MusicGen) — pas de chant.";

  return {
    title: lyrics?.title || "Untitled Session",
    artist: displayArtistCredit(artist, artist?.featArtist),
    bpm: bpmGuess,
    key: ["Am", "Dm", "Em", "F", "Gm", "C"][Math.floor(Math.random() * 6)],
    duration: audioUrl ? durationLabel : "3:24",
    style: artist?.genre || "Pop",
    mood: artist?.mood || "emotional",
    status: audioUrl ? "audio-ready" : "prompt-ready",
    waveform: waveform(),
    audioUrl,
    audioS3Key: audioS3Key || undefined,
    provider,
    hasVocals,
    sunoPrompt,
    note: audioUrl
      ? noteReady
      : "Métadonnées + prompt Suno prêts — audio manquant jusqu’à import ou provider audio.",
    warning,
  };
}

/**
 * Démarre la gen audio sans bloquer (évite Cloudflare 524 / proxy ~100s).
 * Le client poll via pollTrack.
 */
export async function startTrack({ keys, lyrics, artist, preview = false, skipStyleReference = false, forceAceModelId = null }) {
  const resolvedGender = resolveArtistGender(artist);
  if (!resolvedGender) {
    throw new Error(
      "Sexe / présentation manquant sur l’artiste — ouvre Modifier le profil, choisis Homme/Femme, puis régénère avant le morceau.",
    );
  }
  artist = withResolvedArtistGender(artist);

  // Fige / backfill le timbre (extrait vocal ou dernier audio) avant le prompt.
  try {
    const { ensureTrackArtistsTimbre } = await import("./artistTimbre.js");
    const ensured = await ensureTrackArtistsTimbre(keys, artist);
    if (ensured?.artist) artist = ensured.artist;
    if (ensured?.report?.lead && !ensured.report.lead.skipped) {
      console.info("[timbre] lead", ensured.report.lead);
    }
    if (ensured?.report?.feat && !ensured.report.feat.skipped) {
      console.info("[timbre] feat", ensured.report.feat);
    }
  } catch (e) {
    console.warn("[timbre] pre-track:", e.message);
  }

  const lang = resolveAceVocalLanguage(
    lyrics?.language || artist?.language || "fr",
    lyrics?.text || "",
  );
  const songGenModel = keys?.songGenPreferredModel;
  const wantAceStep = isAceStepMusicProvider(keys);
  const wantSongGen = isSongGenMusicProvider(keys);
  const songGenNative = wantSongGen && isLanguageOkForProvider(lang, "songgen", songGenModel);
  const hasMinimax =
    isStudioEnabled(keys, "replicate") && Boolean(keys?.replicateApiToken?.trim());
  if (wantSongGen && !songGenNative && !hasMinimax) {
    throw new Error(
      `${songGenLanguageHint(songGenModel || "songgeneration_large")} Ajoute un token Replicate pour chanter cette langue, ou passe les paroles en anglais.`,
    );
  }
  const isPreview = Boolean(preview);
  const { prompt, styleLock, vocal, arrangeBpm, arrange, packed } = buildTrackMusicPrompt({
    lyrics,
    artist,
  });
  const lockBpm = Number(arrangeBpm ?? styleLock?.bpm);
  const bpmGuess =
    Number.isFinite(lockBpm) && lockBpm >= 60 && lockBpm <= 200
      ? Math.round(lockBpm)
      : defaultBpmForGenre(styleLockGenreBlob(styleLock, [artist?.genre]));
  const draft = assembleTrackResult({
    lyrics,
    artist,
    styleLock,
    bpmGuess,
    audioUrl: null,
    provider: "brief",
    vocal,
    packed,
    arrange,
  });

  if (wantAceStep) {
    const feat = normalizeFeatArtist(artist?.featArtist);
    const featVocal = feat ? vocalLockForArtist(feat) : null;
    // Preview Spotify/Deezer en taskType « cover » → bouillie (lab OK sans cover).
    // DNA = prompt texte (styleLock.musicPrompt), pas l’extrait catalogue.
    let bpmForAce = bpmGuess;
    if (feat && Number(bpmForAce) > 118) bpmForAce = 118;

    const started = await startAceStep(keys, {
      prompt,
      lyrics: lyrics?.text || "",
      title: lyrics?.title || artist?.name || "SONOZZ",
      language: lang,
      bpm: bpmForAce,
      preview: isPreview,
      referenceAudioUrl: "",
      referenceAudioTitle: "",
      styleLock,
      artist,
      forceModelId: String(forceAceModelId || "").trim() || null,
    });
    return {
      pollNeeded: true,
      musicKind: "acestep",
      generationId: started.generationId,
      provider: started.provider,
      preview: isPreview,
      model: started.model || null,
      quality: started.quality || null,
      pickReason: started.pickReason || null,
      gpu: started.gpu || null,
      draft: {
        ...draft,
        provider: started.provider,
        bpm: bpmForAce,
        voiceGender: feat
          ? `${vocal?.code || "lead"}+${featVocal?.genderCode || "feat"}`
          : vocal?.code,
        aceStepModel: started.model || null,
        aceStepQuality: started.quality || null,
        aceGen: started.aceGen || null,
        pickReason: started.pickReason || null,
        usedReference: Boolean(started.usedReference),
        language: lang,
        isPreview,
        status: isPreview ? "preview-ready" : "prompt-ready",
        note: isPreview
          ? `Extrait ACE-Step · ${started.quality || "auto"}${feat ? " · duo" : ""} — brouillon indicatif`
          : feat
            ? `ACE-Step · ${started.quality || started.model || "auto"} · duo ${displayArtistCredit(artist, feat)}`
            : started.model
              ? `ACE-Step · ${started.quality || started.model}`
              : draft.note,
      },
    };
  }

  if (wantSongGen && songGenNative) {
    const started = await startSongGeneration(keys, {
      prompt,
      lyrics: lyrics?.text || "",
      title: lyrics?.title || artist?.name || "SONOZZ",
      gender: vocal?.code || artist?.gender,
      artist,
      genre: artist?.genre || styleLock?.genre,
      mood: artist?.mood || styleLock?.mood,
      bpm: bpmGuess,
      preview: isPreview,
    });
    return {
      pollNeeded: true,
      musicKind: "songgen",
      generationId: started.generationId,
      provider: started.provider,
      preview: isPreview,
      draft: {
        ...draft,
        provider: started.provider,
        bpm: bpmGuess,
        voiceGender: started.gender || vocal?.code,
        songGenModel: started.model || null,
        songGenQuality: started.quality || null,
        isPreview,
        status: isPreview ? "preview-ready" : "prompt-ready",
        note: isPreview
          ? `Extrait SongGen · ${started.model || "auto"} — brouillon indicatif`
          : started.model
            ? `SongGen · ${started.model}${started.quality ? ` · ${started.quality}` : ""}`
            : draft.note,
      },
    };
  }

  if (hasMinimax) {
    const started = await startMinimaxMusic(keys.replicateApiToken.trim(), {
      prompt,
      lyrics: lyrics?.text || "",
      preview: isPreview,
    });
    return {
      pollNeeded: true,
      musicKind: "replicate",
      generationId: started.generationId,
      provider: started.provider,
      preview: isPreview,
      draft: {
        ...draft,
        provider: started.provider,
        bpm: bpmGuess,
        isPreview,
        status: isPreview ? "preview-ready" : "prompt-ready",
        note: wantSongGen && !songGenNative
          ? isPreview
            ? `Extrait MiniMax · ${lang} — SongGen Large ne chante pas cette langue`
            : `MiniMax · ${lang} (SongGen Large : anglais / chinois seulement)`
          : isPreview
            ? "Extrait MiniMax (paroles tronquées) — brouillon indicatif"
            : draft.note,
      },
    };
  }

  return {
    pollNeeded: false,
    ...assembleTrackResult({
      lyrics,
      artist,
      styleLock,
      bpmGuess,
      vocal,
      packed,
      arrange,
      warning:
        "Aucun provider audio — choisis ACE-Step / SongGeneration (local) ou un token Replicate dans Paramètres, ou importe un mp3.",
    }),
  };
}

/** Tick de poll court — à appeler depuis le client toutes les ~3 s. */
export async function pollTrack({ keys, generationId, musicKind, draft }) {
  const kind = String(musicKind || "").trim();
  let tick;
  if (kind === "acestep") {
    tick = await pollAceStep(keys, generationId);
  } else if (kind === "songgen") {
    tick = await pollSongGeneration(keys, generationId);
  } else if (kind === "replicate") {
    const token = keys?.replicateApiToken?.trim();
    if (!token) throw new Error("Token Replicate manquant pour le poll audio");
    tick = await pollMinimaxMusic(token, generationId);
  } else {
    throw new Error(`musicKind inconnu: ${kind || "(vide)"}`);
  }

  if (!tick.done) {
    const model =
      tick.model ||
      (kind === "acestep" ? draft?.aceStepModel : null) ||
      (kind === "songgen" ? draft?.songGenModel : null) ||
      null;
    return {
      done: false,
      status: tick.status,
      progress: tick.progress,
      message: tick.message || "",
      stage: tick.stage || null,
      gpu: tick.gpu || null,
      model,
      quality: draft?.aceStepQuality || draft?.songGenQuality || null,
      elapsedSeconds: tick.elapsedSeconds || 0,
      estimatedSeconds: tick.estimatedSeconds || 0,
      generationId,
      musicKind: kind,
    };
  }

  const base = draft && typeof draft === "object" ? draft : {};
  const isPreview = Boolean(base.isPreview);
  const persisted = await persistGeneratedAudio(
    tick.url,
    base.artist || "anon",
  );
  const track = {
    ...base,
    audioUrl: persisted.audioUrl,
    audioS3Key: persisted.audioS3Key || undefined,
    provider: tick.provider || base.provider,
    hasVocals: Boolean(tick.hasVocals),
    duration: isPreview
      ? tick.durationLabel || "~extrait"
      : tick.durationLabel || base.duration || "~2–4 min",
    status: isPreview ? "preview-ready" : "audio-ready",
    isPreview,
    note: isPreview
      ? "Extrait prêt — brouillon indicatif (le complet sera une nouvelle génération, mêmes réglages)."
      : tick.provider === "acestep-studio"
        ? "Chanson générée via ACE-Step Studio (local)."
        : tick.provider === "songgeneration-studio"
          ? "Chanson générée via SongGeneration Studio (LeVo local)."
          : "Chanson générée via MiniMax Music 2.6 (voix + paroles).",
    warning: undefined,
  };
  return { done: true, track, generationId, musicKind: kind };
}

/** Annule une génération audio en cours (Replicate) — SongGen : poll arrêté côté client. */
export async function cancelTrack({ keys, generationId, musicKind }) {
  const kind = String(musicKind || "").trim();
  const id = String(generationId || "").trim();
  if (!id) return { ok: false, skipped: true };
  if (kind === "replicate") {
    const token = keys?.replicateApiToken?.trim();
    if (!token) return { ok: false, skipped: true };
    return cancelMinimaxMusic(token, id);
  }
  if (kind === "acestep") {
    return cancelAceStep(keys, id);
  }
  return {
    ok: true,
    skipped: true,
    message: "Poll arrêté — SongGen peut finir en local",
  };
}

/** Sync (pipeline A→Z). Pour l’UI étape Track, préférer startTrack + pollTrack. */
export async function runTrack({ keys, lyrics, artist }) {
  const { prompt, styleLock, vocal, arrangeBpm, arrange, packed } = buildTrackMusicPrompt({
    lyrics,
    artist,
  });
  const lockBpm = Number(arrangeBpm ?? styleLock?.bpm);
  const bpmGuess =
    Number.isFinite(lockBpm) && lockBpm >= 60 && lockBpm <= 200
      ? Math.round(lockBpm)
      : defaultBpmForGenre(styleLockGenreBlob(styleLock, [artist?.genre]));

  let audioUrl = null;
  let provider = "brief";
  let warning;
  let durationLabel = "3:24";
  let hasVocals = false;

  if (isAceStepMusicProvider(keys)) {
    // Pas de cover auto catalogue (cf. startTrack) — texte DNA seulement.
    const result = await generateMusicWithAceStep(keys, {
      prompt,
      lyrics: lyrics?.text || "",
      title: lyrics?.title || artist?.name || "SONOZZ",
      language: resolveAceVocalLanguage(
        lyrics?.language || artist?.language || "fr",
        lyrics?.text || "",
      ),
      bpm: bpmGuess,
      referenceAudioUrl: "",
      referenceAudioTitle: "",
      styleLock,
      artist,
    });
    audioUrl = result.url;
    provider = result.provider;
    durationLabel = result.durationLabel || "~2–4 min";
    hasVocals = Boolean(result.hasVocals);
  } else if (isSongGenMusicProvider(keys)) {
    const result = await generateMusicWithSongGeneration(keys, {
      prompt,
      lyrics: lyrics?.text || "",
      title: lyrics?.title || artist?.name || "SONOZZ",
      gender: vocal?.code || artist?.gender,
      artist,
      genre: artist?.genre || styleLock?.genre,
      mood: artist?.mood || styleLock?.mood,
      bpm: bpmGuess,
    });
    audioUrl = result.url;
    provider = result.provider;
    durationLabel = result.durationLabel || "~2–4 min";
    hasVocals = Boolean(result.hasVocals);
  } else if (isStudioEnabled(keys, "replicate") && keys?.replicateApiToken?.trim()) {
    const result = await generateMusicWithReplicate(keys.replicateApiToken.trim(), {
      prompt,
      lyrics: lyrics?.text || "",
    });
    audioUrl = typeof result === "string" ? result : result.url;
    provider = typeof result === "string" ? "replicate" : result.provider;
    durationLabel = typeof result === "string" ? "~2–4 min" : result.durationLabel || "~2–4 min";
    hasVocals = typeof result === "string" ? true : Boolean(result.hasVocals);
    warning = typeof result === "string" ? undefined : result.warning;
  } else {
    warning =
      "Aucun provider audio — choisis ACE-Step / SongGeneration (local) ou un token Replicate dans Paramètres, ou importe un mp3.";
  }

  const persisted = await persistGeneratedAudio(
    audioUrl,
    artist?.slug || artist?.name || "anon",
  );

  return assembleTrackResult({
    lyrics,
    artist,
    styleLock,
    bpmGuess,
    audioUrl: persisted.audioUrl,
    audioS3Key: persisted.audioS3Key,
    provider,
    durationLabel,
    hasVocals,
    warning,
    vocal,
    packed,
    arrange,
  });
}
