import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  prepareAceStepLyrics,
  normalizeFeatArtist,
  ensureAceStepDuoSingerTags,
  buildAceStepDuoStyle,
} from "../src/lib/featArtist.js";
import { buildSunoPrompt } from "../src/lib/sunoPrompt.js";
import {
  buildAceStepBody,
  ACE_DUO_BPM_CAP,
  pickAceStepModel,
  isAceNanLatentsError,
  isAceVramError,
} from "../src/server/aceStep.js";

describe("prepareAceStepLyrics (duo)", () => {
  const lead = { name: "Jeser Mathieu", gender: "male" };
  const feat = normalizeFeatArtist({
    name: "ZAHRA",
    gender: "female",
    genre: "Afro-trap",
  });

  it("transforme (Nom) en tags male/female sans laisser les noms à chanter", () => {
    const raw = `[Verse]
(Jeser Mathieu)
Yo, concrete cracks beneath my worn-out soles,

[Verse]
(ZAHRA)
Ay, feel the rhythm,

[Chorus]
(Jeser Mathieu & ZAHRA)
Concrete echoes, in the heart of the town,`;

    const out = prepareAceStepLyrics(raw, lead, feat);
    assert.doesNotMatch(out, /^\(Jeser Mathieu\)$/m);
    assert.doesNotMatch(out, /^\(ZAHRA\)$/m);
    assert.match(out, /\[singer 1: male\]/i);
    assert.match(out, /\[singer 2: female\]/i);
    assert.match(out, /Yo, concrete cracks/);
    assert.match(out, /Concrete echoes/);
  });
});

describe("ensureAceStepDuoSingerTags", () => {
  it("ajoute des tags si absents", () => {
    const out = ensureAceStepDuoSingerTags(
      `[Verse]\nhello\n[Chorus]\nhook`,
      { name: "A", gender: "male" },
      { name: "B", gender: "female" },
    );
    assert.match(out, /\[singer 1: male\]/i);
    assert.match(out, /\[singer 2: female\]/i);
  });
});

describe("buildAceStepDuoStyle", () => {
  it("suit les genres réels sans hardcoder male→female", () => {
    const style = buildAceStepDuoStyle(
      { name: "Ava", gender: "female", voice: "soft alto" },
      { name: "Leo", gender: "male", voice: "baritone rap" },
      { genreSummary: "pop rnb" },
    );
    assert.match(style, /singer 1 \(Ava\): female/i);
    assert.match(style, /singer 2 \(Leo\): male/i);
    assert.doesNotMatch(style, /male rap lead AND singer 2 female/i);
  });
});

describe("buildSunoPrompt duo", () => {
  it("n’écrase pas le duo avec un vocalHint male", () => {
    const prompt = buildSunoPrompt({
      lyrics: { title: "Concrete Echoes", text: "[Verse]\nhello" },
      artist: {
        name: "Jeser Mathieu",
        gender: "male",
        genre: "Hip Hop",
        featArtist: {
          name: "ZAHRA",
          gender: "female",
          genre: "Afro-trap",
          voice: "female oriental vocals",
        },
      },
      styleLock: {
        matchedName: "Eminem",
        genreSummary: "hardcore hip hop",
        vocalStyle: "rap",
      },
      bpmGuess: 172,
      vocalHint: "male vocals, man singer",
    });
    assert.match(prompt, /feat\. ZAHRA/i);
    assert.match(prompt, /two distinct|duet|featured vocalist/i);
    assert.match(prompt, /female featured|featured vocalist ZAHRA/i);
    assert.match(prompt, /Duo:/);
    assert.doesNotMatch(prompt, /^Style:[^.]*\. male vocals, man singer\. Mood:/m);
  });
});

describe("buildAceStepBody duo", () => {
  it("cap BPM et convertit les paroles duo", () => {
    const body = buildAceStepBody({
      title: "Concrete Echoes",
      style: "hip hop, male vocals, Eminem style rap only",
      lyrics: `[Verse]
(Jeser Mathieu)
Hello world
[Verse]
(ZAHRA)
Hello her`,
      language: "en",
      bpm: 172,
      modelId: "acestep-v15-xl-turbo-bf16",
      styleLock: {
        genreSummary: "hardcore hip hop",
        vocalStyle: "male rap",
        matchedName: "Eminem",
      },
      artist: {
        name: "Jeser Mathieu",
        gender: "male",
        featArtist: { name: "ZAHRA", gender: "female" },
      },
      featArtist: { name: "ZAHRA", gender: "female", voice: "female oriental vocals" },
    });
    assert.equal(body.bpm, ACE_DUO_BPM_CAP);
    assert.match(body.style, /singer 1 \(Jeser Mathieu\): male/i);
    assert.match(body.style, /singer 2 \(ZAHRA\): female/i);
    assert.doesNotMatch(body.style, /singer 1 male rap lead AND singer 2 female melodic/i);
    assert.doesNotMatch(body.style, /Eminem/i);
    assert.doesNotMatch(body.lyrics, /^\(Jeser Mathieu\)$/m);
    assert.match(body.lyrics, /\[singer 1: male\]/i);
    assert.match(body.lyrics, /\[singer 2: female\]/i);
  });

  it("respecte female lead + male feat", () => {
    const body = buildAceStepBody({
      title: "Flip",
      style: "pop",
      lyrics: `[Verse]
(Ava)
Hi
[Verse]
(Leo)
Hey`,
      language: "en",
      modelId: "acestep-v15-xl-turbo",
      artist: { name: "Ava", gender: "female", featArtist: { name: "Leo", gender: "male" } },
      featArtist: { name: "Leo", gender: "male" },
    });
    assert.match(body.style, /singer 1 \(Ava\): female/i);
    assert.match(body.style, /singer 2 \(Leo\): male/i);
    assert.match(body.lyrics, /\[singer 1: female\]/i);
    assert.match(body.lyrics, /\[singer 2: male\]/i);
  });

  it("injecte des tags singer si les paroles n’en ont pas", () => {
    const body = buildAceStepBody({
      title: "Bare",
      style: "rnb",
      lyrics: `[Verse]
line one
[Chorus]
hook line`,
      language: "en",
      modelId: "acestep-v15-xl-turbo",
      artist: { name: "A", gender: "male", featArtist: { name: "B", gender: "female" } },
      featArtist: { name: "B", gender: "female" },
    });
    assert.match(body.lyrics, /\[singer 1: male\]/i);
    assert.match(body.lyrics, /\[singer 2: female\]/i);
  });

  it("abaisse la force de cover en duo", () => {
    const body = buildAceStepBody({
      title: "Duo",
      style: "hip hop",
      lyrics: "hi",
      language: "en",
      modelId: "acestep-v15-xl-turbo",
      referenceAudioUrl: "https://example.com/ref.mp3",
      artist: { name: "A", gender: "male", featArtist: { name: "B", gender: "female" } },
    });
    assert.equal(body.taskType, "cover");
    assert.ok(body.audioCoverStrength < 0.4);
  });
});

describe("pickAceStepModel duo / fallback", () => {
  it("respecte la préférence SFT même en duo", () => {
    const models = [
      { id: "acestep-v15-xl-sft", isPreloaded: true, isActive: true, engineKnown: true },
      { id: "marcorez8/acestep-v15-xl-turbo-bf16", isPreloaded: true, isActive: false, engineKnown: true },
      { id: "acestep-v15-xl-merge-sft-turbo", isPreloaded: true, isActive: false, engineKnown: false },
    ];
    const duo = pickAceStepModel(
      { models, activeModel: "acestep-v15-xl-sft" },
      { preferredId: "acestep-v15-xl-sft", duo: true },
    );
    assert.equal(duo.modelId, "acestep-v15-xl-sft");
    assert.match(duo.reason, /forcé · XL SFT/i);

    const forced = pickAceStepModel(
      { models },
      { preferredId: "acestep-v15-xl-sft", forceModelId: "marcorez8/acestep-v15-xl-turbo-bf16" },
    );
    assert.equal(forced.modelId, "marcorez8/acestep-v15-xl-turbo-bf16");
    assert.match(forced.reason, /retry/i);

    const autoDuo = pickAceStepModel({ models }, { duo: true });
    assert.notEqual(autoDuo.modelId, "acestep-v15-xl-merge-sft-turbo");
  });

  it("ne confond pas NaN avec VRAM (cuda:0 dans le message)", () => {
    const nanMsg =
      "Generation produced NaN or Inf latents (shape=[1, 4500, 64], dtype=torch.bfloat16, device=cuda:0, nan=288000)";
    assert.equal(isAceNanLatentsError(nanMsg), true);
    assert.equal(isAceVramError(nanMsg), false);
    assert.equal(isAceVramError("CUDA out of memory"), true);
  });
});
