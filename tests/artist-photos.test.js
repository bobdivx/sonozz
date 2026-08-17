import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyArtistPhotoPatch,
  listArtistImageUrl,
  normalizeArtistPhotos,
} from "../src/lib/artistPhotos.js";

const JPEG = "data:image/jpeg;base64,/9j/4AAQ";
const PNG = "data:image/png;base64,iVBORw0K";
const HTTP = "https://cdn.example/photo.jpg";

describe("normalizeArtistPhotos", () => {
  it("garde data URL, HTTP et /api (plus seulement le JPEG collé)", () => {
    const out = normalizeArtistPhotos(
      [JPEG, HTTP, "/api/audio/stream?key=x", "data:image/svg+xml,nope", ""],
      PNG,
    );
    assert.deepEqual(out, [JPEG, HTTP, "/api/audio/stream?key=x", PNG]);
  });

  it("se rabat sur imageUrl si photos vide", () => {
    assert.deepEqual(normalizeArtistPhotos([], HTTP), [HTTP]);
  });
});

describe("applyArtistPhotoPatch", () => {
  it("un ajout remplace la liste et le portrait", () => {
    const next = applyArtistPhotoPatch(
      { imageUrl: HTTP, photos: [HTTP] },
      { photos: [HTTP, JPEG] },
    );
    assert.equal(next.imageUrl, HTTP);
    assert.deepEqual(next.photos, [HTTP, JPEG]);
  });

  it("une suppression vide vraiment le portrait (plus de restauration silencieuse)", () => {
    const next = applyArtistPhotoPatch(
      { imageUrl: HTTP, photos: [HTTP, JPEG] },
      { photos: [], imageUrl: null },
    );
    assert.equal(next.imageUrl, null);
    assert.equal(next.photos, undefined);
  });

  it("un patch voix ne touche pas aux photos", () => {
    const prev = { imageUrl: HTTP, photos: [HTTP], voiceSample: { url: "a" } };
    const next = applyArtistPhotoPatch(prev, { voiceSample: { url: "b" } });
    assert.equal(next.imageUrl, HTTP);
    assert.deepEqual(next.photos, [HTTP]);
  });

  it("photos: undefined n’est pas un clear", () => {
    const next = applyArtistPhotoPatch(
      { imageUrl: HTTP, photos: [HTTP] },
      { photos: undefined, imageUrl: PNG },
    );
    assert.equal(next.imageUrl, PNG);
    assert.ok(next.photos.includes(PNG));
  });
});

describe("listArtistImageUrl", () => {
  it("pointe vers /photo au lieu d'embarquer une data URL lourde", () => {
    const huge = `data:image/jpeg;base64,${"A".repeat(300_000)}`;
    const url = listArtistImageUrl("etherel", { imageUrl: huge });
    assert.match(url, /^\/api\/artists\/etherel\/photo\?v=/);
    assert.equal(listArtistImageUrl("etherel", { imageUrl: null, photos: [] }), null);
  });

  it("casse le cache avec updatedAt", () => {
    const url = listArtistImageUrl(
      "jeser-mathieu",
      { imageUrl: JPEG },
      "2026-08-17T21:59:00.000Z",
    );
    assert.equal(url, "/api/artists/jeser-mathieu/photo?v=2026-08-17T215900.000Z");
  });
});
