import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  prepareAceStepLyrics,
  normalizeFeatArtist,
  ensureAceStepDuoSingerTags,
  buildAceStepDuoStyle,
  soloizeFeatVocalForDuo,
  vocalLockForArtist,
  duoLyricsInstruction,
  resolveDuoLanguages,
  duoLanguageRules,
} from "../src/lib/featArtist.js";
import { buildSunoPrompt } from "../src/lib/sunoPrompt.js";
import {
  buildAceStepBody,
  ACE_DUO_BPM_CAP,
  pickAceStepModel,
  isAceNanLatentsError,
  isAceVramError,
  stripAceStageDirections,
  aceDuoVocalLanguageStyleBit,
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

  it("ne prend pas une didascalie avec virgule pour un duo", () => {
    const raw = `[Intro]
(Sound of grinding metal, distant sirens)
Yeah.

[Verse - male vocal]
Yo, pavement`;
    const out = prepareAceStepLyrics(
      raw,
      { name: "Jeser Mathieu", gender: "male" },
      { name: "Veridian Echoes", gender: "male" },
    );
    assert.doesNotMatch(out, /Sound of grinding/i);
    const introBlock = out.split("[Verse")[0];
    assert.doesNotMatch(introBlock, /\[singer 2:/i);
    assert.match(out, /Yeah/);
  });
});

describe("duoLyricsInstruction", () => {
  it("même sexe → singer 1/2, pas deux [Verse - male vocal]", () => {
    const text = duoLyricsInstruction(
      { name: "Jeser Mathieu", gender: "male", genre: "Hip Hop" },
      { name: "Veridian Echoes", gender: "male", genre: "Gospel" },
    );
    assert.match(text, /\[singer 1: male\]/);
    assert.match(text, /\[singer 2: male\]/);
    assert.doesNotMatch(text, /\[Verse - male vocal\][\s\S]*\[Verse - male vocal\]/);
    assert.match(text, /didascalies/i);
  });

  it("langues différentes → consignes bilingues par singer", () => {
    const text = duoLyricsInstruction(
      { name: "Jeser", gender: "male", language: "fr", genre: "Rap" },
      { name: "ZAHRA", gender: "female", language: "en", genre: "Afro" },
    );
    assert.match(text, /BILINGUE/i);
    assert.match(text, /français/i);
    assert.match(text, /anglais/i);
    assert.match(text, /singer 1.*français|couplets singer 1 en français/i);
  });
});

describe("resolveDuoLanguages / duoLanguageRules", () => {
  it("même langue si feat sans language", () => {
    const d = resolveDuoLanguages(
      { name: "A", language: "fr" },
      { name: "B", gender: "female" },
    );
    assert.equal(d.leadLang, "fr");
    assert.equal(d.featLang, "fr");
    assert.equal(d.bilingual, false);
  });

  it("bilingue fr+en", () => {
    const d = resolveDuoLanguages(
      { name: "A", language: "fr" },
      { name: "B", language: "en" },
    );
    assert.equal(d.bilingual, true);
    assert.equal(d.featLang, "en");
    const rules = duoLanguageRules(
      { name: "A", language: "fr" },
      { name: "B", language: "en" },
    );
    assert.match(rules.block, /DUO BILINGUE/i);
    assert.equal(rules.jsonLanguage, "fr");
  });
});

describe("aceDuoVocalLanguageStyleBit", () => {
  it("bilingue mentionne singer 1 et 2", () => {
    const bit = aceDuoVocalLanguageStyleBit("fr", "en");
    assert.match(bit, /bilingual/i);
    assert.match(bit, /singer 1.*fr/i);
    assert.match(bit, /singer 2.*en/i);
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

  it("1er Verse = lead même après Intro vide (pas gospel sur le rap)", () => {
    const lead = { name: "Jeser Mathieu", gender: "male", genre: "Hip Hop" };
    const feat = normalizeFeatArtist({
      name: "Veridian Echoes",
      gender: "male",
      genre: "Gospel",
    });
    const raw = `[Intro]

[Verse]
Yeah, they buildin' empires outta dust and lies

[Chorus]
Fake God, Fake God
Standin' on a shaky ground

[Verse]
Pavement cracks whisper tales of the grind`;
    const out = ensureAceStepDuoSingerTags(raw, lead, feat);
    // Intro vide → pas de tag singer
    const introBlock = out.split(/\[Verse\]/i)[0];
    assert.doesNotMatch(introBlock, /\[singer/i);
    // 1er couplet → singer 1 rap, 2e → singer 2 gospel
    const verses = out.split(/\[Verse\]/i).slice(1);
    assert.match(verses[0], /^\[singer 1: male rap baritone\]/im);
    assert.doesNotMatch(verses[0].split("\n").slice(0, 3).join("\n"), /singer 2: male gospel/i);
    assert.match(verses[1], /^\[singer 2: male gospel tenor\]/im);
    // Rap × gospel : le refrain appartient au feat gospel (pas call&response ligne à ligne)
    assert.match(out, /\[Chorus\]\s*\n\[singer 2: male gospel tenor\]/i);
    assert.doesNotMatch(out, /\[Chorus\]\s*\n\[singer 1:/i);
  });
});

describe("buildAceStepDuoStyle", () => {
  it("priorise un vrai titre (prod) puis le casting vocal", () => {
    const style = buildAceStepDuoStyle(
      { name: "Ava", gender: "female", voice: "soft alto", genre: "R&B" },
      { name: "Leo", gender: "male", voice: "baritone rap", genre: "Hip Hop" },
      {
        genreSummary: "pop rnb",
        styleLock: {
          genreSummary: "contemporary R&B pop",
          instruments: ["drums", "bass", "electric piano"],
          production: "radio mix",
        },
      },
    );
    assert.match(style, /ONE song only|single production lane/i);
    assert.match(style, /singer 1 Ava/i);
    assert.match(style, /singer 2 Leo/i);
    assert.ok(style.length <= 700);
  });

  it("fusionne rap × gospel sans coller un chœur anonyme en singer 2", () => {
    const feat = {
      name: "Veridian Echoes",
      gender: "male",
      genre: "Gospel",
      voice: "Gospel choir, call and response, lead vocalist with powerful ad-libs",
      styleLock: {
        vocalStyle: "Gospel choir, call and response",
        timbre: "Powerful, resonant, full-bodied choir, clear lead vocals",
        genreSummary: "Contemporary Gospel",
      },
    };
    const solo = soloizeFeatVocalForDuo(vocalLockForArtist(feat));
    assert.match(solo.vocalStyle, /Sister Act|gospel lead/i);
    assert.match(solo.vocalStyle, /choir/i);
    assert.match(solo.timbreHint, /gospel lead|church/i);

    const style = buildAceStepDuoStyle(
      { name: "Jeser Mathieu", gender: "male", genre: "Hip Hop" },
      feat,
      { styleBase: "hardcore hip hop", mood: "defiant" },
    );
    assert.match(style, /Sister Act|TRUE hip-hop/i);
    assert.match(style, /Gospel|gospel/i);
    assert.match(style, /baritone|tenor/i);
    assert.match(style, /Hammond|handclap|choir|CHORUS/i);
    assert.doesNotMatch(style, /Billboard|Lose Yourself|Brooklyn Tabernacle/i);
    assert.ok(style.length <= 1100);
  });

  it("tags same-sex avec contraste baritone/tenor", () => {
    const out = ensureAceStepDuoSingerTags(
      `[Verse]\nYo pavement\n[Chorus]\nFake God rising\nIn the night`,
      { name: "Jeser Mathieu", gender: "male", genre: "Hip Hop" },
      { name: "Veridian Echoes", gender: "male", genre: "Gospel" },
    );
    assert.match(out, /\[singer 1: male rap baritone\]/i);
    assert.match(out, /\[Chorus\]\s*\n\[singer 2: male gospel tenor\]/i);
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
    assert.match(body.style, /singer 1 Jeser Mathieu \(male\)/i);
    assert.match(body.style, /singer 2 ZAHRA \(female\)/i);
    assert.match(body.style, /dry clear lead vocal|dry natural|clear diction/i);
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
      styleLock: {
        genreSummary: "pop",
        instruments: ["drums", "bass", "synths"],
      },
    });
    assert.match(body.style, /ONE song only|single production lane/i);
    assert.match(body.style, /singer 1 Ava \(female\)/i);
    assert.match(body.style, /singer 2 Leo \(male\)/i);
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
    assert.match(body.instruction, /chorus instrumentation lifts|final chorus biggest/i);
  });

  it("langues différentes → style bilingue, vocalLanguage = lead", () => {
    const body = buildAceStepBody({
      title: "Bilingue",
      style: "hip hop",
      lyrics: `[Verse]
Bonjour la street
[Verse]
Hello from the block
[Chorus]
Ensemble forever`,
      language: "fr",
      modelId: "acestep-v15-xl-turbo",
      artist: {
        name: "LeadFR",
        gender: "male",
        language: "fr",
        featArtist: { name: "FeatEN", gender: "female", language: "en" },
      },
      featArtist: { name: "FeatEN", gender: "female", language: "en" },
    });
    assert.equal(body.vocalLanguage, "fr");
    assert.match(body.style, /bilingual/i);
    assert.match(body.style, /singer 1.*fr/i);
    assert.match(body.style, /singer 2.*en/i);
  });
});

describe("stripAceStageDirections", () => {
  it("retire les didascalies Sound of static sans casser les tags", () => {
    const raw = `[Intro]
(Sound of static, then a distorted, heavy synth chord fades in)
Yeah.

[Verse - male vocal]
Concrete cracks`;
    const out = stripAceStageDirections(raw);
    assert.doesNotMatch(out, /Sound of static/i);
    assert.match(out, /Yeah/);
    assert.match(out, /Concrete cracks/);
  });
});

describe("pickAceStepModel duo / fallback", () => {
  it("respecte la préférence SFT ; preview / same-sex → Turbo", () => {
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
    assert.equal(duo.needsResidentGate, true);

    const forced = pickAceStepModel(
      { models },
      { preferredId: "acestep-v15-xl-sft", forceModelId: "marcorez8/acestep-v15-xl-turbo-bf16" },
    );
    assert.equal(forced.modelId, "marcorez8/acestep-v15-xl-turbo-bf16");
    assert.match(forced.reason, /retry/i);

    const autoDuo = pickAceStepModel({ models }, { duo: true });
    assert.notEqual(autoDuo.modelId, "acestep-v15-xl-merge-sft-turbo");
  });

  it("duo same-sex : Turbo avant SFT même si préférence SFT", () => {
    const models = [
      { id: "acestep-v15-xl-sft", isPreloaded: true, isActive: true, engineKnown: true },
      { id: "acestep-v15-xl-turbo-bf16", isPreloaded: true, isActive: false, engineKnown: true },
    ];
    const pick = pickAceStepModel(
      { models, activeModel: "acestep-v15-xl-sft" },
      { preferredId: "acestep-v15-xl-sft", duo: true, sameSexDuo: true },
    );
    assert.match(pick.modelId, /turbo/i);
    assert.match(pick.reason, /same-sex/i);
  });

  it("preview : Turbo avant SFT (évite vocoder SFT)", () => {
    const models = [
      { id: "acestep-v15-xl-sft", isPreloaded: true, isActive: true, engineKnown: true },
      { id: "acestep-v15-xl-turbo-bf16", isPreloaded: true, isActive: false, engineKnown: true },
    ];
    const pick = pickAceStepModel(
      { models, activeModel: "acestep-v15-xl-sft" },
      { preferredId: "acestep-v15-xl-sft", preview: true },
    );
    assert.match(pick.modelId, /turbo/i);
    assert.match(pick.reason, /preview/i);
  });

  it("ne confond pas NaN avec VRAM (cuda:0 dans le message)", () => {
    const nanMsg =
      "Generation produced NaN or Inf latents (shape=[1, 4500, 64], dtype=torch.bfloat16, device=cuda:0, nan=288000)";
    assert.equal(isAceNanLatentsError(nanMsg), true);
    assert.equal(isAceVramError(nanMsg), false);
    assert.equal(isAceVramError("CUDA out of memory"), true);
  });
});
