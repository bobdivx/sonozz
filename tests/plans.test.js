import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultBillingPlans, planBullets } from "../src/server/plans.js";

describe("billing plans copy", () => {
  it("keeps Pro quotas realistic vs generation volume", () => {
    const plans = defaultBillingPlans();
    assert.equal(plans.pro.artists, 2);
    assert.equal(plans.pro.albums, 3);
    assert.equal(plans.pro.creditsPerMonth, 40);
    assert.ok(plans.pro.albums * 8 <= 32);
  });

  it("spells out album catalogue size and credit meaning", () => {
    const plans = defaultBillingPlans();
    const pro = planBullets(plans, "pro");
    assert.ok(pro.some((b) => /2 profils artistes/i.test(b)));
    assert.ok(pro.some((b) => /3 albums au total \(≈ 24 titres\)/.test(b)));
    assert.ok(pro.some((b) => /1 crédit = 1 génération de titre/.test(b)));
    assert.ok(pro.some((b) => /sans watermark/i.test(b)));
    assert.ok(!pro.some((b) => b === "Multi-albums" || b === "Export propre"));
  });

  it("keeps Free and Publish+ wording concrete", () => {
    const plans = defaultBillingPlans();
    const free = planBullets(plans, "free");
    assert.ok(free.some((b) => /1 profil artiste/.test(b)));
    assert.ok(free.some((b) => /1 album \(≈ 8 titres\)/.test(b)));
    assert.ok(free.some((b) => /watermark/i.test(b)));

    const pub = planBullets(plans, "publish_plus");
    assert.ok(pub.some((b) => /DistroKid/i.test(b)));
    assert.ok(pub.some((b) => /Se cumule/.test(b)));
  });
});
