import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tryParseS3ObjectKey } from "../src/server/s3.js";
import { isEphemeralAudioUrl } from "../src/server/audioPersist.js";

describe("tryParseS3ObjectKey", () => {
  it("accepte une clé audio locale", () => {
    assert.equal(tryParseS3ObjectKey("audio/proj/track.mp3"), "audio/proj/track.mp3");
  });

  it("ne prend pas une URL ACE-Step /audio/ pour une clé S3", () => {
    assert.equal(
      tryParseS3ObjectKey(
        "https://ace.briseteia.me/audio/b62d9f95-e587-4d35-8c91-5a58e7adfca9/7632dc7a-cc91-4d0a-87f3-e1255111ae66.mp3",
      ),
      null,
    );
  });
});

describe("isEphemeralAudioUrl", () => {
  it("marque ACE-Step comme éphémère (à persister S3)", () => {
    assert.equal(
      isEphemeralAudioUrl(
        "https://ace.briseteia.me/audio/b62d9f95-e587-4d35-8c91-5a58e7adfca9/file.mp3",
      ),
      true,
    );
  });

  it("ne marque pas une URL http quelconque sans /audio/", () => {
    assert.equal(isEphemeralAudioUrl("https://cdn.example.com/track.mp3"), false);
  });
});
