import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  albumHasWorkLeft,
  albumNeedsCover,
  albumStudioHref,
  attachCoverToProject,
  buildAlbumCoverRequest,
  buildAlbumMemberProject,
  cancelledAlbumState,
  isAlbumStale,
  isProviderUnreachableError,
  organizeArtistReleases,
  resumeAlbumTracks,
} from "../src/lib/albumTracks.js";
import { interpretAceProbe } from "../src/server/aceStep.js";

describe("albumTracks", () => {
  it("Ouvrir pointe vers le projet enfant, pas le lead", () => {
    assert.equal(
      albumStudioHref({ role: "lead" }, "proj_lead"),
      "/?project=proj_lead&step=4",
    );
    assert.equal(
      albumStudioHref({ role: "album", projectId: "proj_child" }, "proj_lead"),
      "/?project=proj_child&step=4",
    );
    assert.equal(
      albumStudioHref({ role: "album" }, "proj_lead"),
      "/?project=proj_lead&step=4",
    );
  });

  it("reprend les pistes non terminées sans toucher au lead", () => {
    const next = resumeAlbumTracks([
      { id: "1", role: "lead", status: "done" },
      { id: "2", role: "album", status: "done", lyrics: { title: "A" } },
      { id: "3", role: "album", status: "audio", lyrics: { title: "B" }, error: "hang" },
      { id: "4", role: "album", status: "error", error: "boom" },
    ]);
    assert.equal(next[0].status, "done");
    assert.equal(next[1].status, "done");
    assert.equal(next[2].status, "pending");
    assert.equal(next[2].lyrics.title, "B");
    assert.equal(next[3].status, "pending");
    assert.equal(next[3].error, undefined);
  });

  it("détecte un album encore à traiter et un hang stale", () => {
    const album = {
      status: "cancelled",
      tracks: [
        { role: "lead", status: "done" },
        { role: "album", status: "pending" },
      ],
    };
    assert.equal(albumHasWorkLeft(album), true);
    assert.equal(albumHasWorkLeft({ status: "done", tracks: [{ role: "album", status: "done" }] }), false);

    const stale = isAlbumStale({
      status: "running",
      updatedAt: new Date(Date.now() - 120_000).toISOString(),
    });
    assert.equal(stale, true);
    assert.equal(isAlbumStale({ status: "running", updatedAt: new Date().toISOString() }), false);
  });

  it("annule en remettant audio/paroles en attente", () => {
    const next = cancelledAlbumState({
      title: "X",
      status: "running",
      tracks: [
        { id: "1", status: "done" },
        { id: "2", status: "audio" },
      ],
    });
    assert.equal(next.status, "cancelled");
    assert.equal(next.tracks[0].status, "done");
    assert.equal(next.tracks[1].status, "pending");
  });

  it("clone un titre d’album dans un projet Studio", () => {
    const project = buildAlbumMemberProject({
      leadProjectId: "proj_lead",
      leadProject: {
        artist: { name: "Nova" },
        album: { id: "alb_1", title: "Échos", cover: { imageUrl: "https://cdn/jaquette.jpg" } },
        cover: { imageUrl: "https://cdn/single.jpg" },
      },
      entry: {
        id: "at_2",
        index: 2,
        theme: "nuit",
        lyrics: { title: "Faint Signal" },
        track: { audioUrl: "https://cdn/x.mp3" },
      },
    });
    assert.equal(project.artist.name, "Nova");
    assert.equal(project.lyrics.title, "Faint Signal");
    assert.equal(project.albumMeta.leadProjectId, "proj_lead");
    assert.equal(project.album, null);
    assert.equal(project.cover.imageUrl, "https://cdn/jaquette.jpg");
  });

  it("signale une jaquette album manquante", () => {
    assert.equal(albumNeedsCover({ title: "Nuit", tracks: [] }), true);
    assert.equal(albumNeedsCover({ cover: { imageUrl: "https://cdn/a.jpg" } }), false);
    assert.equal(albumNeedsCover(null), false);
  });

  it("prépare la requête jaquette avec le titre d’album", () => {
    const req = buildAlbumCoverRequest({
      artist: { name: "Nova" },
      album: { title: "Échos", concept: "nuits électriques" },
      leadTrack: { title: "Lead" },
    });
    assert.equal(req.album.title, "Échos");
    assert.equal(req.track.title, "Échos");
    assert.equal(req.track.mood, "nuits électriques");
  });

  it("pose la jaquette sur le projet lead sans perdre l’album", () => {
    const next = attachCoverToProject(
      {
        album: { title: "Échos", tracks: [] },
        cover: null,
      },
      { imageUrl: "https://cdn/jaquette.jpg", prompt: "lp" },
      { asAlbumCover: true },
    );
    assert.equal(next.cover.imageUrl, "https://cdn/jaquette.jpg");
    assert.equal(next.album.cover.imageUrl, "https://cdn/jaquette.jpg");
    assert.equal(next.album.title, "Échos");
  });

  it("regroupe les pistes d’album à part des singles", () => {
    const { albums, singles } = organizeArtistReleases([
      {
        id: "lead",
        trackTitle: "Intro",
        albumStatus: "done",
        albumTitle: "Nuit",
        albumIndex: 1,
        coverUrl: "/a.jpg",
      },
      { id: "c2", trackTitle: "Suite", albumLeadId: "lead", albumTitle: "Nuit", albumIndex: 2 },
      { id: "s1", trackTitle: "Single" },
    ]);
    assert.equal(albums.length, 1);
    assert.equal(albums[0].title, "Nuit");
    assert.equal(albums[0].tracks.length, 2);
    assert.equal(albums[0].tracks[1].id, "c2");
    assert.equal(singles.length, 1);
    assert.equal(singles[0].id, "s1");
  });

  it("reconnaît une erreur ACE injoignable", () => {
    assert.equal(isProviderUnreachableError("ACE-Step Studio injoignable (https://ace.briseteia.me)"), true);
    assert.equal(isProviderUnreachableError("Paroles LLM timeout"), false);
  });
});

describe("interpretAceProbe", () => {
  it("jette injoignable si tous les endpoints ont échoué", () => {
    const r = interpretAceProbe({
      base: "https://ace.briseteia.me",
      health: { healthy: false, error: "ACE-Step Studio injoignable (https://ace.briseteia.me)" },
      status: {},
    });
    assert.equal(r.unreachable, true);
    assert.match(r.message, /injoignable/);
  });

  it("distingue UI up / moteur Python down", () => {
    const r = interpretAceProbe({
      health: { healthy: false },
      status: { connected: false },
    });
    assert.equal(r.unreachable, false);
    assert.equal(r.pipelineUp, false);
    assert.match(r.message, /moteur Python/);
  });

  it("pipelineUp seulement si health + connected", () => {
    const r = interpretAceProbe({
      health: { healthy: true },
      status: { connected: true, activeModel: "turbo" },
    });
    assert.equal(r.pipelineUp, true);
    assert.equal(r.unreachable, false);
  });
});
