/**
 * Boucle de génération album (paroles + audio).
 * Tourne dans le job runner (Tâches) — survit à la navigation.
 */
import { api } from "../apiClient.js";
import { persistAudioRemote } from "../audioResolve.js";
import { emptyProject, createAlbumId, createAlbumTrackId } from "../studio.js";
import {
  applySonicVariation,
  artistWithSonicVariation,
} from "../sonicVariation.js";
import {
  attachCoverToProject,
  albumNeedsCover,
  buildAlbumCoverRequest,
  ensureAlbumTrackProject,
  isProviderUnreachableError,
  resumeAlbumTracks,
} from "../albumTracks.js";
import { probeMusicProvider, providerDownError } from "./provider.js";
import { assignAlbumAutoFeats } from "../albumAutoFeats.js";

export async function runAlbumJob({
  project,
  projectId,
  seed,
  totalCount = 8,
  resume = false,
  abortState,
  persist,
  syncWorking,
  getWorking,
  jobId,
  onProgress,
  preferredTitle = "",
  preferredConcept = "",
  withFeats = false,
  featArtists = [],
} = {}) {
  const total = Math.min(12, Math.max(3, Number(totalCount) || 8));
  const extra = total - 1;
  let lastLivePersistAt = 0;
  let providerDown = false;
  let working = null;

  const persistAlbum = (event) => {
    const current = getWorking?.() || working;
    if (current?.album?.status === "cancelled" || abortState?.aborted) {
      return Promise.resolve(null);
    }
    return persist(current, event, { skipLocalUpdate: true });
  };

  const setAlbumLive = (percent, message, { persistNow = false } = {}) => {
    if (abortState?.aborted || providerDown) return Promise.resolve(null);
    working = getWorking?.() || working;
    if (working?.album?.status === "cancelled") return Promise.resolve(null);
    working = {
      ...working,
      album: {
        ...working.album,
        live: {
          percent,
          message,
          label: working.album?.title
            ? `Album · ${working.album.title}`
            : `Album · ${working.album?.targetCount || total} titres`,
        },
        updatedAt: new Date().toISOString(),
      },
    };
    syncWorking(working);
    onProgress?.({ percent, message });
    const now = Date.now();
    if (persistNow || now - lastLivePersistAt > 20_000) {
      lastLivePersistAt = now;
      return persist(working, null, { skipLocalUpdate: true });
    }
    return Promise.resolve(null);
  };

  const persistAlbumCover = async (cover, { errorMessage } = {}) => {
    working = getWorking?.() || working;
    if (cover?.imageUrl) {
      working = attachCoverToProject(working, cover, { asAlbumCover: true });
    } else if (errorMessage && working?.album) {
      working = {
        ...working,
        album: { ...working.album, coverError: errorMessage },
      };
    }
    syncWorking(working);
    return working;
  };

  const syncCoverToMembers = async (cover) => {
    if (!cover?.imageUrl) return;
    const tracks = (getWorking?.() || working)?.album?.tracks || [];
    for (const t of tracks) {
      if (t.role === "lead" || !t.projectId) continue;
      try {
        const { project: saved } = await api.getProject(t.projectId);
        if (!saved?.id) continue;
        const current = { ...emptyProject(), ...(saved.project || {}) };
        if (current.cover?.imageUrl) continue;
        await api.saveProject({
          id: saved.id,
          project: attachCoverToProject(current, cover),
          seed: saved.seed,
          event: {
            stepKey: "cover",
            eventType: "album-cover",
            message: "Jaquette album",
          },
        });
      } catch {
        /* piste enfant optionnelle */
      }
    }
  };

  const ensureAlbumArtwork = async () => {
    working = getWorking?.() || working;
    if (abortState.aborted || !albumNeedsCover(working?.album)) return;
    await setAlbumLive(10, "Jaquette de l’album…", { persistNow: true });
    if (abortState.aborted) return;
    try {
      const cover = await api.cover(
        buildAlbumCoverRequest({
          artist: working.artist || project.artist,
          album: working.album,
          leadTrack: working.track || project.track,
          featArtist: working.featArtist || project.featArtist || null,
        }),
      );
      if (abortState.aborted) return;
      await persistAlbumCover(cover);
      await persistAlbum({
        stepKey: "cover",
        eventType: "album-cover",
        message: `Jaquette « ${working.album?.title || "album"} » générée`,
      });
      lastLivePersistAt = Date.now();
      onProgress?.({
        percent: 12,
        message: "Jaquette album prête — génération des titres…",
        label: working.album?.title
          ? `Album · ${working.album.title}`
          : working.album?.live?.label,
      });
    } catch (e) {
      if (abortState.aborted || e?.name === "AbortError") return;
      await persistAlbumCover(null, { errorMessage: e.message || "Jaquette échouée" });
      await setAlbumLive(
        12,
        `Jaquette reportée — ${e.message || "erreur"}`,
        { persistNow: true },
      );
    }
  };

  const existingExtras = (project?.album?.tracks || []).filter((t) => t.role !== "lead");
  const canResumeTracks = resume && existingExtras.length > 0;

  if (canResumeTracks) {
    const tracks = resumeAlbumTracks(project.album.tracks);
    working = {
      ...project,
      album: {
        ...project.album,
        status: "running",
        jobId,
        live: {
          percent: 8,
          message: "Reprise de l’album…",
          label: project.album?.title
            ? `Album · ${project.album.title}`
            : `Album · ${tracks.length} titres`,
        },
        tracks,
        updatedAt: new Date().toISOString(),
      },
    };
  } else {
    const keepId = resume && project?.album?.id;
    const leadTrack = (project?.album?.tracks || []).find((t) => t.role === "lead") || {
      id: createAlbumTrackId(),
      index: 1,
      role: "lead",
      theme: project.lyrics?.theme || project.track?.title || "",
      workingTitle: project.lyrics?.title || project.track?.title || "Lead",
      lyrics: project.lyrics,
      track: project.track,
      projectId,
      status: "done",
    };
    working = {
      ...project,
      album: {
        id: keepId || createAlbumId(),
        title:
          (keepId ? project.album?.title : "") ||
          String(preferredTitle || "").trim() ||
          "",
        concept:
          (keepId ? project.album?.concept : "") ||
          String(preferredConcept || "").trim() ||
          "",
        targetCount: total,
        status: "running",
        jobId,
        live: {
          percent: 2,
          message: "Planification de la tracklist…",
          label:
            String(preferredTitle || "").trim()
              ? `Album · ${String(preferredTitle).trim()}`
              : `Album · ${total} titres`,
        },
        tracks: [leadTrack],
        updatedAt: new Date().toISOString(),
      },
    };
  }
  syncWorking(working);

  const remoteWatch = projectId
    ? window.setInterval(async () => {
        if (abortState.aborted) return;
        try {
          const { project: saved } = await api.getProject(projectId);
          if (saved?.project?.album?.status === "cancelled") {
            abortState.aborted = true;
          }
        } catch {
          /* ignore */
        }
      }, 3000)
    : null;

  try {
    const probe = await probeMusicProvider();
    if (probe && probe.ok === false) throw providerDownError(probe);

    await persistAlbum({
      stepKey: "album",
      eventType: "album",
      message: resume ? "Album · reprise" : "Album · génération démarrée",
    });
    lastLivePersistAt = Date.now();

    if (!canResumeTracks) {
      const plan = await api.albumPlan({
        artist: project.artist,
        lyrics: project.lyrics,
        track: project.track,
        count: extra,
      });
      if (abortState.aborted) throw Object.assign(new Error("Album annulé"), { name: "AbortError" });

      const plannedTracks = (plan.tracks || []).map((t, i) => ({
        id: `${createAlbumTrackId()}_${i}`,
        index: i + 2,
        role: "album",
        theme: t.theme,
        workingTitle: t.workingTitle || `Piste ${i + 2}`,
        trackRole: t.trackRole || undefined,
        lyrics: null,
        track: null,
        status: "pending",
      }));
      const withAssignedFeats =
        withFeats || project.album?.withFeats
          ? assignAlbumAutoFeats(plannedTracks, featArtists)
          : plannedTracks;
      const featCount = withAssignedFeats.filter((t) => t.featArtist?.name).length;

      working = {
        ...working,
        album: {
          ...working.album,
          title: working.album.title || plan.albumTitle || working.album.title,
          concept: working.album.concept || plan.concept || "",
          withFeats: Boolean(withFeats || project.album?.withFeats),
          jobId,
          live: {
            percent: 8,
            message:
              featCount > 0
                ? `Tracklist prête — ${featCount} feat${featCount > 1 ? "s" : ""} auto…`
                : "Tracklist prête — génération des titres…",
            label: (working.album.title || plan.albumTitle)
              ? `Album · ${working.album.title || plan.albumTitle}`
              : `Album · ${total} titres`,
          },
          tracks: [working.album.tracks[0], ...withAssignedFeats],
          updatedAt: new Date().toISOString(),
        },
      };
      syncWorking(working);
      await persistAlbum({
        stepKey: "album",
        eventType: "album",
        message: `Tracklist « ${working.album.title} » planifiée`,
      });
      lastLivePersistAt = Date.now();
      onProgress?.({
        percent: 8,
        message: "Tracklist prête — génération des titres…",
        label: plan.albumTitle ? `Album · ${plan.albumTitle}` : `Album · ${total} titres`,
      });
    }

    await ensureAlbumArtwork();
    if (abortState.aborted) throw Object.assign(new Error("Album annulé"), { name: "AbortError" });

    const slots = working.album.tracks.filter((t) => t.role !== "lead" && t.status !== "done");
    const lang = project.lyrics?.language || project.artist?.language || "fr";
    const albumTotal = working.album.tracks.length || total;

    for (let i = 0; i < slots.length; i++) {
      if (abortState.aborted) break;
      working = getWorking?.() || working;

      if (projectId) {
        try {
          const { project: saved } = await api.getProject(projectId);
          const remote = saved?.project?.album;
          if (remote?.status === "cancelled") {
            abortState.aborted = true;
            break;
          }
          if (Array.isArray(remote?.tracks)) {
            const remoteIds = new Set(remote.tracks.map((t) => t.id));
            if (working.album.tracks.some((t) => !remoteIds.has(t.id))) {
              working = {
                ...working,
                album: {
                  ...working.album,
                  tracks: working.album.tracks.filter((t) => remoteIds.has(t.id)),
                  targetCount: remote.tracks.length,
                  updatedAt: new Date().toISOString(),
                },
              };
              syncWorking(working);
            }
          }
        } catch {
          /* ignore */
        }
      }

      const slot = slots[i];
      if (!working.album.tracks.some((t) => t.id === slot.id)) continue;
      const slotFeat =
        slot.featArtist ||
        working.album.tracks.find((t) => t.id === slot.id)?.featArtist ||
        null;
      const basePct = Math.round(((i + 0.15) / Math.max(1, slots.length)) * 90) + 5;

      const mark = (patch) => {
        working = getWorking?.() || working;
        working = {
          ...working,
          album: {
            ...working.album,
            tracks: working.album.tracks.map((t) => (t.id === slot.id ? { ...t, ...patch } : t)),
            updatedAt: new Date().toISOString(),
          },
        };
        syncWorking(working);
      };

      if (!slot.lyrics) {
        mark({ status: "lyrics", error: undefined });
        await setAlbumLive(
          basePct,
          `Titre ${slot.index}/${albumTotal} — paroles « ${slot.workingTitle} »${
            slotFeat?.name ? ` feat. ${slotFeat.name}` : ""
          }…`,
          { persistNow: true },
        );
        if (abortState.aborted) break;

        let lyricsI;
        try {
          lyricsI = await api.lyrics({
            theme: `${slot.workingTitle} — ${slot.theme}`,
            artist: {
              ...project.artist,
              featArtist: slotFeat || null,
            },
            trends: project.trends,
            language: lang,
          });
        } catch (e) {
          if (abortState.aborted) break;
          mark({ status: "error", error: e.message || "Paroles échouées" });
          await setAlbumLive(basePct, `Erreur paroles titre ${slot.index}`, { persistNow: true });
          continue;
        }
        if (abortState.aborted) break;
        if (!working.album.tracks.some((t) => t.id === slot.id)) continue;
        mark({
          lyrics: lyricsI,
          workingTitle: lyricsI?.title || slot.workingTitle,
          status: "audio",
        });
      } else {
        mark({ status: "audio", error: undefined });
      }

      const lyricsI =
        (getWorking?.() || working).album.tracks.find((t) => t.id === slot.id)?.lyrics || slot.lyrics;

      await setAlbumLive(
        basePct + 4,
        `Titre ${slot.index}/${albumTotal} — composition audio…`,
        { persistNow: true },
      );
      if (abortState.aborted) break;

      try {
        const ready = await probeMusicProvider();
        if (ready && ready.ok === false) {
          mark({ status: "pending", error: ready.message || "Studio audio injoignable" });
          providerDown = true;
          throw providerDownError(ready);
        }
      } catch (e) {
        if (e?.name === "ProviderDownError") throw e;
      }

      let trackI;
      try {
        const albumTotalForArc = albumTotal;
        const usedRoles = (getWorking?.() || working).album.tracks
          .filter((t) => t.id !== slot.id && t.sonicRole)
          .map((t) => t.sonicRole);
        const variation = applySonicVariation({
          musicArrange: project.musicArrange,
          styleLock: project.artist?.styleLock,
          role: slot.trackRole || (slot.role === "lead" ? "single" : undefined),
          title: lyricsI?.title || slot.workingTitle,
          artistKey: project.artist?.slug || project.artist?.name || "",
          trackIndex: slot.index,
          trackTotal: albumTotalForArc,
          usedRoles,
        });
        mark({
          sonicRole: variation.sonicRole,
          musicArrange: variation.musicArrange,
        });
        trackI = await api.track(
          {
            lyrics: lyricsI,
            artist: artistWithSonicVariation(
              {
                ...project.artist,
                featArtist: slotFeat || null,
              },
              variation,
            ),
          },
          (p) => {
            if (abortState.aborted) return;
            const local = Math.min(
              96,
              basePct + 4 + Math.round(((Number(p?.percent) || 0) / 100) * (80 / Math.max(1, slots.length))),
            );
            void setAlbumLive(local, `${slot.index}/${albumTotal} · ${p?.message || "audio…"}`);
            onProgress?.({
              percent: local,
              message: `Titre ${slot.index}/${albumTotal} — ${p?.message || "composition…"}`,
            });
          },
          { signal: abortState },
        );
      } catch (e) {
        if (abortState.aborted || e?.name === "AbortError") break;
        if (isProviderUnreachableError(e.message)) {
          mark({ status: "pending", error: e.message });
          providerDown = true;
          throw e;
        }
        mark({ status: "error", error: e.message || "Audio échoué" });
        await setAlbumLive(basePct + 4, `Erreur audio titre ${slot.index}`, { persistNow: true });
        continue;
      }
      if (abortState.aborted) break;
      if (!working.album.tracks.some((t) => t.id === slot.id)) continue;

      if (trackI?.audioUrl) {
        try {
          const saved = await persistAudioRemote(trackI.audioUrl, projectId || "anon");
          if (saved?.audioUrl) {
            trackI = {
              ...trackI,
              audioUrl: saved.audioUrl,
              audioS3Key: saved.s3Key,
              audioEphemeral: false,
              warning: undefined,
            };
          }
        } catch (persistErr) {
          trackI = {
            ...trackI,
            audioEphemeral: true,
            warning: persistErr.message || "Persistance S3 échouée",
          };
        }
      }

      mark({
        track: trackI,
        status: trackI?.audioUrl ? "done" : "error",
        error: trackI?.audioUrl ? undefined : "Pas d’audio",
      });

      try {
        const current = (getWorking?.() || working).album.tracks.find((t) => t.id === slot.id);
        if (current?.status === "done") {
          const linked = await ensureAlbumTrackProject(current, {
            leadProject: getWorking?.() || working,
            seed,
            leadProjectId: projectId,
          });
          if (linked?.projectId && linked.projectId !== current.projectId) {
            mark({ projectId: linked.projectId });
          }
        }
      } catch {
        /* projet enfant optionnel */
      }

      const doneSoFar = (getWorking?.() || working).album.tracks.filter((t) => t.status === "done").length;
      await setAlbumLive(
        Math.min(96, Math.round((doneSoFar / albumTotal) * 90) + 5),
        `Album · titre ${slot.index} « ${lyricsI?.title || slot.workingTitle} »`,
        { persistNow: true },
      );
    }

    working = getWorking?.() || working;
    await syncCoverToMembers(working.album?.cover);
    working = getWorking?.() || working;
    const doneCount = working.album.tracks.filter((t) => t.status === "done").length;
    const failed = working.album.tracks.filter((t) => t.status === "error").length;
    const wasCancelled = abortState.aborted;
    const tracks = working.album.tracks.map((t) => {
      if ((wasCancelled || providerDown) && (t.status === "lyrics" || t.status === "audio")) {
        return { ...t, status: "pending", error: t.error };
      }
      return t;
    });
    const finalStatus = wasCancelled
      ? "cancelled"
      : providerDown
        ? "error"
        : failed && doneCount <= 1
          ? "error"
          : "done";
    const coverNote =
      working.album?.cover?.imageUrl
        ? ""
        : working.album?.coverError
          ? " · jaquette à reprendre"
          : "";
    const finalMsg = wasCancelled
      ? `Album annulé · ${doneCount}/${tracks.length} titres`
      : providerDown
        ? `Studio audio injoignable · ${doneCount} titres OK — reprends après correction`
        : failed > 0
          ? `Album partiel · ${doneCount} OK, ${failed} en erreur${coverNote}`
          : `Album prêt · ${doneCount} titres${coverNote}`;
    working = {
      ...working,
      album: {
        ...working.album,
        tracks,
        status: finalStatus,
        live: {
          percent: 100,
          message: finalMsg,
          label: working.album?.title
            ? `Album · ${working.album.title}`
            : `Album · ${tracks.length} titres`,
        },
        updatedAt: new Date().toISOString(),
      },
    };
    syncWorking(working);
    await persist(working, {
      stepKey: "album",
      eventType: "album",
      message: finalMsg,
    });
    return { ok: !wasCancelled && !providerDown && failed === 0, message: finalMsg, providerDown };
  } catch (e) {
    const wasAbort = e?.name === "AbortError" || abortState.aborted;
    const down = e?.name === "ProviderDownError" || providerDown || isProviderUnreachableError(e.message);
    working = getWorking?.() || working;
    const tracks = (working.album?.tracks || []).map((t) =>
      t.status === "lyrics" || t.status === "audio" ? { ...t, status: "pending", error: t.error } : t,
    );
    const finalMsg = wasAbort
      ? "Album annulé"
      : down
        ? e.message || "Studio audio injoignable"
        : e.message || "Album en erreur";
    working = {
      ...working,
      album: {
        ...(working.album || {}),
        tracks,
        status: wasAbort ? "cancelled" : "error",
        live: {
          percent: 100,
          message: finalMsg,
          label: working.album?.live?.label || `Album · ${total} titres`,
        },
        updatedAt: new Date().toISOString(),
      },
    };
    syncWorking(working);
    try {
      await persist(working, {
        stepKey: "album",
        eventType: "album",
        message: wasAbort ? "Album annulé" : `Album erreur · ${e.message || "?"}`,
      });
    } catch {
      /* ignore */
    }
    const err = new Error(finalMsg);
    err.name = wasAbort ? "AbortError" : down ? "ProviderDownError" : e.name;
    throw err;
  } finally {
    if (remoteWatch) window.clearInterval(remoteWatch);
  }
}
