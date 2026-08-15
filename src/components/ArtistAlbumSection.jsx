import { useEffect, useRef, useState } from "preact/hooks";
import { Library } from "lucide-preact";
import AlbumAutonomePanel from "./AlbumAutonomePanel.jsx";
import { api } from "../lib/apiClient.js";
import { persistAudioRemote } from "../lib/audioResolve.js";
import { keysReady, loadKeys, isStudioEnabled } from "../lib/keys.js";
import { createAlbumId, createAlbumTrackId, emptyProject, isTrackAudioFinal } from "../lib/studio.js";
import { patchJob } from "../lib/jobStore.js";
import { finishStepJob, trackStepJob } from "../lib/jobRunner.js";
import { mirrorAlbumJob } from "../lib/albumJobMirror.js";

/**
 * Section Album autonome sur la fiche artiste.
 * Choisit un projet lead (audio + paroles), lance la gen, persiste sur Turso.
 */
export default function ArtistAlbumSection({ slug, releases = [] }) {
  const leadCandidates = releases.filter((r) => r.hasAudio && r.hasLyrics);
  const albumProjects = releases.filter((r) => r.albumStatus);
  const defaultLeadId =
    albumProjects.find((r) => r.albumStatus === "running")?.id ||
    albumProjects[0]?.id ||
    leadCandidates[0]?.id ||
    null;

  const [leadId, setLeadId] = useState(defaultLeadId);
  const [project, setProject] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [seed, setSeed] = useState({});
  const [loading, setLoading] = useState(false);
  const [bootLoading, setBootLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null);
  const [albumSize, setAlbumSize] = useState(8);
  const [canGenerateAudio, setCanGenerateAudio] = useState(false);

  const albumLocalRunRef = useRef(false);
  const albumAbortRef = useRef(null);
  const albumWorkingRef = useRef(null);

  useEffect(() => {
    const keys = loadKeys();
    const provider = String(keys.musicProvider || "").trim();
    setCanGenerateAudio(
      (provider === "songgen" && isStudioEnabled(keys, "songgen")) ||
        (provider === "acestep" && isStudioEnabled(keys, "acestep")) ||
        (isStudioEnabled(keys, "replicate") && Boolean(keys.replicateApiToken?.trim())),
    );
  }, []);

  useEffect(() => {
    if (!defaultLeadId) return;
    setLeadId((prev) => prev || defaultLeadId);
  }, [defaultLeadId]);

  useEffect(() => {
    if (!leadId) {
      setProject(null);
      setProjectId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setBootLoading(true);
      setError("");
      try {
        const { project: saved } = await api.getProject(leadId);
        if (cancelled) return;
        setProjectId(saved.id);
        setProject({ ...emptyProject(), ...(saved.project || {}) });
        setSeed(saved.seed || {});
        if (saved.project?.album) mirrorAlbumJob(saved.project.album, saved.id);
      } catch (e) {
        if (!cancelled) setError(e.message || "Projet lead introuvable");
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  // Poll album distant
  useEffect(() => {
    const running = project?.album?.status === "running";
    if (!running || !projectId || albumLocalRunRef.current) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || albumLocalRunRef.current) return;
      try {
        const { project: saved } = await api.getProject(projectId);
        if (cancelled || albumLocalRunRef.current) return;
        const remoteAlbum = saved?.project?.album;
        if (!remoteAlbum) return;
        mirrorAlbumJob(remoteAlbum, projectId);
        setProject((prev) =>
          prev ? { ...prev, album: remoteAlbum } : prev,
        );
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [project?.album?.status, projectId]);

  async function persist(nextProject, event, opts = {}) {
    const { skipLocalUpdate = false } = opts;
    const data = await api.saveProject({
      id: projectId,
      project: nextProject,
      seed,
      event,
    });
    const saved = data.project;
    setProjectId(saved.id);
    if (!skipLocalUpdate) {
      setProject(nextProject);
    }
    return saved;
  }

  function syncAlbumWorking(next) {
    albumWorkingRef.current = next;
    setProject(next);
    return next;
  }

  function cancelAlbum() {
    if (albumAbortRef.current) {
      albumAbortRef.current.aborted = true;
      return;
    }
    if (project?.album?.status !== "running") return;
    const next = {
      ...project,
      album: {
        ...project.album,
        status: "cancelled",
        live: {
          percent: 100,
          message: "Album arrêté",
          label: project.album?.live?.label || project.album?.title || "Album",
        },
        tracks: (project.album.tracks || []).map((t) =>
          t.status === "lyrics" || t.status === "audio"
            ? { ...t, status: "pending", error: undefined }
            : t,
        ),
        updatedAt: new Date().toISOString(),
      },
    };
    setProject(next);
    mirrorAlbumJob(next.album, projectId);
    persist(next, { stepKey: "album", eventType: "album", message: "Album arrêté" });
  }

  async function clearAlbum() {
    if (albumLocalRunRef.current) cancelAlbum();
    const base = albumWorkingRef.current || project;
    if (!base?.album) return;
    const next = { ...base, album: null };
    syncAlbumWorking(next);
    await persist(next, { stepKey: "album", eventType: "album", message: "Album effacé" });
  }

  async function removeTrack(trackId) {
    if (!trackId) return;
    const base = albumWorkingRef.current || project;
    if (!base?.album?.tracks?.length) return;
    const entry = base.album.tracks.find((t) => t.id === trackId);
    if (!entry) return;

    const remaining = base.album.tracks.filter((t) => t.id !== trackId);
    if (entry.role === "lead" || remaining.length === 0) {
      await clearAlbum();
      return;
    }

    const tracks = remaining.map((t, i) => ({ ...t, index: i + 1 }));
    const doneCount = tracks.filter((t) => t.status === "done").length;
    const stillPending = tracks.some(
      (t) => t.status === "pending" || t.status === "lyrics" || t.status === "audio",
    );
    const next = {
      ...base,
      album: {
        ...base.album,
        tracks,
        targetCount: tracks.length,
        status:
          base.album.status === "running" && stillPending
            ? "running"
            : doneCount > 0
              ? "done"
              : base.album.status === "running"
                ? "cancelled"
                : base.album.status,
        updatedAt: new Date().toISOString(),
      },
    };
    syncAlbumWorking(next);
    await persist(
      next,
      {
        stepKey: "album",
        eventType: "album-track",
        message: `Album · piste retirée`,
      },
      { skipLocalUpdate: albumLocalRunRef.current },
    );
  }

  async function runAlbumGeneration(totalCount = 8) {
    if (!keysReady(loadKeys())) {
      setError("Configure d’abord un LLM (Gemini ou Ollama) dans Paramètres.");
      return;
    }
    if (!isTrackAudioFinal(project?.track)) {
      setError(
        project?.track?.status === "preview-ready" || project?.track?.isPreview
          ? "Génère d’abord le morceau complet du lead (après l’extrait) dans le Studio."
          : "Le lead doit avoir un audio prêt.",
      );
      return;
    }
    if (!project.artist || !project.lyrics) {
      setError("Artiste et paroles du lead requis.");
      return;
    }
    if (albumLocalRunRef.current) return;

    const total = Math.min(12, Math.max(3, Number(totalCount) || 8));
    const extra = total - 1;
    const abortState = { aborted: false };
    albumAbortRef.current = abortState;
    albumLocalRunRef.current = true;
    setLoading(true);
    setProgress({ percent: 2, message: "Planification de la tracklist…" });
    setError("");

    const jobId = trackStepJob({
      type: "step",
      label: `Album · ${total} titres`,
      projectId,
      stepKey: "4",
      message: "Planification tracklist…",
      progress: 4,
      href: `/artiste/${encodeURIComponent(slug)}`,
    });

    let lastLivePersistAt = 0;
    let working = {
      ...project,
      album: {
        id: createAlbumId(),
        title: "",
        concept: "",
        targetCount: total,
        status: "running",
        jobId,
        live: {
          percent: 2,
          message: "Planification de la tracklist…",
          label: `Album · ${total} titres`,
        },
        tracks: [
          {
            id: createAlbumTrackId(),
            index: 1,
            role: "lead",
            theme: project.lyrics?.theme || project.track?.title || "",
            workingTitle: project.lyrics?.title || project.track?.title || "Lead",
            lyrics: project.lyrics,
            track: project.track,
            status: "done",
          },
        ],
        updatedAt: new Date().toISOString(),
      },
    };
    syncAlbumWorking(working);

    const persistAlbum = (event) => persist(working, event, { skipLocalUpdate: true });

    const setAlbumLive = (percent, message, { persistNow = false } = {}) => {
      working = albumWorkingRef.current || working;
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
      syncAlbumWorking(working);
      patchJob(jobId, { progress: percent, message });
      setProgress({ percent, message });
      const now = Date.now();
      if (persistNow || now - lastLivePersistAt > 20_000) {
        lastLivePersistAt = now;
        return persist(working, null, { skipLocalUpdate: true });
      }
      return Promise.resolve(null);
    };

    try {
      await persistAlbum({
        stepKey: "album",
        eventType: "album",
        message: "Album · génération démarrée",
      });
      lastLivePersistAt = Date.now();

      const plan = await api.albumPlan({
        artist: project.artist,
        lyrics: project.lyrics,
        track: project.track,
        count: extra,
      });
      if (abortState.aborted) throw Object.assign(new Error("Album annulé"), { name: "AbortError" });

      working = {
        ...working,
        album: {
          ...working.album,
          title: plan.albumTitle || working.album.title,
          concept: plan.concept || "",
          jobId,
          live: {
            percent: 8,
            message: "Tracklist prête — génération des titres…",
            label: plan.albumTitle ? `Album · ${plan.albumTitle}` : `Album · ${total} titres`,
          },
          tracks: [
            working.album.tracks[0],
            ...(plan.tracks || []).map((t, i) => ({
              id: `${createAlbumTrackId()}_${i}`,
              index: i + 2,
              role: "album",
              theme: t.theme,
              workingTitle: t.workingTitle || `Piste ${i + 2}`,
              lyrics: null,
              track: null,
              status: "pending",
            })),
          ],
          updatedAt: new Date().toISOString(),
        },
      };
      syncAlbumWorking(working);
      await persistAlbum({
        stepKey: "album",
        eventType: "album",
        message: `Tracklist « ${working.album.title} » planifiée`,
      });
      lastLivePersistAt = Date.now();
      patchJob(jobId, {
        progress: 8,
        message: "Tracklist prête — génération des titres…",
        label: plan.albumTitle ? `Album · ${plan.albumTitle}` : `Album · ${total} titres`,
      });

      const slots = working.album.tracks.filter((t) => t.role !== "lead");
      const lang = project.lyrics?.language || project.artist?.language || "fr";

      for (let i = 0; i < slots.length; i++) {
        if (abortState.aborted) break;
        working = albumWorkingRef.current || working;

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
                syncAlbumWorking(working);
              }
            }
          } catch {
            /* ignore */
          }
        }

        const slot = slots[i];
        if (!working.album.tracks.some((t) => t.id === slot.id)) continue;
        const basePct = Math.round(((i + 0.15) / slots.length) * 90) + 5;

        const mark = (patch) => {
          working = albumWorkingRef.current || working;
          working = {
            ...working,
            album: {
              ...working.album,
              tracks: working.album.tracks.map((t) =>
                t.id === slot.id ? { ...t, ...patch } : t,
              ),
              updatedAt: new Date().toISOString(),
            },
          };
          syncAlbumWorking(working);
        };

        mark({ status: "lyrics", error: undefined });
        await setAlbumLive(
          basePct,
          `Titre ${slot.index}/${total} — paroles « ${slot.workingTitle} »…`,
          { persistNow: true },
        );

        if (abortState.aborted) break;

        let lyricsI;
        try {
          lyricsI = await api.lyrics({
            theme: `${slot.workingTitle} — ${slot.theme}`,
            artist: project.artist,
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
        await setAlbumLive(
          basePct + 4,
          `Titre ${slot.index}/${total} — composition audio…`,
          { persistNow: true },
        );

        let trackI;
        try {
          trackI = await api.track(
            {
              lyrics: lyricsI,
              artist: {
                ...project.artist,
                musicArrange: project.musicArrange,
              },
            },
            (p) => {
              if (abortState.aborted) return;
              const local = Math.min(
                96,
                basePct + 4 + Math.round(((Number(p?.percent) || 0) / 100) * (80 / slots.length)),
              );
              void setAlbumLive(local, `${slot.index}/${total} · ${p?.message || "audio…"}`);
            },
            { signal: abortState },
          );
        } catch (e) {
          if (abortState.aborted || e?.name === "AbortError") break;
          mark({ status: "error", error: e.message || "Audio échoué" });
          await setAlbumLive(basePct + 4, `Erreur audio titre ${slot.index}`, {
            persistNow: true,
          });
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

        const doneSoFar = working.album.tracks.filter((t) => t.status === "done").length;
        await setAlbumLive(
          Math.min(96, Math.round((doneSoFar / total) * 90) + 5),
          `Album · titre ${slot.index} « ${lyricsI?.title || slot.workingTitle} »`,
          { persistNow: true },
        );
      }

      working = albumWorkingRef.current || working;
      const doneCount = working.album.tracks.filter((t) => t.status === "done").length;
      const failed = working.album.tracks.filter((t) => t.status === "error").length;
      const wasCancelled = abortState.aborted;
      const tracks = working.album.tracks.map((t) => {
        if (wasCancelled && (t.status === "lyrics" || t.status === "audio")) {
          return { ...t, status: "pending", error: undefined };
        }
        return t;
      });
      const finalStatus = wasCancelled
        ? "cancelled"
        : failed && doneCount <= 1
          ? "error"
          : "done";
      const finalMsg = wasCancelled
        ? `Album annulé · ${doneCount}/${tracks.length} titres`
        : failed > 0
          ? `Album partiel · ${doneCount} OK, ${failed} en erreur`
          : `Album prêt · ${doneCount} titres`;
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
      syncAlbumWorking(working);
      await persist(working, {
        stepKey: "album",
        eventType: "album",
        message: finalMsg,
      });
      finishStepJob(jobId, {
        ok: !wasCancelled && failed === 0,
        message: finalMsg,
        progress: 100,
      });
      setProgress({ percent: 100, message: finalMsg });
    } catch (e) {
      const wasAbort = e?.name === "AbortError" || abortState.aborted;
      if (!wasAbort) setError(e.message || "Album interrompu");
      working = albumWorkingRef.current || working;
      working = {
        ...working,
        album: {
          ...(working.album || {}),
          status: wasAbort ? "cancelled" : "error",
          live: {
            percent: 100,
            message: wasAbort ? "Album annulé" : e.message || "Album en erreur",
            label: working.album?.live?.label || `Album · ${total} titres`,
          },
          updatedAt: new Date().toISOString(),
        },
      };
      syncAlbumWorking(working);
      try {
        await persist(working, {
          stepKey: "album",
          eventType: "album",
          message: wasAbort ? "Album annulé" : `Album erreur · ${e.message || "?"}`,
        });
      } catch {
        /* ignore */
      }
      finishStepJob(jobId, {
        ok: false,
        message: wasAbort ? "Album annulé" : e.message || "Album en erreur",
      });
    } finally {
      albumLocalRunRef.current = false;
      albumAbortRef.current = null;
      setLoading(false);
      setTimeout(() => setProgress(null), 2500);
    }
  }

  function openTrack(entry) {
    if (!entry || (!entry.lyrics && !entry.track)) return;
    // Ouvre le projet lead dans le Studio avec ce contenu sélectionné
    const href = projectId ? `/?project=${projectId}&step=4` : "/";
    window.location.href = href;
  }

  if (!leadCandidates.length && !albumProjects.length) {
    return (
      <section class="space-y-3">
        <h2 class="font-display flex items-center gap-2 text-2xl font-bold">
          <Library size={22} /> Album autonome
        </h2>
        <p class="text-sm text-base-content/65">
          Il faut d’abord un single lead avec paroles + audio (créé dans le Studio) pour lancer un
          album.
        </p>
      </section>
    );
  }

  const leadTitle =
    project?.lyrics?.title ||
    project?.track?.title ||
    leadCandidates.find((r) => r.id === leadId)?.trackTitle ||
    "";

  return (
    <section class="space-y-4">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <h2 class="font-display flex items-center gap-2 text-2xl font-bold">
          <Library size={22} /> Album autonome
        </h2>
        {leadCandidates.length > 1 && (
          <label class="form-control w-full max-w-xs">
            <span class="label-text text-xs text-base-content/55">Single lead</span>
            <select
              class="select select-bordered select-sm"
              value={leadId || ""}
              disabled={loading || project?.album?.status === "running"}
              onChange={(e) => setLeadId(e.currentTarget.value || null)}
            >
              {leadCandidates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.trackTitle || r.title || r.id}
                  {r.albumStatus ? ` · album ${r.albumStatus}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && (
        <div class="border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>
      )}
      {bootLoading && (
        <p class="text-sm text-base-content/55">
          <span class="loading loading-spinner loading-xs" /> Chargement du lead…
        </p>
      )}

      {!bootLoading && project && (
        <AlbumAutonomePanel
          album={project.album}
          albumSize={albumSize}
          onAlbumSizeChange={setAlbumSize}
          loading={loading}
          canGenerate={canGenerateAudio && isTrackAudioFinal(project.track) && Boolean(project.lyrics)}
          progress={progress}
          leadTitle={leadTitle}
          onGenerate={runAlbumGeneration}
          onCancel={cancelAlbum}
          onClear={clearAlbum}
          onRemoveTrack={removeTrack}
          onOpenTrack={openTrack}
          studioHref={projectId ? `/?project=${projectId}&step=4` : null}
        />
      )}
    </section>
  );
}
