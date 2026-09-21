import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tryParseS3ObjectKey, isSignedS3Url, canonicalS3Url } from "../src/server/s3.js";
import { isEphemeralAudioUrl } from "../src/server/audioPersist.js";
import { lightAssetUrl } from "../src/server/artists/schema.js";
import { playableAudioSrc } from "../src/lib/audioResolve.js";

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

  it("extrait la clé depuis une URL Scaleway signée", () => {
    const url =
      "https://sonozz.s3.fr-par.scw.cloud/audio/Le_cuisto/1789324914831.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=604800&X-Amz-Signature=abc";
    assert.equal(tryParseS3ObjectKey(url), "audio/Le_cuisto/1789324914831.mp3");
    assert.equal(isSignedS3Url(url), true);
  });
});

describe("lightAssetUrl / playableAudioSrc", () => {
  it("retire la query signée des URLs S3", () => {
    const url =
      "https://sonozz.s3.fr-par.scw.cloud/audio/Le_cuisto/x.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc";
    assert.equal(lightAssetUrl(url), "https://sonozz.s3.fr-par.scw.cloud/audio/Le_cuisto/x.mp3");
  });

  it("force stream?key= pour une URL S3 sonozz", () => {
    const src = playableAudioSrc(
      "https://sonozz.s3.fr-par.scw.cloud/audio/Le_cuisto/x.mp3?X-Amz-Signature=dead",
    );
    assert.equal(src, "/api/audio/stream?key=audio%2FLe_cuisto%2Fx.mp3");
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

describe("canonicalS3Url", () => {
  it("réécrit une URL signée sonozz sans query", () => {
    const url =
      "https://sonozz.s3.fr-par.scw.cloud/audio/x/y.mp3?X-Amz-Signature=abc&X-Amz-Expires=1";
    const out = canonicalS3Url(url);
    assert.ok(out);
    assert.equal(out.includes("X-Amz"), false);
    assert.ok(out.includes("audio/x/y.mp3"));
  });
});
