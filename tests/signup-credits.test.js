import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { currentCreditsPeriod } from "../src/server/credits.js";
import { defaultBillingPlans, planBullets } from "../src/server/plans.js";
import { watermarkCoverBuffer } from "../src/server/exportWatermark.js";
import sharp from "sharp";

describe("signup / credits / quotas helpers", () => {
  it("credits period is YYYY-MM UTC", () => {
    assert.match(currentCreditsPeriod(new Date("2026-09-09T12:00:00Z")), /^2026-09$/);
  });

  it("new accounts start on Free quotas", () => {
    const plans = defaultBillingPlans();
    assert.equal(plans.free.creditsPerMonth, 5);
    assert.equal(plans.free.artists, 1);
    assert.equal(plans.free.albums, 1);
    assert.equal(plans.free.watermark, true);
    const free = planBullets(plans, "free");
    assert.ok(free.some((b) => /1 crédit = 1/.test(b)));
  });

  it("watermarks a cover jpeg", async () => {
    const input = await sharp({
      create: { width: 200, height: 200, channels: 3, background: "#336699" },
    })
      .jpeg()
      .toBuffer();
    const out = await watermarkCoverBuffer(input, { label: "SONOZZ · Free" });
    assert.ok(Buffer.isBuffer(out));
    assert.ok(out.length > 100);
    const meta = await sharp(out).metadata();
    assert.equal(meta.format, "jpeg");
  });
});
