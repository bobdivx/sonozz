// Régression 20/10 : « Station Essence Minuit » généré sans la référence Mantra (styleLock du hub écrasé).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { serializeStyleLock } from "../src/server/pipeline/util.js";

describe("hub artiste : la référence de style survit au « nouveau single »", () => {
  it("mergeArtistProfile garde styleReference / aceCaption du hub quand le projet a un styleLock plus ancien", async () => {
    const { mergeArtistProfile } = await import("../src/server/artists/schema.js");
    const hub = { name: "S", styleLock: { genres: ["Electro"], styleReference: { source: "deezer", deezerTrackId: "4277012282" }, aceCaption: "cap" } };
    const fromProject = { name: "S", styleLock: { genres: ["Electro", "Rock"], bpm: 90 } };
    const m = mergeArtistProfile(hub, fromProject);
    assert.equal(m.styleLock.styleReference.deezerTrackId, "4277012282");
    assert.equal(m.styleLock.aceCaption, "cap");
    assert.deepEqual(m.styleLock.genres, ["Electro", "Rock"]);
    // désactivation explicite côté projet respectée
    const off = mergeArtistProfile(hub, { styleLock: { styleReference: { enabled: false } } });
    assert.equal(off.styleLock.styleReference.enabled, false);
  });
  it("serializeStyleLock conserve la référence (snapshot projet)", () => {
    const s = serializeStyleLock({ genres: ["Electro"], styleReference: { source: "deezer", deezerTrackId: "1" } });
    assert.equal(s.styleReference.deezerTrackId, "1");
  });
});
