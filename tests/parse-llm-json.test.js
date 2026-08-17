import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseLlmJson, repairJsonText } from "../src/server/parseLlmJson.js";

describe("parseLlmJson", () => {
  it("accepte un JSON valide", () => {
    const data = parseLlmJson('{"title":"Shadow Boxer","text":"hello"}');
    assert.equal(data.title, "Shadow Boxer");
  });

  it("répare les apostrophes échappées à la JS (\\\\')", () => {
    const raw = `{"title":"Shadow Boxer","text":"I don\\'t run from the demons"}`;
    assert.match(raw, /\\'/);
    assert.throws(() => JSON.parse(raw));
    const data = parseLlmJson(raw);
    assert.equal(data.text, "I don't run from the demons");
  });

  it("répare les sauts de ligne bruts dans une string", () => {
    const raw = `{"title":"Shadow Boxer","text":"line one
line two"}`;
    const data = parseLlmJson(raw);
    assert.equal(data.text, "line one\nline two");
  });

  it("ignore les fences markdown", () => {
    const data = parseLlmJson('```json\n{"title":"Ok"}\n```');
    assert.equal(data.title, "Ok");
  });

  it("repairJsonText conserve les vrais \\\\n", () => {
    const repaired = repairJsonText('{"text":"a\\nb"}');
    assert.equal(JSON.parse(repaired).text, "a\nb");
  });
});
