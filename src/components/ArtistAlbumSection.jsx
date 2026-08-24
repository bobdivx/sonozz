import { useEffect, useRef, useState } from "preact/hooks";
import { Library } from "lucide-preact";
import AlbumAutonomePanel from "./AlbumAutonomePanel.jsx";
import { api } from "../lib/apiClient.js";
import { keysReady, loadKeys, isStudioEnabled } from "../lib/keys.js";
import { emptyProject, isTrackAudioFinal, studioHref, artistAlbumHref } from "../lib/studio.js";
import { cancelAlbumJob, startAlbumJob } from "../lib/jobRunner.js";
import { mirrorAlbumJob } from "../lib/albumJobMirror.js";
import {
  albumStudioHref,
  cancelledAlbumState,
  ensureAlbumTrackProject,
} from "../lib/albumTracks.js";

/**
 * Section Album autonome sur la fiche artiste.
 * Choisit un projet lead (audio + paroles), lance la gen, persiste sur Turso.
 */
export default function ArtistAlbumSection({
  slug,
  releases = [],
  pinnedLeadId = null,
  embedded = false,
  createOnly = false,
}) {
  const leadCandidates = createOnly
    ? releases.filter((r) => r.hasAudio && r.hasLyrics && !r.albumStatus && !r.albumLeadId)
    : releases.filter((r) => r.hasAudio && r.hasLyrics && !r.albumLeadId);
  const albumProjects = releases.filter((r) => r.albumStatus);
  const existingAlbums = releases.filter((r) => r.albumStatus && (r.albumStatus === "done" || r.albumStatus === "cancelled" || r.albumStatus === "error"));
  const defaultLeadId =
    pinnedLeadId ||
    albumProjects.find((r) => r.albumStatus === "running")?.id ||
    (!createOnly && albumProjects[0]?.id) ||
    leadCandidates[0]?.id ||
    null;

  const [leadId, setLeadId] = useState(defaultLeadId);
  const [project, setProject] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [seed, setSeed] = useState({});
  const [bootLoading, setBootLoading] = useState(false);
  const [error, setError] = useState("");
  const [albumSize, setAlbumSize] = useState(8);
  const [canGenerateAudio, setCanGenerateAudio] = useState(false);

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
    if (pinnedLeadId) {
      setLeadId(pinnedLeadId);
      return;
    }
    if (!defaultLeadId) return;
    setLeadId((prev) => prev || defaultLeadId);
  }, [defaultLeadId, pinnedLeadId]);

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
    if (!running || !projectId) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const { project: saved } = await api.getProject(projectId);
        if (cancelled) return;
        const remoteAlbum = saved?.project?.album;
        if (!remoteAlbum) return;
        mirrorAlbumJob(remoteAlbum, projectId);
        setProject((prev) => (prev ? { ...prev, album: remoteAlbum } : prev));
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
    const latest = albumWorkingRef.current;
    if (latest?.album?.status === "cancelled" && nextProject?.album?.status === "running") {
      return latest;
    }
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
    cancelAlbumJob(projectId);
    const base = albumWorkingRef.current || project;
    if (base?.album?.status !== "running") return;
    const next = {
      ...base,
      album: cancelledAlbumState(base.album),
    };
    syncAlbumWorking(next);
    mirrorAlbumJob(next.album, projectId);
    persist(next, { stepKey: "album", eventType: "album", message: "Album arrêté" });
  }

  async function clearAlbum() {
    cancelAlbum();
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
    );
  }

  async function runAlbumGeneration(totalCount = 8, { resume = false } = {}) {
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
    if (project?.album?.status === "running") return;
    
    // Empêcher l'écrasement d'un album déjà terminé
    if (!resume && project?.album && (project.album.status === "done" || project.album.status === "cancelled" || project.album.status === "error")) {
      const confirmed = window.confirm(
        `Ce morceau a déjà un album (${project.album.title || "sans titre"}, statut: ${project.album.status}). Créer un nouvel album écrasera l'ancien. Veux-tu continuer ?`
      );
      if (!confirmed) {
        setError("Opération annulée — pour créer un nouvel album, utilise un autre single comme lead.");
        return;
      }
    }

    const total = Math.min(12, Math.max(3, Number(totalCount) || 8));
    setError("");
    const jobId = startAlbumJob({
      projectId,
      totalCount: total,
      resume,
      href: artistAlbumHref(slug, projectId),
      label: `Album · ${total} titres`,
    });
    setProject((prev) =>
      prev
        ? {
            ...prev,
            album: {
              ...(prev.album || {}),
              jobId,
              status: "running",
              live: {
                percent: resume ? 8 : 4,
                message: resume ? "Reprise de l’album…" : "Démarrage album…",
                label: prev.album?.title ? `Album · ${prev.album.title}` : `Album · ${total} titres`,
              },
              updatedAt: new Date().toISOString(),
            },
          }
        : prev,
    );
  }

  async function openTrack(entry) {
    if (!entry || (!entry.lyrics && !entry.track)) return;
    if (entry.role === "lead") {
      window.location.href = albumStudioHref(entry, projectId);
      return;
    }
    try {
      setError("");
      const linked = await ensureAlbumTrackProject(entry, {
        leadProject: albumWorkingRef.current || project,
        seed,
        leadProjectId: projectId,
      });
      if (linked?.projectId && linked.projectId !== entry.projectId) {
        const base = albumWorkingRef.current || project;
        const next = {
          ...base,
          album: {
            ...base.album,
            tracks: (base.album?.tracks || []).map((t) =>
              t.id === entry.id ? { ...t, projectId: linked.projectId } : t,
            ),
            updatedAt: new Date().toISOString(),
          },
        };
        syncAlbumWorking(next);
        await persist(next, {
          stepKey: "album",
          eventType: "album-track",
          message: `Album · projet Studio pour « ${entry.lyrics?.title || entry.workingTitle} »`,
        });
      }
      window.location.href = albumStudioHref(linked, projectId);
    } catch (e) {
      setError(e.message || "Impossible d’ouvrir ce titre");
    }
  }

  if (!leadCandidates.length && !albumProjects.length && !pinnedLeadId) {
    if (createOnly || embedded) return null;
    return (
      <section class="rounded-3xl border border-dashed border-base-content/15 bg-base-300/20 px-5 py-6">
        <h2 class="font-display flex items-center gap-2 text-xl font-bold">
          <Library size={20} /> Album
        </h2>
        <p class="mt-1 text-sm text-base-content/60">
          Dès qu’un titre a paroles + audio, tu pourras en faire un album complet ici.
        </p>
      </section>
    );
  }

  if (createOnly && !leadCandidates.length) return null;

  const leadTitle =
    project?.lyrics?.title ||
    project?.track?.title ||
    leadCandidates.find((r) => r.id === leadId)?.trackTitle ||
    "";

  return (
    <section
      class={
        embedded
          ? "space-y-4"
          : "space-y-4 rounded-3xl border border-base-content/10 bg-base-300/30 p-5"
      }
    >
      {!embedded && (
      <div class="flex flex-wrap items-end justify-between gap-3">
        <h2 class="font-display flex items-center gap-2 text-xl font-bold">
          <Library size={20} /> {createOnly ? "Créer un album" : "Gérer l’album"}
        </h2>
        {!pinnedLeadId && leadCandidates.length > 1 && (
          <label class="form-control w-full max-w-xs">
            <span class="label-text text-xs text-base-content/55">Single lead</span>
            <select
              class="select select-bordered select-sm"
              value={leadId || ""}
              disabled={project?.album?.status === "running"}
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
      )}

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
          loading={project?.album?.status === "running"}
          canGenerate={canGenerateAudio && isTrackAudioFinal(project.track) && Boolean(project.lyrics)}
          progress={
            project.album?.live
              ? {
                  percent: project.album.live.percent,
                  message: project.album.live.message,
                }
              : null
          }
          leadTitle={leadTitle}
          onGenerate={runAlbumGeneration}
          onResume={() => runAlbumGeneration(albumSize, { resume: true })}
          onCancel={cancelAlbum}
          onClear={clearAlbum}
          onRemoveTrack={removeTrack}
          onOpenTrack={openTrack}
          studioHref={embedded ? null : studioHref(projectId, "tracks")}
          manageMode={Boolean(pinnedLeadId || project?.album)}
        />
      )}
    </section>
  );
}
