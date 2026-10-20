import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { startTrackAsync, pollTrackAsync, cancelTrackAsync, isStartJobId } from "../src/server/pipeline/trackJobs.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe("incident 499/502 : la génération ne tient jamais la requête HTTP", () => {
  it("start lent → réponse pending immédiate, poll suit puis délègue au vrai poll", async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const polled = [];
    const deps = {
      startWaitMs: 30,
      pollWaitMs: 30,
      startTrack: async () => {
        await gate;
        return { pollNeeded: true, musicKind: "acestep", generationId: "ace-1", draft: { title: "T", aceStepModel: "m" } };
      },
      pollTrack: async (b) => {
        polled.push(b);
        return { done: true, track: { title: b.draft.title, audioUrl: "https://x/a.mp3" } };
      },
      cancelTrack: async (b) => ({ ok: true, id: b.generationId }),
    };
    const t0 = Date.now();
    const started = await startTrackAsync({ keys: { musicProvider: "acestep", aceStepEnabled: "1" } }, { owner: "a@b", deps });
    assert.ok(Date.now() - t0 < 500);
    assert.equal(started.pending, true);
    assert.ok(isStartJobId(started.generationId));
    const p1 = await pollTrackAsync({ generationId: started.generationId, musicKind: started.musicKind, draft: null }, { owner: "a@b", deps });
    assert.equal(p1.done, false);
    assert.equal(p1.status, "pending");
    // autre utilisateur : introuvable
    await assert.rejects(pollTrackAsync({ generationId: started.generationId }, { owner: "x@y", deps }), /introuvable/);
    release();
    await wait(5);
    const p2 = await pollTrackAsync({ generationId: started.generationId, musicKind: started.musicKind, draft: null }, { owner: "a@b", deps });
    assert.equal(p2.done, true);
    assert.equal(p2.track.title, "T");
    assert.equal(polled[0].generationId, "ace-1");
    assert.equal(polled[0].draft.aceStepModel, "m");
    const c = await cancelTrackAsync({ generationId: started.generationId }, { owner: "a@b", deps });
    assert.equal(c.id, "ace-1");
  });

  it("start rapide → réponse identique à l'ancien flux ; erreur rapide → propagée", async () => {
    const deps = { startWaitMs: 200, startTrack: async () => ({ pollNeeded: true, musicKind: "acestep", generationId: "g", draft: {} }) };
    const r = await startTrackAsync({ keys: {} }, { deps });
    assert.equal(r.generationId, "g");
    const bad = { startWaitMs: 200, startTrack: async () => { throw new Error("ACE_REF_UNUSABLE boom"); } };
    await assert.rejects(startTrackAsync({ keys: {} }, { deps: bad }), /ACE_REF_UNUSABLE/);
  });

  it("erreur après pending → renvoyée au poll (relances client conservées)", async () => {
    const deps = { startWaitMs: 10, startTrack: async () => { await wait(30); throw new Error("ACE_REF_UNUSABLE ref"); } };
    const s = await startTrackAsync({ keys: {} }, { deps });
    await wait(50);
    await assert.rejects(pollTrackAsync({ generationId: s.generationId }, { deps }), /ACE_REF_UNUSABLE/);
  });

  it("poll lent (persist audio) → pending puis résultat, sans relancer le travail", async () => {
    let calls = 0;
    const deps = { pollWaitMs: 20, pollTrack: async () => { calls++; await wait(60); return { done: true, track: { ok: 1 } }; } };
    const a = await pollTrackAsync({ generationId: "real-9", musicKind: "acestep" }, { deps });
    assert.equal(a.done, false);
    await wait(80);
    const b = await pollTrackAsync({ generationId: "real-9", musicKind: "acestep" }, { deps });
    assert.equal(b.done, true);
    assert.equal(calls, 1);
  });
});
