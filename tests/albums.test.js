import { describe, it, before } from "node:test";
import assert from "node:assert";
import {
  createAlbum,
  getAlbum,
  updateAlbum,
  listAlbumsByArtist,
  addAlbumTrack,
  updateAlbumTrack,
  deleteAlbumTrack,
  deleteAlbum,
  ensureSchema,
} from "../src/server/db.js";
import { createAlbumFromLead, organizeAlbumsFromReleases } from "../src/server/albums.js";

describe("Albums System", () => {
  before(async () => {
    await ensureSchema();
  });

  it("devrait créer un album", async () => {
    const album = await createAlbum({
      artistSlug: "test-artist",
      title: "Premier Album",
      concept: "Album de test",
      targetCount: 10,
      status: "draft",
    });

    assert.ok(album.id);
    assert.strictEqual(album.title, "Premier Album");
    assert.strictEqual(album.artistSlug, "test-artist");
    assert.strictEqual(album.concept, "Album de test");
    assert.strictEqual(album.targetCount, 10);
  });

  it("devrait récupérer un album avec ses tracks", async () => {
    const created = await createAlbum({
      artistSlug: "test-artist",
      title: "Album avec Tracks",
      targetCount: 5,
    });

    await addAlbumTrack({
      albumId: created.id,
      role: "lead",
      index: 1,
      workingTitle: "Lead Track",
      status: "done",
    });

    await addAlbumTrack({
      albumId: created.id,
      role: "member",
      index: 2,
      workingTitle: "Second Track",
      status: "pending",
    });

    const album = await getAlbum(created.id);

    assert.strictEqual(album.tracks.length, 2);
    assert.strictEqual(album.tracks[0].workingTitle, "Lead Track");
    assert.strictEqual(album.tracks[0].role, "lead");
    assert.strictEqual(album.tracks[1].workingTitle, "Second Track");
  });

  it("devrait mettre à jour un album", async () => {
    const created = await createAlbum({
      artistSlug: "test-artist",
      title: "Album Original",
      targetCount: 8,
    });

    const updated = await updateAlbum(created.id, {
      title: "Album Mis à Jour",
      status: "running",
      coverUrl: "https://example.com/cover.jpg",
    });

    assert.strictEqual(updated.title, "Album Mis à Jour");
    assert.strictEqual(updated.status, "running");
    assert.strictEqual(updated.coverUrl, "https://example.com/cover.jpg");
  });

  it("devrait lister les albums d'un artiste", async () => {
    const slug = "test-artist-list";

    await createAlbum({
      artistSlug: slug,
      title: "Album 1",
      targetCount: 8,
    });

    await createAlbum({
      artistSlug: slug,
      title: "Album 2",
      targetCount: 10,
    });

    const albums = await listAlbumsByArtist(slug);

    assert.ok(albums.length >= 2);
    const titles = albums.map((a) => a.title);
    assert.ok(titles.includes("Album 1"));
    assert.ok(titles.includes("Album 2"));
  });

  it("devrait mettre à jour un track", async () => {
    const album = await createAlbum({
      artistSlug: "test-artist",
      title: "Album Track Update",
      targetCount: 5,
    });

    const track = await addAlbumTrack({
      albumId: album.id,
      role: "member",
      index: 1,
      workingTitle: "Original Title",
      status: "pending",
    });

    await updateAlbumTrack(track.id, {
      workingTitle: "Updated Title",
      status: "done",
    });

    const updated = await getAlbum(album.id);
    const updatedTrack = updated.tracks.find((t) => t.id === track.id);

    assert.strictEqual(updatedTrack.workingTitle, "Updated Title");
    assert.strictEqual(updatedTrack.status, "done");
  });

  it("devrait supprimer un track", async () => {
    const album = await createAlbum({
      artistSlug: "test-artist",
      title: "Album Track Delete",
      targetCount: 3,
    });

    const track1 = await addAlbumTrack({
      albumId: album.id,
      role: "lead",
      index: 1,
      workingTitle: "Track 1",
    });

    const track2 = await addAlbumTrack({
      albumId: album.id,
      role: "member",
      index: 2,
      workingTitle: "Track 2",
    });

    await deleteAlbumTrack(track2.id);

    const updated = await getAlbum(album.id);
    assert.strictEqual(updated.tracks.length, 1);
    assert.strictEqual(updated.tracks[0].id, track1.id);
  });

  it("devrait organiser les albums avec les releases", () => {
    const releases = [
      { id: "r1", trackTitle: "Track 1", hasAudio: true, coverUrl: "cover1.jpg" },
      { id: "r2", trackTitle: "Track 2", hasAudio: true, coverUrl: "cover2.jpg" },
      { id: "r3", trackTitle: "Single 1", hasAudio: true, coverUrl: "single1.jpg" },
      { id: "r4", trackTitle: "Single 2", hasAudio: true, coverUrl: "single2.jpg" },
    ];

    const albumsData = [
      {
        id: "alb1",
        title: "Test Album",
        status: "done",
        targetCount: 2,
        doneCount: 2,
        tracks: [
          { id: "t1", projectId: "r1", role: "lead", index: 1 },
          { id: "t2", projectId: "r2", role: "member", index: 2 },
        ],
      },
    ];

    const { albums, singles } = organizeAlbumsFromReleases(releases, albumsData);

    assert.strictEqual(albums.length, 1);
    assert.strictEqual(albums[0].title, "Test Album");
    assert.strictEqual(albums[0].tracks.length, 2);
    assert.strictEqual(singles.length, 2);
    assert.strictEqual(singles[0].id, "r3");
    assert.strictEqual(singles[1].id, "r4");
  });

  it("ne devrait pas écraser un album existant lors de la création d'un nouveau", async () => {
    const slug = "test-non-ecrasement";

    const album1 = await createAlbum({
      artistSlug: slug,
      title: "Premier Album",
      targetCount: 8,
    });

    await addAlbumTrack({
      albumId: album1.id,
      role: "lead",
      index: 1,
      workingTitle: "Lead Album 1",
    });

    const album2 = await createAlbum({
      artistSlug: slug,
      title: "Deuxième Album",
      targetCount: 10,
    });

    await addAlbumTrack({
      albumId: album2.id,
      role: "lead",
      index: 1,
      workingTitle: "Lead Album 2",
    });

    const albums = await listAlbumsByArtist(slug);
    const titles = albums.map((a) => a.title);

    assert.ok(titles.includes("Premier Album"));
    assert.ok(titles.includes("Deuxième Album"));

    const fullAlbum1 = await getAlbum(album1.id);
    const fullAlbum2 = await getAlbum(album2.id);

    assert.strictEqual(fullAlbum1.tracks[0].workingTitle, "Lead Album 1");
    assert.strictEqual(fullAlbum2.tracks[0].workingTitle, "Lead Album 2");
  });
});
