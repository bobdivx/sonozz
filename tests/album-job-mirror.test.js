import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetJobStorage } from "./helpers/localStorage.js";
import { listJobs, upsertJob } from "../src/lib/jobStore.js";
import {
  albumLiveSummary,
  canonicalAlbumJobId,
  dedupeStoredAlbumJobs,
  markAlbumMirrorDismissed,
  mirrorAlbumJob,
} from "../src/lib/albumJobMirror.js";

describe("albumJobMirror", () => {
  beforeEach(() => resetJobStorage());

  it("canonise l’id sur album-${projectId}", () => {
    assert.equal(
      canonicalAlbumJobId({ id: "alb_1", jobId: "step_old" }, "proj_1"),
      "album-proj_1",
    );
    assert.equal(canonicalAlbumJobId({ id: "alb_1" }, null), "album-remote-alb_1");
  });

  it("signale un album stale dans le résumé", () => {
    const summary = albumLiveSummary({
      title: "Échos Lumineux",
      status: "running",
      targetCount: 8,
      updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      tracks: [
        { status: "done" },
        { status: "done" },
        { status: "done" },
        { status: "done" },
        { status: "audio" },
      ],
      live: { message: "4/8 · Audio prêt", percent: 40, label: "Album · Échos Lumineux" },
    });
    assert.match(summary.message, /Plus de progression/);
    assert.equal(summary.label, "Album · Échos Lumineux");
  });

  it("fusionne le miroir remote et le job local du même projet", () => {
    upsertJob({
      id: "album-remote-alb_1",
      type: "step",
      status: "running",
      remoteAlbum: true,
      projectId: "proj_1",
      albumId: "alb_1",
      label: "Album · Échos Lumineux",
      message: "4/8 · Audio prêt",
    });
    upsertJob({
      id: "album-proj_1",
      type: "album",
      status: "running",
      projectId: "proj_1",
      label: "Album · Échos Lumineux",
      message: "Titre 4/8 — composition audio…",
    });

    mirrorAlbumJob(
      {
        id: "alb_1",
        title: "Échos Lumineux",
        status: "running",
        jobId: "album-proj_1",
        updatedAt: new Date().toISOString(),
        targetCount: 8,
        live: {
          percent: 40,
          message: "Titre 4/8 — composition audio…",
          label: "Album · Échos Lumineux",
        },
        tracks: [{ status: "done" }, { status: "audio" }],
      },
      "proj_1",
    );

    const jobs = listJobs().filter((j) => j.projectId === "proj_1");
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, "album-proj_1");
    assert.equal(jobs[0].remoteAlbum, undefined);
  });

  it("n’affiche plus running un album distant bloqué", () => {
    const album = {
      id: "alb_stale",
      title: "Échos Lumineux",
      status: "running",
      updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      targetCount: 8,
      tracks: [{ status: "done" }],
      live: { message: "4/8 · Audio prêt", percent: 40 },
    };
    upsertJob({
      id: "album-proj_stale",
      type: "album",
      status: "running",
      remoteAlbum: true,
      projectId: "proj_stale",
      albumId: "alb_stale",
    });
    const next = mirrorAlbumJob(album, "proj_stale");
    assert.equal(next.status, "interrupted");
    assert.match(next.message, /Plus de progression|arrêté/);
  });

  it("ne ressuscite pas une carte après dismiss", () => {
    const album = {
      id: "alb_gone",
      title: "X",
      status: "running",
      updatedAt: new Date(Date.now() - 1000).toISOString(),
      tracks: [],
    };
    markAlbumMirrorDismissed("alb_gone", "proj_gone");
    const next = mirrorAlbumJob(album, "proj_gone");
    assert.equal(next, null);
    assert.equal(listJobs().length, 0);
  });

  it("déduplique au boot les cartes déjà stockées", () => {
    upsertJob({
      id: "album-remote-alb_1",
      type: "step",
      remoteAlbum: true,
      status: "running",
      projectId: "proj_1",
      albumId: "alb_1",
    });
    upsertJob({
      id: "album-proj_1",
      type: "album",
      status: "running",
      projectId: "proj_1",
    });
    dedupeStoredAlbumJobs();
    const jobs = listJobs().filter((j) => j.projectId === "proj_1");
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, "album-proj_1");
  });
});
