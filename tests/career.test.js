import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCareerHeuristics,
  buildCareerSchedule,
} from "../src/server/careerAgent.js";
import {
  extractOnceIdentifiers,
  publishingReadiness,
  normalizeOnceDelivery,
  pickLegalPersonName,
  canReuseOnceRelease,
} from "../src/server/once.js";
import { verifyOnceWebhookSignature } from "../src/server/onceWebhooks.js";
import { scheduleItemKey } from "../src/server/careerSchedule.js";
import { createHmac } from "node:crypto";

describe("careerAgent heuristics", () => {
  it("wait quand release en inspection", () => {
    const h = buildCareerHeuristics({
      artist: { name: "Kaelen", profile: { genre: "Pop", mood: "soleil" } },
      releases: [
        {
          id: "p1",
          trackTitle: "Rayon de Soleil",
          onceStatus: "submitted",
          releaseId: "rel-1",
          hasAudio: true,
        },
      ],
      stats: {
        delivery: {
          "rel-1": {
            aggregateStatus: "In inspection",
            spotifyStatus: "Pending",
            identifiers: { upcPending: true, isrcPending: true },
            publishing: {
              status: "locked",
              canSubmitUnison: false,
              label: "Publishing verrouillé",
            },
            dashboardUrl: "https://beta.once.app/releases/rel-1",
          },
        },
        streams: { totalStreams: 0 },
      },
    });

    assert.equal(h.verdict, "wait");
    assert.ok(h.schedule.length >= 3);
    assert.equal(h.schedule[0].type, "watch");
    assert.equal(h.catalogue.pending, 1);
    assert.match(h.summary, /inspection|livraison/i);
  });

  it("publish quand ISRC prêt", () => {
    const h = buildCareerHeuristics({
      artist: { name: "Kaelen", profile: {} },
      releases: [
        {
          id: "p1",
          trackTitle: "Rayon de Soleil",
          onceStatus: "submitted",
          releaseId: "rel-1",
          hasAudio: true,
        },
      ],
      stats: {
        delivery: {
          "rel-1": {
            aggregateStatus: "Live",
            spotifyStatus: "Live",
            spotifyUrl: "https://open.spotify.com/album/x",
            identifiers: {
              upc: "123456789012",
              isrc: "QZXXX0000001",
              upcPending: false,
              isrcPending: false,
            },
            publishing: {
              status: "ready",
              canSubmitUnison: true,
              reason: "ISRC ok",
            },
            dashboardUrl: "https://beta.once.app/releases/rel-1",
          },
        },
        streams: { totalStreams: 10 },
      },
    });

    assert.equal(h.verdict, "publish");
    assert.equal(h.actions[0].type, "publish_unison");
    assert.ok(h.actions[0].href.includes("rel-1"));
    assert.equal(h.releaseFocus.isrc, "QZXXX0000001");
    assert.equal(h.schedule[0].type, "publish_unison");
  });

  it("produce si catalogue vide", () => {
    const h = buildCareerHeuristics({
      artist: { name: "New", profile: { genre: "Rap" } },
      releases: [],
      stats: {},
    });
    assert.equal(h.verdict, "produce");
    assert.equal(h.actions[0].type, "produce");
  });

  it("promote si live mais peu de streams", () => {
    const h = buildCareerHeuristics({
      artist: { name: "Kaelen", profile: {} },
      releases: [
        {
          id: "p1",
          trackTitle: "Rayon",
          onceStatus: "submitted",
          releaseId: "rel-1",
          hasAudio: true,
        },
      ],
      stats: {
        delivery: {
          "rel-1": {
            aggregateStatus: "Live",
            spotifyStatus: "Live",
            spotifyUrl: "https://open.spotify.com/x",
            identifiers: { isrcPending: true, upcPending: true },
            publishing: { status: "awaiting_isrc", canSubmitUnison: false },
          },
        },
        streams: { totalStreams: 5 },
      },
    });
    assert.equal(h.verdict, "promote");
    assert.ok(h.actions.some((a) => a.type === "promote"));
  });
});

describe("buildCareerSchedule", () => {
  it("génère des dates ISO et un item active", () => {
    const schedule = buildCareerSchedule({
      verdict: "wait",
      themeSeed: "thème",
      releaseFocus: {
        title: "Rayon",
        dashboardUrl: "https://beta.once.app/releases/x",
      },
      cadence: { suggestedDaysUntilNext: 7 },
    });
    assert.ok(schedule.every((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.date)));
    assert.ok(schedule.some((i) => i.status === "active"));
  });
});

describe("ONCE identifiers & publishing", () => {
  it("extractOnceIdentifiers lit tracks[].isrc", () => {
    const ids = extractOnceIdentifiers({
      upc: "190295012345",
      tracks: [{ title: "A", isrc: "FRX992400001" }],
    });
    assert.equal(ids.upc, "190295012345");
    assert.equal(ids.isrc, "FRX992400001");
    assert.equal(ids.isrcPending, false);
    assert.equal(ids.upcPending, false);
  });

  it("extractOnceIdentifiers marque pending si vide", () => {
    const ids = extractOnceIdentifiers({ tracks: [{ title: "A" }] });
    assert.equal(ids.isrcPending, true);
    assert.equal(ids.upcPending, true);
  });

  it("publishingReadiness locked en inspection", () => {
    const r = publishingReadiness({
      delivery: { aggregateStatus: "In inspection", spotifyStatus: "Pending" },
      identifiers: { isrcPending: true },
    });
    assert.equal(r.status, "locked");
    assert.equal(r.canSubmitUnison, false);
  });

  it("publishingReadiness ready avec ISRC + live", () => {
    const r = publishingReadiness({
      delivery: {
        aggregateStatus: "Live",
        spotifyStatus: "Live",
        spotifyUrl: "https://open.spotify.com/x",
      },
      identifiers: { isrc: "QZAAA1111111", isrcPending: false },
    });
    assert.equal(r.status, "ready");
    assert.equal(r.canSubmitUnison, true);
  });

  it("pickLegalPersonName accepte prénom + nom", () => {
    assert.equal(pickLegalPersonName("Kaelen Moreau"), "Kaelen Moreau");
    assert.equal(pickLegalPersonName("", "Marie-Claire Dubois"), "Marie-Claire Dubois");
  });

  it("pickLegalPersonName refuse mononyme / initiales", () => {
    assert.equal(pickLegalPersonName("Kaelen"), null);
    assert.equal(pickLegalPersonName("J Smith"), null); // J trop court
    assert.equal(pickLegalPersonName(""), null);
    assert.equal(pickLegalPersonName(null, undefined), null);
  });

  it("pickLegalPersonName accepte scripts CJK courts", () => {
    assert.equal(pickLegalPersonName("林 明"), "林 明");
  });

  it("canReuseOnceRelease exige un vrai releaseId", () => {
    assert.equal(canReuseOnceRelease(null), false);
    assert.equal(canReuseOnceRelease({ releaseId: "once_abc" }), false);
    assert.equal(canReuseOnceRelease({ releaseId: "short" }), false);
    assert.equal(
      canReuseOnceRelease({ releaseId: "6f0f0a4e-1111-2222-3333-444444444444", status: "draft-only" }),
      true,
    );
    assert.equal(
      canReuseOnceRelease({ releaseId: "6f0f0a4e-1111-2222-3333-444444444444", status: "submitted" }),
      true,
    );
  });

  it("normalizeOnceDelivery extrait Spotify", () => {
    const d = normalizeOnceDelivery({
      aggregateStatus: "distributed",
      storeStatuses: [
        {
          storeName: "Spotify",
          statusText: "Live",
          urlInStore: "https://open.spotify.com/album/1",
        },
      ],
    });
    assert.equal(d.spotifyStatus, "Live");
    assert.ok(d.spotifyUrl.includes("spotify"));
  });
});

describe("ONCE webhook signature", () => {
  it("accepte HMAC valide", () => {
    const body = JSON.stringify({
      event: "release.status_changed",
      releaseId: "abc",
      status: "distributed",
    });
    const secret = "whsec_test";
    const sig =
      "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    assert.equal(verifyOnceWebhookSignature(body, sig, secret), true);
  });

  it("refuse HMAC invalide", () => {
    const body = '{"a":1}';
    const secret = "whsec_test";
    const bad =
      "sha256=" + createHmac("sha256", secret).update("other").digest("hex");
    assert.equal(verifyOnceWebhookSignature(body, bad, secret), false);
    assert.equal(verifyOnceWebhookSignature(body, "", secret), false);
  });
});

describe("careerSchedule helpers", () => {
  it("scheduleItemKey est stable", () => {
    assert.equal(
      scheduleItemKey({ date: "2026-08-03", type: "promote", title: "Hook #1" }),
      "2026-08-03|promote|Hook #1",
    );
  });
});
