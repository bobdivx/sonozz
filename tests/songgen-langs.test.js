import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  languagesForProvider,
  isLanguageOkForProvider,
  songGenLanguageCodes,
  isSongGenNativeLanguage,
  languageEngineLabel,
} from "../src/lib/studio.js";

describe("SongGen language limits", () => {
  it("large = chinois + anglais nativement", () => {
    assert.deepEqual(songGenLanguageCodes("songgeneration_large"), ["zh", "en"]);
    assert.equal(isLanguageOkForProvider("fr", "songgen", "songgeneration_large"), false);
    assert.equal(isLanguageOkForProvider("es", "songgen", "songgeneration_large"), false);
    assert.equal(isLanguageOkForProvider("en", "songgen", "songgeneration_large"), true);
    assert.equal(isSongGenNativeLanguage("es", "songgeneration_large"), false);
  });

  it("UI SongGen affiche FR et ES (chant MiniMax)", () => {
    const labels = languagesForProvider("songgen", "songgeneration_large").map((l) => l.code);
    assert.ok(labels.includes("en"));
    assert.ok(labels.includes("fr"));
    assert.ok(labels.includes("es"));
    assert.equal(languageEngineLabel("fr", "songgen", "songgeneration_large"), "MiniMax");
    assert.equal(languageEngineLabel("es", "songgen", "songgeneration_large"), "MiniMax");
    assert.equal(languageEngineLabel("en", "songgen", "songgeneration_large"), "SongGen");
  });

  it("v2 chante ES et JA nativement, pas le FR", () => {
    assert.deepEqual(songGenLanguageCodes("songgeneration_v2_large"), ["zh", "en", "es", "ja"]);
    assert.equal(isSongGenNativeLanguage("es", "songgeneration_v2_large"), true);
    assert.equal(isSongGenNativeLanguage("fr", "songgeneration_v2_large"), false);
    assert.equal(languageEngineLabel("es", "songgen", "songgeneration_v2_large"), "SongGen");
    assert.equal(languageEngineLabel("fr", "songgen", "songgeneration_v2_large"), "MiniMax");
  });

  it("replicate garde le français", () => {
    assert.equal(isLanguageOkForProvider("fr", "replicate", ""), true);
  });
});
