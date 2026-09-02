import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectS3KeysFromProject } from "../src/server/artists.js";

describe("collectS3KeysFromProject", () => {
  it("extrait audioS3Key, clips et voice sample", () => {
    const keys = collectS3KeysFromProject({
      track: { audioS3Key: "audio/proj1/a.mp3", audioUrl: "https://elsewhere.example/x.mp3" },
      trackVersions: [{ audioS3Key: "audio/proj1/b.flac" }],
      clip: { s3Key: "clips/proj1/c.webm" },
      clips: [{ s3Key: "clips/proj1/d.mp4" }],
      artist: { voiceSample: { s3Key: "audio/voice/slug/v.wav" } },
    });
    assert.deepEqual(keys.sort(), [
      "audio/proj1/a.mp3",
      "audio/proj1/b.flac",
      "audio/voice/slug/v.wav",
      "clips/proj1/c.webm",
      "clips/proj1/d.mp4",
    ]);
  });

  it("ignore les clés hors audio/clips", () => {
    const keys = collectS3KeysFromProject({
      track: { audioS3Key: "../secret", audioUrl: "not-a-key" },
    });
    assert.deepEqual(keys, []);
  });
});
