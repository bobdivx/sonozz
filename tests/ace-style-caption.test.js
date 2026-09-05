import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeAceStyleCaption,
  resolveAceStepStyleCaption,
  clearAceStyleCaptionCache,
  ACE_STYLE_TARGET,
  assembleAceStepStyle,
  ACE_STYLE_CAP,
  buildAceStepBody,
} from "../src/server/aceStep.js";

describe("sanitizeAceStyleCaption", () => {
  it("accepte un caption propre ≤700", () => {
    const s = sanitizeAceStyleCaption(
      "Indie Pop, male lead. full band always: guitar, bass, drums, pads — never drums-only. dry clear lead vocal. verse lean → thicker chorus.",
    );
    assert.ok(s);
    assert.ok(s.length <= ACE_STYLE_CAP);
  });

  it("refuse troncature mid-word", () => {
    assert.equal(sanitizeAceStyleCaption("good start. chorus=sin"), null);
  });

  it("coupe au dernier point si trop long", () => {
    const long = `${"word ".repeat(200)}. end sentence here. ${"x".repeat(100)}`;
    const s = sanitizeAceStyleCaption(long, { max: 200 });
    assert.ok(s);
    assert.ok(s.length <= 200);
    assert.match(s, /\.$|\w$/);
  });
});

describe("assembleAceStepStyle + resolveAceStepStyleCaption", () => {
  beforeEach(() => clearAceStyleCaptionCache());

  it("squelette duo reste sous le plafond", () => {
    const a = assembleAceStepStyle({
      style: "afro trap",
      language: "fr",
      styleLock: { genreSummary: "Afro-trap Electro-Oriental", mood: "intense" },
      artist: {
        name: "Zahra",
        gender: "female",
        language: "fr",
        genre: "Afro-trap Electro-Oriental",
        featArtist: {
          name: "Marcus",
          gender: "male",
          language: "en",
          genre: "Gospel",
        },
      },
    });
    assert.ok(a.style.length <= ACE_STYLE_CAP);
    assert.equal(a.duo, true);
    assert.equal(a.bilingual, true);
    assert.ok(a.brief.skeleton);
  });

  it("sans LLM → skeleton (preview ou keys vides)", async () => {
    const r = await resolveAceStepStyleCaption(
      {},
      {
        style: "indie pop",
        language: "en",
        styleLock: { genreSummary: "Indie Pop" },
        artist: { name: "Haze", gender: "male", genre: "Indie Pop" },
        lyrics: "[Verse]\nHi",
        preview: false,
      },
    );
    assert.equal(r.source, "skeleton");
    assert.ok(r.style.length <= ACE_STYLE_CAP);
  });

  it("preview saute le LLM même avec clé", async () => {
    const r = await resolveAceStepStyleCaption(
      { geminiApiKey: "fake-key-not-called", llmProvider: "gemini" },
      {
        style: "pop",
        language: "en",
        artist: {
          name: "A",
          gender: "female",
          featArtist: { name: "B", gender: "male", language: "fr" },
        },
        preview: true,
      },
    );
    assert.equal(r.source, "skeleton");
  });

  it("buildAceStepBody honore styleOverride", () => {
    const override =
      "Custom caption: full band guitar bass drums keys, never drums-only, dry clear male vocal, verse lean thicker chorus.";
    const body = buildAceStepBody({
      title: "T",
      style: "ignored noise ".repeat(40),
      lyrics: "hi",
      language: "en",
      modelId: "acestep-v15-xl-turbo",
      artist: { name: "A", gender: "male" },
      styleOverride: override,
    });
    assert.equal(body.style, override);
    assert.ok(body.style.length < ACE_STYLE_TARGET);
  });
});
