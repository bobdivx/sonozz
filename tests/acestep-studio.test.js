import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAceStepBody,
  extractGradioUploadUrl,
  gradioFileUrl,
  interpretAceProbe,
  isAceHostedAudioUrl,
  isGradioReferenceCacheError,
  isUnusableAceReferenceError,
  looksLikeAudioBuffer,
  lyricsForAceStepPreview,
  pickAceStepModel,
  pickAceStepDurationSec,
  ACE_FULL_DURATION_MIN,
  ACE_FULL_DURATION_MAX,
  aceStepVramHeadroomGb,
  aceStepMinResidentVramGb,
  isAceStepGhostLoad,
  aceStepDitSame,
  aceStepInferenceForModel,
  buildLabAceStepBody,
  ACE_COVER_NOISE_SOLO,
  ACE_DUO_STYLE_TRANSFER_STRENGTH_INTRO,
  resolveAceAudioUrl,
  resolveAceStepBaseUrl,
  resolveAceStepGradioUrl,
  gradioUploadBases,
  isAceStepMusicProvider,
} from "../src/server/aceStep.js";
import { isStudioEnabled, keysAfterStudioToggle } from "../src/lib/keys.js";

describe("ACE-Step Studio client", () => {
  it("aligne steps/CFG sur le DiT chargé (pas SFT sur Turbo)", () => {
    assert.equal(aceStepDitSame("acestep-v15-xl-sft", "org/acestep-v15-xl-sft"), true);
    assert.equal(aceStepDitSame("acestep-v15-xl-sft", "acestep-v15-xl-turbo-bf16"), false);
    const turbo = aceStepInferenceForModel("acestep-v15-xl-turbo-bf16");
    assert.equal(turbo.inferenceSteps, 8);
    assert.equal(turbo.guidanceScale, 0);
    assert.equal(turbo.isTurbo, true);
    const sft = aceStepInferenceForModel("acestep-v15-xl-sft");
    assert.equal(sft.inferenceSteps, 50);
    assert.equal(sft.guidanceScale, 5.5);
    assert.equal(sft.isTurbo, false);
    const body = buildAceStepBody({
      title: "t",
      style: "pop",
      lyrics: "hello",
      modelId: "acestep-v15-xl-turbo-bf16",
    });
    assert.equal(body.inferenceSteps, 8);
    assert.equal(body.guidanceScale, 0);
  });

  it("lab body : overrides manuels + défauts historiques", () => {
    const auto = buildLabAceStepBody({
      title: "lab",
      style: "pop",
      lyrics: "hi",
      modelId: "acestep-v15-xl-turbo-bf16",
      preview: true,
    });
    assert.equal(auto.inferenceSteps, 8);
    assert.equal(auto.guidanceScale, 0);
    assert.equal(auto.taskType, undefined);
    assert.equal(auto.enableNormalization, true);
    assert.equal(auto.normalizationDb, -2.5);
    assert.equal(auto.mp3Bitrate, "320k");

    const forced = buildLabAceStepBody({
      title: "lab",
      style: "pop",
      lyrics: "hi",
      modelId: "acestep-v15-xl-turbo-bf16",
      preview: true,
      referenceAudioUrl: "https://cdn.example/a.mp3",
      overrides: {
        inferenceSteps: 12,
        guidanceScale: 1.5,
        audioCoverStrength: ACE_DUO_STYLE_TRANSFER_STRENGTH_INTRO,
        coverNoiseStrength: 0.5,
      },
    });
    assert.equal(forced.inferenceSteps, 12);
    assert.equal(forced.guidanceScale, 1.5);
    assert.equal(forced.audioCoverStrength, 0.22);
    assert.equal(forced.coverNoiseStrength, 0.5);
    assert.equal(forced.taskType, "cover");
    assert.equal(ACE_COVER_NOISE_SOLO, 0.35);
  });

  it("résout l’URL et le provider", () => {
    assert.equal(resolveAceStepBaseUrl({}), "https://ace.briseteia.me");
    assert.equal(
      resolveAceStepBaseUrl({ aceStepBaseUrl: "http://10.1.0.88:3001/" }),
      "http://10.1.0.88:3001",
    );
    assert.equal(isAceStepMusicProvider({ musicProvider: "acestep" }), true);
    assert.equal(isAceStepMusicProvider({ musicProvider: "songgen" }), false);
    assert.equal(
      isAceStepMusicProvider({ musicProvider: "acestep", aceStepEnabled: "0" }),
      false,
    );
  });

  it("préfixe les URLs audio relatives", () => {
    assert.equal(
      resolveAceAudioUrl("http://127.0.0.1:3001", "/audio/u/song.mp3"),
      "http://127.0.0.1:3001/audio/u/song.mp3",
    );
    assert.equal(
      resolveAceAudioUrl("http://127.0.0.1:3001", "https://cdn.example/a.mp3"),
      "https://cdn.example/a.mp3",
    );
  });

  it("choisit le modèle : préférence SFT > actif > turbo bf16", () => {
    const models = [
      { id: "acestep-v15-xl-turbo", isPreloaded: true, isActive: false },
      { id: "marcorez8/acestep-v15-xl-turbo-bf16", isPreloaded: true, isActive: false },
      { id: "acestep-v15-xl-sft", isPreloaded: false, isActive: false },
    ];
    assert.equal(
      pickAceStepModel({ models, activeModel: "acestep-v15-xl-turbo" }, {}).modelId,
      "acestep-v15-xl-turbo",
    );
    assert.equal(
      pickAceStepModel({ models }, { preferredId: "acestep-v15-xl-sft" }).modelId,
      "acestep-v15-xl-sft",
    );
    assert.equal(
      pickAceStepModel({ models }, { preferredId: "acestep-v15-xl-sft" }).needsResidentGate,
      true,
    );
    assert.equal(
      pickAceStepModel({ models }, {}).modelId,
      "marcorez8/acestep-v15-xl-turbo-bf16",
    );
  });

  it("calibre la marge VRAM selon le DiT", () => {
    assert.equal(aceStepVramHeadroomGb("marcorez8/acestep-v15-xl-turbo-bf16"), 2.5);
    assert.equal(aceStepVramHeadroomGb("acestep-v15-xl-sft"), 4);
    assert.equal(aceStepVramHeadroomGb("acestep-v15-xl-turbo-bf16"), 2.5);
    assert.equal(aceStepMinResidentVramGb("acestep-v15-xl-turbo-bf16"), 3.5);
    assert.ok(aceStepMinResidentVramGb("acestep-v15-xl-sft") >= 10);
    assert.ok(aceStepMinResidentVramGb("acestep-v15-xl-sft") < 14);
    assert.equal(
      isAceStepGhostLoad({ usedGb: 1.1, totalGb: 24 }, "acestep-v15-xl-turbo-bf16"),
      true,
    );
    assert.equal(
      isAceStepGhostLoad({ usedGb: 13.2, totalGb: 24 }, "acestep-v15-xl-turbo-bf16"),
      false,
    );
    // SFT chunked FFN ~12 Go = résident (plus le vieux seuil 14)
    assert.equal(
      isAceStepGhostLoad({ usedGb: 11.9, totalGb: 24 }, "acestep-v15-xl-sft", {
        offloadToCpu: false,
      }),
      false,
    );
    assert.equal(
      isAceStepGhostLoad({ usedGb: 5, totalGb: 24 }, "acestep-v15-xl-sft"),
      true,
    );
    assert.equal(
      isAceStepGhostLoad({ usedGb: 18, totalGb: 24 }, "acestep-v15-xl-sft"),
      false,
    );
    assert.equal(
      isAceStepGhostLoad({ usedGb: 20, totalGb: 24 }, "x", { offloadToCpu: true }),
      true,
    );
  });

  it("waitForAceStepResidentVram est exporté", async () => {
    const { waitForAceStepResidentVram } = await import("../src/server/aceStep.js");
    assert.equal(typeof waitForAceStepResidentVram, "function");
  });

  it("ignore Merge (fantôme UI) et liste les DiT Gradio", async () => {
    const { isAceStepEngineDit, pickAceStepModel: pick } = await import("../src/server/aceStep.js");
    assert.equal(isAceStepEngineDit("acestep-v15-xl-sft"), true);
    assert.equal(isAceStepEngineDit("acestep-v15-xl-merge-sft-turbo"), false);
    const models = [
      { id: "acestep-v15-xl-merge-sft-turbo", isPreloaded: true, engineKnown: false },
      { id: "acestep-v15-xl-turbo-bf16", isPreloaded: true, engineKnown: true },
      { id: "acestep-v15-xl-sft", isPreloaded: true, engineKnown: true },
    ];
    assert.equal(
      pick({ models }, { preferredId: "acestep-v15-xl-merge-sft-turbo" }).modelId,
      "acestep-v15-xl-turbo-bf16",
    );
  });

  it("tronque les paroles preview et calibre Turbo vs SFT", () => {
    const long = Array.from({ length: 30 }, (_, i) => `ligne ${i + 1}`).join("\n");
    const preview = lyricsForAceStepPreview(long);
    assert.equal(preview.split("\n").length, 16);

    const turbo = buildAceStepBody({
      title: "Test",
      style: "pop, female vocal",
      lyrics: long,
      language: "fr",
      bpm: 118,
      modelId: "acestep-v15-xl-turbo",
      preview: true,
    });
    assert.equal(turbo.customMode, true);
    assert.equal(turbo.instrumental, false);
    assert.equal(turbo.vocalLanguage, "fr");
    assert.equal(turbo.inferenceSteps, 8);
    assert.equal(turbo.guidanceScale, 0);
    assert.ok(turbo.duration <= 45);
    assert.ok(turbo.lyrics.split("\n").length <= 16);

    const sft = buildAceStepBody({
      title: "Test",
      style: "pop",
      lyrics: "hello",
      language: "en",
      modelId: "acestep-v15-xl-sft",
      preview: false,
    });
    assert.equal(sft.inferenceSteps, 50);
    assert.equal(sft.guidanceScale, 5.5);
    assert.equal(sft.enableNormalization, true);
    assert.equal(sft.normalizationDb, -2.5);
    assert.equal(sft.mp3Bitrate, "320k");
    assert.match(sft.style, /NOT one flat loop|thick chorus|chorus thicker than verse|dry clear lead vocal/i);
    assert.ok(sft.duration >= ACE_FULL_DURATION_MIN && sft.duration <= ACE_FULL_DURATION_MAX);
    assert.equal(sft.referenceAudioUrl, undefined);
    assert.equal(sft.taskType, undefined);

    const fixed = buildAceStepBody({
      title: "Test",
      style: "pop",
      lyrics: "hello",
      language: "en",
      modelId: "acestep-v15-xl-sft",
      durationSec: 200,
    });
    assert.equal(fixed.duration, 200);
  });

  it("tire une durée commerciale aléatoire si non fournie", () => {
    assert.equal(pickAceStepDurationSec({ preview: true }), 30);
    assert.equal(pickAceStepDurationSec({ preview: false, durationSec: 195 }), 195);
    const a = pickAceStepDurationSec({ preview: false });
    const b = pickAceStepDurationSec({ preview: false });
    assert.ok(a >= ACE_FULL_DURATION_MIN && a <= ACE_FULL_DURATION_MAX);
    assert.ok(b >= ACE_FULL_DURATION_MIN && b <= ACE_FULL_DURATION_MAX);
  });

  it("indie pop organique : voix dry courte, pas de pavé conversational → vocoder", () => {
    const body = buildAceStepBody({
      title: "Echoes in the Haze",
      style: "indie pop",
      lyrics: "[Verse]\nHaze in the street",
      language: "en",
      modelId: "acestep-v15-xl-turbo",
      styleLock: {
        genreSummary: "Indie Pop",
        vocalStyle: "warm baritone melodic, conversational",
        timbre: "warm baritone melodic, conversational",
        instruments: ["acoustic guitar", "soft drums", "bass", "pads"],
        mood: "hazy",
      },
      artist: {
        name: "Haze",
        gender: "male",
        genre: "Indie Pop",
        musicArrange: {
          leadInstrument: "acoustic guitar",
          density: "sparse",
          features: ["fingerpicked guitar"],
        },
        styleLock: {
          vocalStyle: "warm baritone melodic, conversational",
          timbre: "warm baritone melodic, conversational",
        },
      },
    });
    assert.match(body.style, /clear natural male vocal/i);
    assert.ok(body.style.length <= 700, `style trop long: ${body.style.length}`);
    assert.match(body.style, /full band always|never drums-only/i);
    assert.match(body.style, /NOT one flat loop|guitar\+bass|biggest final chorus/i);
    assert.match(body.style, /dry clear lead vocal|light compression|natural dynamics/i);
    assert.match(body.style, /fingerpicked guitar|acoustic guitar/i);
    assert.doesNotMatch(body.style, /conversational/i);
    assert.doesNotMatch(body.style, /no vocoder|no autotune/i);
    assert.match(body.instruction, /never drums-only|Full multi-instrument/i);
  });

  it("envoie le preview titre phare en cover (source + référence)", () => {
    const body = buildAceStepBody({
      title: "Vile Adulteress",
      style: "brutal death metal",
      lyrics: "[Verse]\nFlesh",
      language: "en",
      bpm: 170,
      modelId: "acestep-v15-xl-sft",
      referenceAudioUrl: "https://audio.example/condemnation.m4a",
      referenceAudioTitle: "Condemnation Contagion — Cannibal Corpse",
    });
    assert.equal(body.customMode, true);
    assert.equal(body.taskType, "cover");
    assert.equal(body.referenceAudioUrl, "https://audio.example/condemnation.m4a");
    assert.equal(body.sourceAudioUrl, "https://audio.example/condemnation.m4a");
    assert.match(body.referenceAudioTitle, /Condemnation Contagion/);
    assert.equal(body.audioCoverStrength, 0.5);
    assert.equal(body.coverNoiseStrength, 0.35);
    assert.equal(body.guidanceScale, 5.5);
    assert.equal(body.enableNormalization, true);
    assert.equal(body.normalizationDb, -2.5);
    assert.equal(body.mp3Bitrate, "320k");
    assert.match(body.instruction, /peak headroom|no clipping|full band mix|polished commercial/i);
    assert.match(body.instruction, /chorus instrumentation lifts|final chorus biggest/i);
    assert.match(body.style, /section dynamics|thicker chorus|chorus lift|chorus thicker than verse|dry clear lead vocal/i);

    const turbo = buildAceStepBody({
      title: "Echoes",
      style: "metal ballad",
      lyrics: "x",
      language: "en",
      modelId: "marcorez8/acestep-v15-xl-turbo-bf16",
      referenceAudioUrl: "https://audio.example/nem.m4a",
    });
    assert.equal(turbo.taskType, "cover");
    assert.equal(turbo.guidanceScale, 0);
    assert.equal(turbo.inferenceSteps, 8);

    const viaGradio = buildAceStepBody({
      title: "Vile Adulteress",
      style: "brutal death metal",
      lyrics: "x",
      language: "en",
      studioBase: "http://127.0.0.1:3001",
      referenceAudioUrl: "http://127.0.0.1:8001/gradio_api/file=/tmp/gradio/hash/style-ref.mp3",
      referenceAudioTitle: "Condemnation Contagion",
    });
    assert.match(viaGradio.referenceAudioUrl, /gradio_api\/file=/);
    assert.equal(viaGradio.sourceAudioUrl, viaGradio.referenceAudioUrl);
    assert.equal(viaGradio.taskType, "cover");
    assert.match(viaGradio.style, /brutal death metal/i);
    assert.doesNotMatch(viaGradio.style, /Florida|George Fisher/i);
  });

  it("refuse les URLs ACE /audio/ (Gradio 5 InvalidPathError)", () => {
    const studio = "http://127.0.0.1:3001";
    assert.equal(isAceHostedAudioUrl(studio, "/audio/u/ref.mp3"), true);
    assert.equal(
      isAceHostedAudioUrl(studio, "http://127.0.0.1:3001/audio/1787059803049-9af11083.mp3"),
      true,
    );
    assert.equal(
      isAceHostedAudioUrl(studio, "https://audio-ssl.itunes.apple.com/preview.m4a"),
      false,
    );
    assert.equal(
      isAceHostedAudioUrl(studio, "http://127.0.0.1:8001/gradio_api/file=/tmp/gradio/x.mp3"),
      false,
    );

    const body = buildAceStepBody({
      title: "Vile Adulteress",
      style: "death metal",
      lyrics: "x",
      language: "en",
      studioBase: studio,
      referenceAudioUrl: "http://127.0.0.1:3001/audio/ref.mp3",
      referenceAudioTitle: "local ACE",
    });
    assert.equal(body.referenceAudioUrl, undefined);
    assert.equal(body.taskType, undefined);
  });

  it("dérive l’URL Gradio :7865 (LAN) et parse l’upload officiel", () => {
    assert.equal(
      resolveAceStepGradioUrl({ aceStepBaseUrl: "http://10.1.0.88:3001" }),
      "http://10.1.0.88:7865",
    );
    assert.equal(
      resolveAceStepGradioUrl({ aceStepBaseUrl: "http://10.1.0.88:8001" }),
      "http://10.1.0.88:8001",
    );
    assert.deepEqual(gradioUploadBases({ aceStepBaseUrl: "https://ace.briseteia.me" }), [
      "https://ace.briseteia.me",
    ]);
    assert.equal(
      resolveAceStepGradioUrl({ aceStepGradioUrl: "http://127.0.0.1:7865" }),
      "http://127.0.0.1:7865",
    );
    assert.equal(
      gradioFileUrl("http://127.0.0.1:7865", "D:\\temp\\gradio\\a.mp3"),
      "http://127.0.0.1:7865/gradio_api/file=D:/temp/gradio/a.mp3",
    );
    assert.equal(
      extractGradioUploadUrl("http://127.0.0.1:7865", ["/tmp/gradio/hash/style-ref.mp3"]),
      "http://127.0.0.1:7865/gradio_api/file=/tmp/gradio/hash/style-ref.mp3",
    );
    assert.equal(
      extractGradioUploadUrl("http://127.0.0.1:7865", {
        url: "http://127.0.0.1:7865/gradio_api/file=/tmp/gradio/x.mp3",
      }),
      "http://127.0.0.1:7865/gradio_api/file=/tmp/gradio/x.mp3",
    );
    assert.equal(
      isGradioReferenceCacheError(
        "Cannot move D:\\pinokio\\api\\ACE-Step-Studio-pinokio.git\\app\\temp\\gradio\\ref-1\\x.mp3 to the gradio cache dir because it was not uploaded by a user.",
      ),
      true,
    );
    assert.equal(isGradioReferenceCacheError("VRAM OOM"), false);
    assert.equal(
      isUnusableAceReferenceError(
        "Gradio generation returned no audio files. Status: Reference audio is invalid, unreadable, or silent.",
      ),
      true,
    );
    assert.equal(isUnusableAceReferenceError("ACE_REF_UNUSABLE: foo"), true);
    const id3 = Buffer.alloc(5000, 0);
    id3[0] = 0x49;
    id3[1] = 0x44;
    id3[2] = 0x33;
    assert.equal(looksLikeAudioBuffer(id3, "audio/mpeg"), true);
    assert.equal(looksLikeAudioBuffer(Buffer.from("<!DOCTYPE html>....padding...."), "text/html"), false);
    assert.equal(looksLikeAudioBuffer(Buffer.alloc(100), "audio/mpeg"), false);
  });

  it("détecte ACE totalement injoignable vs moteur Python down", () => {
    const down = interpretAceProbe({
      base: "http://127.0.0.1:3001",
      health: { healthy: false, error: "ACE-Step Studio injoignable (http://127.0.0.1:3001) — délai dépassé" },
      status: {},
    });
    assert.equal(down.unreachable, true);

    const python = interpretAceProbe({
      health: { healthy: false },
      status: { connected: false, activeModel: "" },
    });
    assert.equal(python.unreachable, false);
    assert.equal(python.pipelineUp, false);
    assert.equal(python.loading, false);

    const loading = interpretAceProbe({
      health: { healthy: false },
      status: {
        state: "loading",
        model: "acestep-v15-xl-sft",
        connected: false,
        activeModel: "acestep-v15-xl-turbo-bf16",
      },
    });
    assert.equal(loading.loading, true);
    assert.equal(loading.unreachable, false);
    assert.match(loading.message, /Chargement XL SFT/i);
    assert.doesNotMatch(loading.message, /Stop puis Start/i);

    const readyHealthyOnly = interpretAceProbe({
      health: { healthy: true },
      status: { connected: false, activeModel: "" },
    });
    assert.equal(readyHealthyOnly.pipelineUp, true);
    assert.equal(readyHealthyOnly.message, null);

    const readyStale = interpretAceProbe({
      health: { healthy: false },
      status: {
        state: "ready",
        connected: false,
        activeModel: "acestep-v15-xl-turbo-bf16",
      },
    });
    assert.equal(readyStale.pipelineUp, true);
    assert.equal(readyStale.loading, false);
    assert.equal(readyStale.message, null);
  });

  it("toggle active/désactive un studio et bascule le moteur actif", () => {
    const base = { musicProvider: "acestep", aceStepEnabled: "1", songGenEnabled: "1", replicateEnabled: "1" };
    assert.equal(isStudioEnabled(base, "acestep"), true);
    const off = keysAfterStudioToggle(base, "acestep", false);
    assert.equal(off.aceStepEnabled, "0");
    assert.equal(off.musicProvider, "replicate");
    const on = keysAfterStudioToggle(off, "acestep", true);
    assert.equal(on.aceStepEnabled, "1");
  });
});
