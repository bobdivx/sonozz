import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deleteVersion, appendVersion } from "../src/lib/versionsModel.js";

describe("deleteVersion (dernière version)", () => {
  it("track : garde une coquille sans audio, ne vide pas le projet", () => {
    let p = {
      artist: { name: "Jeser", slug: "jeser" },
      lyrics: { text: "yo", title: "Fake God" },
      trackVersions: [],
      track: null,
    };
    p = appendVersion(p, "track", {
      title: "Fake God",
      audioUrl: "https://example.com/a.mp3",
      provider: "acestep-studio",
      status: "audio-ready",
      bpm: 90,
    });
    assert.equal(p.trackVersions.length, 1);
    assert.ok(p.track?.audioUrl);

    const { project: next, removed } = deleteVersion(p, "track", p.activeTrackId);
    assert.ok(removed?.audioUrl);
    assert.equal(next.trackVersions.length, 1);
    assert.equal(next.track?.audioUrl, null);
    assert.equal(next.track?.status, "prompt-ready");
    assert.equal(next.track?.title, "Fake God");
    assert.equal(next.lyrics?.text, "yo");
    assert.equal(next.artist?.name, "Jeser");
  });

  it("track : supprimer une version parmi plusieurs ne recrée pas de coquille", () => {
    let p = appendVersion({}, "track", {
      title: "A",
      audioUrl: "https://example.com/a.mp3",
      status: "audio-ready",
    });
    p = appendVersion(p, "track", {
      title: "B",
      audioUrl: "https://example.com/b.mp3",
      status: "audio-ready",
    });
    const idA = p.trackVersions[0].id;
    const { project: next } = deleteVersion(p, "track", idA);
    assert.equal(next.trackVersions.length, 1);
    assert.equal(next.track?.title, "B");
    assert.ok(next.track?.audioUrl);
  });
});
