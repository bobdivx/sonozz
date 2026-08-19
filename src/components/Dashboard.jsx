import { useEffect, useRef, useState } from "preact/hooks";
import {
  BarChart3,
  PenLine,
  AudioLines,
  ImagePlus,
  Music2,
  Film,
  Share2,
  ChevronLeft,
  ChevronRight,
  Waves,
  Settings2,
  Zap,
  History,
  Save,
  Check,
  LoaderCircle,
  Library,
} from "lucide-preact";
import StatsStep from "./steps/StatsStep.jsx";
import LyricsStep from "./steps/LyricsStep.jsx";
import TracksStep from "./steps/TracksStep.jsx";
import CoverStep from "./steps/CoverStep.jsx";
import DistroKidStep from "./steps/DistroKidStep.jsx";
import ClipStep from "./steps/ClipStep.jsx";
import SocialStep from "./steps/SocialStep.jsx";
import HistoryPanel from "./HistoryPanel.jsx";
import AppShell from "./AppShell.jsx";
import ClipTrackPlayer from "./ClipTrackPlayer.jsx";
import {
  STEPS,
  emptyProject,
  languagesForProvider,
  songGenLanguageHint,
  languageEngineLabel,
  isPlaceholderTitle,
  isTrackAudioFinal,
  titleFromAudioFileName,
  studioHref,
  artistAlbumHref,
  STUDIO_STEP,
} from "../lib/studio.js";
import { api } from "../lib/apiClient.js";
import { keysReady, loadKeys, ensureKeysHydrated } from "../lib/keys.js";
import { persistAudioRemote } from "../lib/audioResolve.js";
import { migrateProjectClipBlobs } from "../lib/clipStore.js";
import { musicArrangeFromStyleLock } from "../lib/musicArrange.js";
import { withResolvedArtistGender } from "../lib/artistGender.js";
import {
  isClipReady,
  normalizeProjectClips,
  removeProjectClip,
  setActiveProjectClip,
  stripClipsForDb,
  upsertProjectClip,
} from "../lib/clipsModel.js";
import {
  appendVersion,
  deleteVersion,
  normalizeProjectVersions,
  selectVersion,
  updateVersion,
} from "../lib/versionsModel.js";
import { patchJob, subscribeJobs } from "../lib/jobStore.js";
import { mirrorAlbumJob } from "../lib/albumJobMirror.js";
import { cancelledAlbumState, albumStudioHref } from "../lib/albumTracks.js";
import {
  bootJobRunner,
  cancelAlbumJob,
  cancelMusicTrackJob,
  finishPipelineJob,
  finishStepJob,
  startAlbumJob,
  startMusicTrackJob,
  trackPipelineJob,
  trackStepJob,
} from "../lib/jobRunner.js";

const ICONS = {
  stats: BarChart3,
  lyrics: PenLine,
  tracks: AudioLines,
  covers: ImagePlus,
  distrokid: Music2,
  clip: Film,
  social: Share2,
};

const STEP_STATUS_LABEL = {
  trends: "Tendances",
  stats: "Stats",
  lyrics: "Paroles",
  track: "Morceau",
  cover: "Jaquette",
  distrokid: "ONCE",
  clip: "Clip",
  social: "Réseaux",
  done: "Terminé",
  start: "Démarrage",
};

/** Étapes affichées pendant le pipeline auto (hors « done »). */
const AUTO_PIPELINE_UI = [
  { key: "trends", label: "Tendances" },
  { key: "lyrics", label: "Paroles" },
  { key: "track", label: "Morceau" },
  { key: "cover", label: "Jaquette" },
  { key: "distrokid", label: "ONCE" },
];

function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}

/** Clips + versions créatives (paroles / audio / jaquettes). */
function normalizeProjectState(project = {}) {
  return normalizeProjectVersions(normalizeProjectClips(project));
}

function resolveImportedTitle(meta = {}, project = {}) {
  const fromMeta = String(meta.title || "").trim();
  if (fromMeta) return fromMeta;
  const fromLyrics = String(project.lyrics?.title || "").trim();
  if (!isPlaceholderTitle(fromLyrics)) return fromLyrics;
  const fromTrack = String(project.track?.title || "").trim();
  if (!isPlaceholderTitle(fromTrack)) return fromTrack;
  const fromFile = titleFromAudioFileName(meta.fileName);
  if (fromFile) return fromFile;
  return fromTrack || fromLyrics || "Untitled";
}

function applySongTitle(project, title) {
  const cleaned = String(title || "").trim();
  if (!cleaned || isPlaceholderTitle(cleaned)) return project;
  let next = project;
  if (next.activeTrackId && next.track) {
    next = updateVersion(next, "track", next.activeTrackId, {
      ...next.track,
      title: cleaned,
    });
  }
  if (next.activeLyricsId && next.lyrics && isPlaceholderTitle(next.lyrics.title)) {
    next = updateVersion(next, "lyrics", next.activeLyricsId, {
      ...next.lyrics,
      title: cleaned,
    });
  }
  return next;
}

export default function Dashboard() {
  const [step, setStep] = useState(1);
  const [project, setProject] = useState(emptyProject);
  const [loading, setLoading] = useState(false);
  const [stepProgress, setStepProgress] = useState(null);
  /** Job morceau unique (Tâches) — survit à la navigation. */
  const [trackJob, setTrackJob] = useState(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoProgress, setAutoProgress] = useState({
    step: null,
    message: "",
    index: -1,
    total: AUTO_PIPELINE_UI.length,
    percent: 0,
  });
  const [elapsedMs, setElapsedMs] = useState(0);
  const autoStartedAt = useRef(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState([]);
  const [seed, setSeed] = useState({
    theme: "",
    market: "FR",
    language: "fr",
    artistSlug: "",
  });
  const [catalogArtists, setCatalogArtists] = useState([]);
  const [published, setPublished] = useState(false);
  const [projectId, setProjectId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  /** Accueil studio `/` uniquement — masqué quand un projet est ouvert via ?project= */
  const [showHomePipeline, setShowHomePipeline] = useState(true);
  /** Génération album lancée dans cet onglet (évite d’écraser l’état live par le poll). */
  const albumWorkingRef = useRef(null);
  /** Annulation génération étape (morceau / extrait). */
  const stepAbortRef = useRef(null);
  /** Id projet vivant — évite les INSERT dupliqués (fermeture périmée pendant Auto A→Z). */
  const projectIdRef = useRef(null);
  const persistChainRef = useRef(Promise.resolve());

  function assignProjectId(id) {
    if (!id) return id;
    projectIdRef.current = id;
    setProjectId(id);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("project") !== id) {
        url.searchParams.set("project", id);
        window.history.replaceState({}, "", `${url.pathname}${url.search}`);
      }
    } catch {
      /* ignore */
    }
    return id;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureKeysHydrated();
      if (!cancelled) setReady(keysReady(loadKeys()));
    })();
    bootJobRunner();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/artists");
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setCatalogArtists(data.artists || []);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!autoRunning) return;
    autoStartedAt.current = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - autoStartedAt.current);
    }, 250);
    return () => window.clearInterval(id);
  }, [autoRunning]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pid = params.get("project");
    const stepParam = Number(params.get("step"));
    const modeParam = params.get("mode");
    if (!pid && (modeParam === "self" || modeParam === "fiction")) {
      window.location.replace(`/artiste/nouveau?mode=${modeParam}`);
      return;
    }
    if (stepParam >= 1 && stepParam <= STEPS.length && !pid) {
      setShowHomePipeline(false);
      setStep(stepParam);
    }
    if (!pid) return;
    projectIdRef.current = pid;
    setProjectId(pid);
    setShowHomePipeline(false);
    (async () => {
      setLoading(true);
      try {
        const { project: saved } = await api.getProject(pid);
        assignProjectId(saved.id);
        const loaded = normalizeProjectState({ ...emptyProject(), ...(saved.project || {}) });
        if (loaded.artist) {
          const hydrated = withResolvedArtistGender(loaded.artist);
          if (hydrated.gender && hydrated.gender !== loaded.artist.gender) {
            loaded.artist = hydrated;
            void api
              .saveProject({
                id: saved.id,
                project: stripClipsForDb(loaded),
                seed: saved.seed,
                event: {
                  stepKey: "artist",
                  eventType: "backfill",
                  message: "Voix artiste rétablie depuis le profil",
                },
              })
              .catch(() => {});
          }
        }
        setProject(loaded);
        if (saved.seed) {
          setSeed((s) => ({
            ...s,
            ...saved.seed,
            artistSlug: saved.seed.artistSlug || loaded.artist?.slug || s.artistSlug,
            theme: saved.seed.theme || s.theme,
            language: saved.seed.language || loaded.artist?.language || s.language,
          }));
        } else if (loaded.artist?.slug) {
          setSeed((s) => ({
            ...s,
            artistSlug: loaded.artist.slug,
            language: loaded.artist.language || s.language,
          }));
        }
        if (stepParam >= 1 && stepParam <= STEPS.length) setStep(stepParam);
        else if (!saved.project?.lyrics) setStep(2);
        else if (!saved.project?.track && !saved.project?.distrokid?.releaseId) setStep(3);
        setSaveMsg(`Projet ${saved.title}`);
        if (loaded.album) mirrorAlbumJob(loaded.album, saved.id);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Sync album multi-appareils : poll Turso quand un autre client génère
  useEffect(() => {
    const running = project.album?.status === "running";
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
        setProject((prev) => {
          const prevUpdated = prev.album?.updatedAt || "";
          const nextUpdated = remoteAlbum.updatedAt || "";
          if (nextUpdated && nextUpdated <= prevUpdated) {
            const prevDone = (prev.album?.tracks || []).filter((t) => t.status === "done").length;
            const nextDone = (remoteAlbum.tracks || []).filter((t) => t.status === "done").length;
            const prevActive = (prev.album?.tracks || []).filter((t) =>
              t.status === "lyrics" || t.status === "audio",
            ).length;
            const nextActive = (remoteAlbum.tracks || []).filter((t) =>
              t.status === "lyrics" || t.status === "audio",
            ).length;
            const prevLive = prev.album?.live?.percent || 0;
            const nextLive = remoteAlbum.live?.percent || 0;
            if (
              nextDone <= prevDone &&
              nextActive <= prevActive &&
              nextLive <= prevLive &&
              prev.album?.status === remoteAlbum.status &&
              (prev.album?.live?.message || "") === (remoteAlbum.live?.message || "")
            ) {
              return prev;
            }
          }
          return normalizeProjectState({ ...prev, album: remoteAlbum });
        });
      } catch {
        /* réseau ok à ignorer */
      }
    };

    tick();
    const id = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [project.album?.status, projectId]);

  // Morceau unique : suivre le job Tâches (progress + reload à la fin)
  useEffect(() => {
    if (!projectId) return undefined;
    let cancelled = false;
    let prevStatus = null;
    return subscribeJobs((jobs) => {
      const job = jobs.find((j) => j.type === "track" && j.projectId === projectId) || null;
      setTrackJob(job);
      if (job?.status === "running") {
        setStepProgress({
          percent: typeof job.progress === "number" ? job.progress : undefined,
          message: job.message || "Génération audio…",
        });
      }
      const becameTerminal =
        job &&
        prevStatus === "running" &&
        (job.status === "done" || job.status === "error" || job.status === "interrupted");
      prevStatus = job?.status || null;
      if (!becameTerminal || cancelled) return;
      if (job.status === "error") {
        setError(job.message || "Génération audio en erreur");
        setStepProgress(null);
        return;
      }
      if (job.status === "interrupted") {
        setStepProgress(null);
        return;
      }
      void (async () => {
        try {
          const { project: saved } = await api.getProject(projectId);
          if (cancelled) return;
          setProject(
            normalizeProjectState({ ...emptyProject(), ...(saved.project || {}) }),
          );
          setSaveMsg(job.message || "Audio prêt");
        } catch (e) {
          if (!cancelled) setError(e.message);
        } finally {
          if (!cancelled) setStepProgress(null);
        }
      })();
    });
  }, [projectId]);

  const artistSlug = project.artist?.slug;
  const albumCtx = (() => {
    const album = project.album;
    const meta = project.albumMeta;
    if (!album && !meta?.leadProjectId && !meta?.albumTitle) return null;
    const title = album?.title || meta?.albumTitle || "Album";
    const leadId = meta?.leadProjectId || (album ? projectId : null);
    const tracks = Array.isArray(album?.tracks) ? album.tracks : [];
    const currentKey = meta?.trackId || projectId;
    let index = Number(meta?.index) || 0;
    let prevHref = null;
    let nextHref = null;
    if (tracks.length) {
      const i = Math.max(
        0,
        tracks.findIndex(
          (t) =>
            t.projectId === projectId ||
            t.id === currentKey ||
            (t.role === "lead" && leadId && projectId === leadId),
        ),
      );
      index = index || tracks[i]?.index || i + 1;
      const prev = tracks[i - 1];
      const next = tracks[i + 1];
      if (prev) prevHref = albumStudioHref(prev, leadId || projectId);
      if (next) nextHref = albumStudioHref(next, leadId || projectId);
    }
    return {
      title,
      index,
      total: tracks.length || 0,
      prevHref,
      nextHref,
      artistHref: artistSlug ? artistAlbumHref(artistSlug, leadId) : null,
    };
  })();
  const seedLangOptions = languagesForProvider(
    loadKeys().musicProvider,
    loadKeys().songGenPreferredModel,
  );
  const seedEffectiveLanguage = seedLangOptions.some((l) => l.code === seed.language)
    ? seed.language
    : seedLangOptions[0]?.code || "en";
  const selectedCatalog = catalogArtists.find((a) => a.slug === seed.artistSlug) || null;
  const trackBusy = trackJob?.status === "running";
  const trackUiLoading = loading || trackBusy;
  const stepKey = STEPS.find((s) => s.id === step)?.key;
  const stepIdOf = (key) => STEPS.find((s) => s.key === key)?.id;

  const doneMap = {
    stats: Boolean(project.track || project.distrokid),
    lyrics: Boolean(project.lyrics),
    tracks: isTrackAudioFinal(project.track),
    covers: Boolean(project.cover),
    distrokid: Boolean(project.distrokid),
    clip: Boolean(
      (Array.isArray(project.clips) && project.clips.some(isClipReady)) ||
        isClipReady(project.clip),
    ),
    social: Boolean(project.social?.publishedAt || project.social?.publish),
  };
  const completed = Object.values(doneMap).filter(Boolean).length;
  const progress = Math.round((completed / STEPS.length) * 100);
  const projectSongTitle = [project.lyrics?.title, project.track?.title].find(
    (t) => t && !isPlaceholderTitle(t),
  );

  async function persist(nextProject, event, opts = {}) {
    const { skipLocalUpdate = false } = opts;
    const run = async () => {
      const latest = albumWorkingRef.current;
      if (latest?.album?.status === "cancelled" && nextProject?.album?.status === "running") {
        return latest;
      }
      setSaving(true);
      setSaveMsg("");
      try {
        const normalized = normalizeProjectState(nextProject);
        const projectForDb = stripClipsForDb(normalized);
        const prevId = projectIdRef.current;
        const data = await api.saveProject({
          id: prevId,
          project: projectForDb,
          seed,
          event,
        });
        const saved = data.project;
        assignProjectId(saved.id);
        if (prevId && saved.id && prevId !== saved.id) {
          try {
            const clipIds = (normalized.clips || []).map((c) => c.id).filter(Boolean);
            await migrateProjectClipBlobs(prevId, saved.id, clipIds);
          } catch {
            /* IDB optionnel */
          }
        }
        if (!skipLocalUpdate) {
          if (data.artist?.slug) {
            setProject({
              ...normalized,
              artist: nextProject.artist
                ? { ...nextProject.artist, slug: data.artist.slug }
                : nextProject.artist,
            });
            setSaveMsg("Sauvé · fiche artiste");
          } else {
            setProject((prev) =>
              normalizeProjectState({
                ...prev,
                ...normalized,
              }),
            );
            setSaveMsg("Sauvé sur Turso");
          }
        } else {
          setSaveMsg("Sauvé sur Turso");
        }
        return saved;
      } catch (e) {
        setSaveMsg(`DB: ${e.message}`);
        return null;
      } finally {
        setSaving(false);
      }
    };

    const queued = persistChainRef.current.then(run, run);
    persistChainRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  async function runStep(fn, key, goTo) {
    if (!keysReady(loadKeys())) {
      setError("Configure d'abord un LLM (Gemini ou Ollama) dans Paramètres.");
      window.location.href = "/parametres?section=ia";
      return;
    }
    const abortState = { aborted: false };
    stepAbortRef.current = abortState;
    setLoading(true);
    setStepProgress(null);
    setError("");
    const stepLabel = STEP_STATUS_LABEL[key] || key;
    const stepJobId = trackStepJob({
      type: "step",
      label: `Étape ${stepLabel}`,
      projectId,
      stepKey: String(goTo || STEPS.find((s) => s.key === key)?.id || ""),
      message: `${stepLabel} en cours…`,
      progress: 12,
      href: projectId
        ? `/?project=${projectId}${goTo ? `&step=${goTo}` : ""}`
        : goTo
          ? `/?step=${goTo}`
          : "/",
    });
    try {
      patchJob(stepJobId, { progress: 35, message: `Génération ${stepLabel}…` });
      const onProgress = (p) => {
        if (!p || abortState.aborted) return;
        setStepProgress(p);
        patchJob(stepJobId, {
          progress: Math.max(8, Math.min(96, Number(p.percent) || 35)),
          message: p.message || `Génération ${stepLabel}…`,
        });
      };
      let result = await fn(onProgress, abortState);
      if (abortState.aborted) {
        throw Object.assign(new Error("Génération annulée"), { name: "AbortError" });
      }

      // Persiste immédiatement l’audio Replicate sur S3 (sinon expire ~1 h)
      if (key === "track" && result?.audioUrl) {
        patchJob(stepJobId, { progress: 70, message: "Persistance audio S3…" });
        setStepProgress({ percent: 70, message: "Persistance audio S3…" });
        try {
          const saved = await persistAudioRemote(result.audioUrl, projectId || "anon");
          if (saved?.audioUrl) {
            result = {
              ...result,
              audioUrl: saved.audioUrl,
              audioS3Key: saved.s3Key,
              audioEphemeral: false,
              warning: saved.persisted
                ? undefined
                : result.warning,
              note: saved.persisted
                ? `${result.note || "Audio OK"} · sauvé sur S3`
                : result.note,
            };
          }
        } catch (persistErr) {
          result = {
            ...result,
            audioEphemeral: true,
            warning:
              persistErr.message ||
              "Audio non persisté (expire ~1 h) — configure S3 ou réimporte bientôt.",
          };
        }
        // Preview court vs morceau final
        if (result.isPreview || result.status === "preview-ready") {
          result = {
            ...result,
            status: "preview-ready",
            isPreview: true,
          };
        } else {
          result = {
            ...result,
            status: "audio-ready",
            isPreview: false,
          };
        }
      }

      patchJob(stepJobId, { progress: 88, message: "Sauvegarde projet…" });
      const VERSIONED_KEYS = new Set(["lyrics", "track", "cover"]);
      let next;
      try {
        next = VERSIONED_KEYS.has(key)
          ? appendVersion(project, key, result)
          : { ...project, [key]: result };
      } catch (capErr) {
        throw capErr;
      }
      next = normalizeProjectState(next);
      setProject(next);
      if (goTo) setStep(goTo);
      const isPreviewTrack =
        key === "track" && (result?.status === "preview-ready" || result?.isPreview);
      await persist(next, {
        stepKey: key,
        eventType: "step",
        message: isPreviewTrack
          ? "Extrait prêt — écoute le brouillon"
          : `Étape ${stepLabel} générée`,
      });
      finishStepJob(stepJobId, {
        ok: true,
        message: isPreviewTrack ? "Extrait prêt — écoute le brouillon" : `${stepLabel} terminé`,
      });
    } catch (e) {
      const wasAbort = e?.name === "AbortError" || abortState.aborted;
      if (wasAbort) {
        setError("");
        finishStepJob(stepJobId, {
          ok: false,
          message: "Génération annulée",
        });
      } else {
        setError(e.message);
        finishStepJob(stepJobId, {
          ok: false,
          message: e.message || `${stepLabel} en erreur`,
        });
      }
    } finally {
      stepAbortRef.current = null;
      setLoading(false);
      setStepProgress(null);
    }
  }

  function cancelStepGeneration() {
    if (trackJob?.status === "running") {
      cancelMusicTrackJob(projectId);
      return;
    }
    if (stepAbortRef.current) {
      stepAbortRef.current.aborted = true;
    }
  }

  async function startTrackBackground(preview) {
    if (!keysReady(loadKeys())) {
      setError("Configure d'abord un LLM (Gemini ou Ollama) dans Paramètres.");
      window.location.href = "/parametres?section=ia";
      return;
    }
    setError("");
    try {
      const saved = await persist(project, {
        stepKey: "track",
        eventType: "start",
        message: preview ? "Préparation extrait audio" : "Préparation génération audio",
      });
      const pid = saved?.id || projectId;
      if (!pid) {
        setError("Impossible d’enregistrer le projet avant la génération.");
        return;
      }
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.get("project") !== pid) {
          url.searchParams.set("project", pid);
          url.searchParams.set("step", String(STUDIO_STEP.tracks));
          window.history.replaceState({}, "", `${url.pathname}${url.search}`);
        }
      } catch {
        /* ignore */
      }
      startMusicTrackJob({
        projectId: pid,
        preview: Boolean(preview),
        href: studioHref(pid, "tracks"),
      });
    } catch (e) {
      setError(e.message || "Impossible de lancer la génération audio");
    }
  }

  function syncAlbumWorking(next) {
    albumWorkingRef.current = next;
    setProject(next);
    return next;
  }

  function cancelAlbumGeneration() {
    cancelAlbumJob(projectId);
    const base = albumWorkingRef.current || project;
    if (base?.album?.status !== "running") return;
    const next = {
      ...base,
      album: cancelledAlbumState(base.album),
    };
    setProject(next);
    albumWorkingRef.current = next;
    mirrorAlbumJob(next.album, projectId);
    persist(next, {
      stepKey: "album",
      eventType: "album",
      message: "Album arrêté",
    });
  }

  async function removeAlbumTrack(trackId) {
    if (!trackId) return;
    const base = albumWorkingRef.current || project;
    if (!base?.album?.tracks?.length) return;
    const entry = base.album.tracks.find((t) => t.id === trackId);
    if (!entry) return;

    // Retirer le lead (ou la dernière piste) = effacer l’album (le single projet reste)
    const remaining = base.album.tracks.filter((t) => t.id !== trackId);
    if (entry.role === "lead" || remaining.length === 0) {
      const next = {
        ...base,
        album: null,
      };
      syncAlbumWorking(next);
      albumWorkingRef.current = next;
      await persist(
        next,
        {
          stepKey: "album",
          eventType: "album",
          message: "Album effacé",
        },
        { skipLocalUpdate: false },
      );
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
        message: `Album · piste retirée « ${entry.workingTitle || entry.theme || trackId} »`,
      },
      { skipLocalUpdate: false },
    );
  }

  async function clearAlbum() {
    cancelAlbumGeneration();
    const base = albumWorkingRef.current || project;
    if (!base?.album) return;
    const next = { ...base, album: null };
    syncAlbumWorking(next);
    albumWorkingRef.current = next;
    await persist(next, {
      stepKey: "album",
      eventType: "album",
      message: "Album effacé",
    });
  }

  /**
   * Album autonome : le lead (project.track) est gardé ; génère N-1 titres
   * (paroles + audio) et la jaquette album.
   * @param {number} totalCount total souhaité (lead inclus)
   */
  async function runAlbumGeneration(totalCount = 8, { resume = false } = {}) {
    if (!keysReady(loadKeys())) {
      setError("Configure d'abord un LLM (Gemini ou Ollama) dans Paramètres.");
      window.location.href = "/parametres?section=ia";
      return;
    }
    if (!isTrackAudioFinal(project.track)) {
      setError(
        (project.track?.status === "preview-ready" || project.track?.status === "pending-review")
          ? "Génère d’abord le morceau complet (l’extrait ne suffit pas) avant de lancer l’album."
          : "Valide d’abord le single lead (audio prêt) avant de lancer l’album.",
      );
      return;
    }
    if (!project.artist || !project.lyrics) {
      setError("Artiste et paroles du lead requis.");
      return;
    }
    if (project.album?.status === "running") return;

    const total = Math.min(12, Math.max(3, Number(totalCount) || 8));
    setError("");
    const jobId = startAlbumJob({
      projectId,
      totalCount: total,
      resume,
      href: artistSlug ? artistAlbumHref(artistSlug, projectId) : studioHref(projectId, "tracks"),
      label: `Album · ${total} titres`,
    });
    setProject((prev) => ({
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
    }));
  }

  async function runFullAuto() {
    if (!keysReady(loadKeys())) {
      setError("Configure d'abord un LLM (Gemini ou Ollama) pour lancer l'auto.");
      window.location.href = "/parametres?section=ia";
      return;
    }
    if (!seed.artistSlug) {
      setError("Choisis un artiste existant, ou crée-le d’abord dans Artistes.");
      return;
    }
    setAutoRunning(true);
    setLoading(true);
    setError("");
    setLog([{ step: "start", message: "Démarrage du pipeline automatique…" }]);
    setAutoProgress({
      step: "start",
      message: "Démarrage du pipeline automatique…",
      index: -1,
      total: AUTO_PIPELINE_UI.length,
      percent: 2,
    });
    setPublished(false);
    const pipeJobId = trackPipelineJob({
      label: "Pipeline Auto A→Z",
      projectId,
      message: "Démarrage… suivi dans la sidebar (reste sur le Studio)",
      progress: 2,
    });
    let snapshotProject = null;
    try {
      const data = await api.pipeline(seed, async (evt) => {
        if (evt.type === "snapshot" && evt.snapshot) {
          snapshotProject = normalizeProjectState({
            ...emptyProject(),
            ...evt.snapshot,
          });
          setProject(snapshotProject);
          try {
            await persist(snapshotProject, {
              stepKey: evt.step || "pipeline",
              eventType: "pipeline-snapshot",
              message: `Auto A→Z · ${evt.step || "étape"}`,
            });
          } catch {
            /* hub optionnel */
          }
          return;
        }
        const workTotal = AUTO_PIPELINE_UI.length;
        const idx =
          typeof evt.index === "number" && evt.step !== "done"
            ? Math.min(evt.index, workTotal - 1)
            : evt.step === "done"
              ? workTotal
              : -1;
        const percent =
          evt.step === "done"
            ? 100
            : Math.min(96, Math.round(((Math.max(idx, 0) + 0.35) / workTotal) * 100));
        setAutoProgress({
          step: evt.step,
          message: evt.message || "",
          index: idx,
          total: workTotal,
          percent,
        });
        patchJob(pipeJobId, {
          progress: percent,
          message: evt.message || evt.step || "Pipeline…",
        });
        if (evt.step && evt.step !== "start") {
          setLog((prev) => {
            const last = prev[prev.length - 1];
            if (last?.step === evt.step && last?.message === evt.message) return prev;
            return [...prev, { step: evt.step, message: evt.message, at: evt.at }];
          });
        }
        const navMap = {
          trends: stepIdOf("stats"),
          lyrics: stepIdOf("lyrics"),
          track: stepIdOf("tracks"),
          cover: stepIdOf("covers"),
          distrokid: stepIdOf("distrokid"),
        };
        if (navMap[evt.step]) setStep(navMap[evt.step]);
      });
      const next = normalizeProjectState({
        ...emptyProject(),
        trends: data.trends,
        artist: data.artist,
        lyrics: data.lyrics,
        track: data.track,
        cover: data.cover,
        distrokid: data.distrokid,
        social: data.social,
        clip: null,
        clips: [],
        activeClipId: null,
      });
      setProject(next);
      setLog(data.log || []);
      setAutoProgress((p) => ({
        ...p,
        step: "done",
        message: "Prêt à valider ONCE",
        percent: 100,
      }));
      const saved = await persist(next, {
        stepKey: "pipeline",
        eventType: "pipeline",
        message: "Pipeline A→Z prêt — validation ONCE",
        payload: { log: data.log, awaitingOnce: true },
      });
      finishPipelineJob(pipeJobId, {
        ok: true,
        message: "Prêt à valider ONCE",
        projectId: saved?.id || projectIdRef.current,
      });
      if (!data.track?.audioUrl) {
        setStep(stepIdOf("tracks"));
        setError(
          "Pipeline OK jusqu'au morceau, mais sans fichier audio. Ajoute Replicate (ou finalise Suno) à l'étape Morceaux avant ONCE.",
        );
        return;
      }
      setStep(stepIdOf("distrokid"));
      setSaveMsg("Pipeline prêt — vérifie et publie via ONCE.");
    } catch (e) {
      setError(e.message);
      if (snapshotProject?.artist?.name) {
        try {
          await persist(snapshotProject, {
            stepKey: "pipeline",
            eventType: "pipeline-partial",
            message: `Pipeline interrompu : ${e.message}`,
          });
        } catch {
          /* déjà tenté via snapshots */
        }
      }
      finishPipelineJob(pipeJobId, { ok: false, message: e.message });
    } finally {
      setAutoRunning(false);
      setLoading(false);
    }
  }

  async function loadFromHistory(id) {
    setLoading(true);
    setError("");
    try {
      const { project: saved } = await api.getProject(id);
      assignProjectId(saved.id);
      const loaded = normalizeProjectState(saved.project || {});
      setProject(loaded);
      setSeed((s) => ({
        ...s,
        ...(saved.seed || {}),
        artistSlug: saved.seed?.artistSlug || loaded.artist?.slug || s.artistSlug,
        language: saved.seed?.language || loaded.artist?.language || s.language,
      }));
      setHistoryOpen(false);
      setSaveMsg(`Chargé : ${saved.title}`);
      // Place l'utilisateur sur la dernière étape utile
      if (saved.project?.social?.publishedAt || saved.project?.social?.publish) setStep(stepIdOf("social"));
      else if (
        (Array.isArray(loaded.clips) && loaded.clips.some(isClipReady)) ||
        isClipReady(loaded.clip)
      )
        setStep(stepIdOf("social"));
      else if (saved.project?.social) setStep(stepIdOf("clip"));
      else if (saved.project?.distrokid) setStep(stepIdOf("distrokid"));
      else if (saved.project?.cover) setStep(stepIdOf("covers"));
      else if (saved.project?.track) setStep(stepIdOf("tracks"));
      else if (saved.project?.lyrics) setStep(stepIdOf("lyrics"));
      else setStep(stepIdOf("stats"));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell active="studio">
    <div class="mx-auto w-full max-w-6xl">
      <header class="mb-8 space-y-6">
        <div class="flex flex-wrap items-center gap-3 animate-rise">
          <p class="inline-flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-primary">
            <Waves size={14} /> Studio
          </p>
          <a href="/parametres" class="btn btn-ghost btn-xs gap-1">
            <Settings2 size={14} />
            Paramètres
            <span class={`ml-1 h-2 w-2 rounded-full ${ready ? "bg-success" : "bg-warning animate-pulse-soft"}`} />
          </a>
          <button type="button" class="btn btn-ghost btn-xs gap-1" onClick={() => setHistoryOpen(true)}>
            <History size={14} />
            Historique
          </button>
          {artistSlug && (
            <a href={`/artiste/${artistSlug}`} class="btn btn-ghost btn-xs gap-1 text-primary">
              Fiche artiste
            </a>
          )}
          {albumCtx && !showHomePipeline && (
            <div class="flex flex-wrap items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs">
              <Library size={12} class="text-primary" />
              <span class="font-medium text-primary">{albumCtx.title}</span>
              {albumCtx.index ? (
                <span class="text-base-content/55">
                  · piste {albumCtx.index}
                  {albumCtx.total ? `/${albumCtx.total}` : ""}
                </span>
              ) : null}
              {albumCtx.prevHref && (
                <a class="btn btn-ghost btn-xs rounded-full" href={albumCtx.prevHref} title="Titre précédent">
                  <ChevronLeft size={12} />
                </a>
              )}
              {albumCtx.nextHref && (
                <a class="btn btn-ghost btn-xs rounded-full" href={albumCtx.nextHref} title="Titre suivant">
                  <ChevronRight size={12} />
                </a>
              )}
              {albumCtx.artistHref && (
                <a class="btn btn-ghost btn-xs rounded-full" href={albumCtx.artistHref}>
                  Voir l’album
                </a>
              )}
            </div>
          )}
          <button
            type="button"
            class="btn btn-ghost btn-xs gap-1"
            disabled={saving}
            onClick={() =>
              persist(project, {
                eventType: "manual-save",
                message: "Sauvegarde manuelle",
              })
            }
          >
            <Save size={14} />
            {saving ? "…" : "Sauver"}
          </button>
          {saveMsg && <span class="text-xs text-base-content/45">{saveMsg}</span>}
        </div>

        <div class="grid gap-6 md:grid-cols-[auto_minmax(0,1fr)_minmax(200px,0.85fr)] md:items-end md:gap-8">
          <div class="animate-rise">
            <h1 class="sr-only">{project.artist?.name || "SONOZZ"}</h1>
            <img
              src={
                project.artist?.imageUrl && !/^data:image\/svg/i.test(project.artist.imageUrl)
                  ? project.artist.imageUrl
                  : "/logo.png"
              }
              alt={project.artist?.name || "SONOZZ"}
              class="h-28 w-28 rounded-2xl object-cover shadow-lg shadow-black/30 md:h-36 md:w-36"
              width="144"
              height="144"
            />
          </div>

          <div class="animate-rise min-w-0 space-y-3">
            {isTrackAudioFinal(project.track) ? (
              <ClipTrackPlayer
                track={project.track}
                artist={project.artist}
                cover={project.cover}
                compact
              />
            ) : null}
            {showHomePipeline && (
              <p
                class={`max-w-md text-base-content/70 ${
                  isTrackAudioFinal(project.track) ? "text-sm" : "text-base md:text-lg"
                }`}
              >
                Pipeline A→Z : paroles, morceau, jaquette — avec un artiste déjà créé. Le profil
                se gère dans Artistes.
              </p>
            )}
          </div>

          <div class="animate-rise space-y-3">
            <div class="flex items-center justify-between text-sm">
              <span class="text-base-content/60">Pipeline</span>
              <span class="font-display text-primary">{progress}%</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-base-300">
              <div
                class="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            {project.artist && (
              <p class="text-sm text-base-content/55">
                Projet : <span class="text-base-content">{project.artist.name}</span>
                {projectSongTitle ? ` — ${projectSongTitle}` : ""}
              </p>
            )}
          </div>
        </div>
      </header>

      {showHomePipeline && (
        <section class="mb-8 border border-primary/25 bg-primary/5 p-4 md:p-5">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="font-display text-lg font-semibold">Lancer un morceau</h2>
              <p class="text-sm text-base-content/60">
                Choisis un artiste existant, puis Auto A→Z. Le profil se crée sur{" "}
                <a class="link link-hover text-primary" href="/artistes">
                  Artistes
                </a>
                .
              </p>
            </div>
            <button
              type="button"
              class="btn btn-primary gap-2"
              disabled={autoRunning || loading || !seed.artistSlug}
              onClick={runFullAuto}
            >
              {autoRunning ? <span class="loading loading-spinner loading-sm" /> : <Zap size={18} />}
              {autoRunning ? "Pipeline en cours…" : "Auto A → Z"}
            </button>
          </div>
          <div class="grid gap-3 md:grid-cols-2">
            <label class="form-control w-full">
              <span class="label-text mb-1 text-xs text-base-content/55">Artiste</span>
              {catalogArtists.length === 0 ? (
                <a class="btn btn-outline btn-sm mt-1" href="/artiste/nouveau">
                  Créer un artiste d’abord
                </a>
              ) : (
                <select
                  class="select select-bordered w-full bg-base-200"
                  value={seed.artistSlug}
                  disabled={autoRunning}
                  onChange={(e) => {
                    const slug = e.currentTarget.value;
                    const hit = catalogArtists.find((a) => a.slug === slug);
                    setSeed((s) => ({
                      ...s,
                      artistSlug: slug,
                      language: hit?.profile?.language || s.language,
                    }));
                  }}
                >
                  <option value="">Choisir…</option>
                  {catalogArtists.map((a) => (
                    <option key={a.slug} value={a.slug}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
              <p class="mt-1 text-[11px] text-base-content/45">
                {selectedCatalog ? (
                  <>
                    {selectedCatalog.profile?.genre || "Profil prêt"} — le style se règle sur la{" "}
                    <a class="link" href={`/artiste/${encodeURIComponent(selectedCatalog.slug)}`}>
                      fiche artiste
                    </a>
                    .
                  </>
                ) : (
                  <>
                    Pas encore de profil ?{" "}
                    <a class="link" href="/artiste/nouveau">
                      Créer un artiste
                    </a>
                    {" · "}
                    <a class="link" href="/artiste/nouveau?mode=self">
                      Créer mon profil
                    </a>
                  </>
                )}
              </p>
            </label>
            <label class="form-control w-full">
              <span class="label-text mb-1 text-xs text-base-content/55">Thème / titre</span>
              <input
                class="input input-bordered bg-base-200"
                placeholder="Optionnel"
                value={seed.theme}
                disabled={autoRunning}
                onInput={(e) => setSeed((s) => ({ ...s, theme: e.currentTarget.value }))}
              />
            </label>
            <label class="form-control w-full md:col-span-2">
              <span class="label-text mb-1 text-xs text-base-content/55">Langue des chansons</span>
              {String(loadKeys().musicProvider || "") === "songgen" && (
                <p class="mb-1 text-[11px] text-warning">
                  {songGenLanguageHint(loadKeys().songGenPreferredModel || "songgeneration_large")}
                </p>
              )}
              <select
                class="select select-bordered w-full bg-base-200"
                value={seedEffectiveLanguage}
                disabled={autoRunning}
                onChange={(e) =>
                  setSeed((s) => ({
                    ...s,
                    language: e.currentTarget.value,
                  }))
                }
              >
                {seedLangOptions.map((l) => {
                  const engine = languageEngineLabel(
                    l.code,
                    loadKeys().musicProvider,
                    loadKeys().songGenPreferredModel,
                  );
                  return (
                    <option key={l.code} value={l.code}>
                      {engine === "MiniMax" ? `${l.label} · MiniMax` : l.label}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          {(autoRunning || log.length > 0) && (
            <div class="mt-5 space-y-4 border-t border-primary/20 pt-4" aria-live="polite">
              <div class="flex flex-wrap items-end justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <p class="text-xs uppercase tracking-[0.2em] text-base-content/45">Progression</p>
                  <p class="mt-1 truncate font-display text-sm text-base-content">
                    {autoProgress.message ||
                      (log[log.length - 1]?.message ?? "En attente…")}
                  </p>
                </div>
                <div class="text-right tabular-nums">
                  <span class="font-display text-lg text-primary">
                    {autoRunning ? autoProgress.percent : log.some((l) => l.step === "done") ? 100 : autoProgress.percent}%
                  </span>
                  {autoRunning && (
                    <p class="text-xs text-base-content/45">{formatElapsed(elapsedMs)}</p>
                  )}
                </div>
              </div>

              <div class="h-2 overflow-hidden rounded-full bg-base-300">
                <div
                  class={`h-full rounded-full bg-primary transition-all duration-700 ease-out ${
                    autoRunning ? "pipeline-progress-glow" : ""
                  }`}
                  style={{
                    width: `${Math.max(
                      autoRunning ? 4 : 0,
                      autoRunning
                        ? autoProgress.percent
                        : log.some((l) => l.step === "done")
                          ? 100
                          : autoProgress.percent,
                    )}%`,
                  }}
                />
              </div>

              <ol class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {AUTO_PIPELINE_UI.map((s, i) => {
                  const active = autoRunning && autoProgress.step === s.key;
                  const currentIdx =
                    autoProgress.step === "done" ? AUTO_PIPELINE_UI.length : autoProgress.index;
                  const finishedInLog =
                    !autoRunning &&
                    (log.some((l) => l.step === "done") ||
                      log.some((l) => {
                        const li = AUTO_PIPELINE_UI.findIndex((x) => x.key === l.step);
                        return li > i;
                      }));
                  const isDone = !active && (currentIdx > i || finishedInLog);
                  return (
                    <li
                      key={s.key}
                      class={`flex items-center gap-2 border px-2.5 py-2 text-xs transition-colors ${
                        active
                          ? "border-primary/50 bg-primary/10 text-base-content"
                          : isDone
                            ? "border-secondary/30 bg-secondary/5 text-base-content/80"
                            : "border-base-content/10 text-base-content/40"
                      }`}
                    >
                      <span class="flex h-5 w-5 shrink-0 items-center justify-center">
                        {active ? (
                          <LoaderCircle size={14} class="animate-spin text-primary" />
                        ) : isDone ? (
                          <Check size={14} class="text-secondary" />
                        ) : (
                          <span class="text-[10px] tabular-nums opacity-50">{i + 1}</span>
                        )}
                      </span>
                      <span class="font-medium">{s.label}</span>
                    </li>
                  );
                })}
              </ol>

              {log.length > 0 && (
                <ul class="max-h-32 space-y-1 overflow-y-auto border border-base-content/10 bg-base-300/30 px-3 py-2 text-xs text-base-content/55">
                  {log.map((item, i) => (
                    <li key={`${item.step}-${i}`} class="flex gap-2">
                      <span class="shrink-0 text-primary">
                        {STEP_STATUS_LABEL[item.step] || item.step}
                      </span>
                      <span class="min-w-0">{item.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {error && (
        <div class="mb-4 border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>
      )}

      {!showHomePipeline && !project.artist?.name && (
        <div class="mb-4 border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          Ce morceau n’a pas d’artiste.{" "}
          <a class="link" href="/artistes">
            Choisis-en un
          </a>
          {" · "}
          <a class="link" href="/artiste/nouveau">
            Crée un profil
          </a>
          .
        </div>
      )}

      {trackUiLoading && !autoRunning && (
        <div
          class="mb-4 flex items-center gap-3 border border-primary/30 bg-primary/10 px-4 py-3"
          aria-live="polite"
        >
          <LoaderCircle size={18} class="shrink-0 animate-spin text-primary" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-base-content">
              {stepProgress?.message
                ? stepProgress.message
                : `Génération en cours — étape ${STEPS.find((s) => s.id === step)?.label || step}`}
            </p>
            {trackBusy ? (
              <p class="mt-0.5 text-xs text-base-content/55">
                Tu peux changer de page : la génération continue dans Tâches.
              </p>
            ) : null}
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-base-300">
              {typeof stepProgress?.percent === "number" ? (
                <div
                  class="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${Math.max(4, Math.min(100, stepProgress.percent))}%` }}
                />
              ) : (
                <div class="pipeline-indeterminate h-full w-1/3 rounded-full bg-primary" />
              )}
            </div>
            {typeof stepProgress?.percent === "number" && (
              <p class="mt-1 text-xs text-base-content/55">{stepProgress.percent}%</p>
            )}
          </div>
          {stepKey === "tracks" || trackBusy ? (
            <button
              type="button"
              class="btn btn-ghost btn-sm shrink-0 text-error"
              onClick={() => cancelStepGeneration()}
            >
              Annuler
            </button>
          ) : null}
        </div>
      )}

      <nav class="mb-8 flex gap-2 overflow-x-auto pb-2" aria-label="Étapes de création">
        {STEPS.map((s) => {
          const Icon = ICONS[s.key];
          const active = step === s.id;
          const done = doneMap[s.key];
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                if (
                  s.id > stepIdOf("tracks") &&
                  (project.track?.status === "preview-ready" ||
                    project.track?.status === "pending-review")
                ) {
                  setStep(stepIdOf("tracks"));
                  setError("Génère d’abord le morceau complet (l’extrait ne suffit pas) avant de continuer.");
                  return;
                }
                setStep(s.id);
              }}
              class={`group flex min-w-[7.5rem] flex-col gap-1 border px-3 py-3 text-left transition-all duration-300 ${
                active
                  ? "border-primary bg-primary/10"
                  : "border-base-content/10 bg-base-200/40 hover:border-base-content/25"
              }`}
            >
              <span class="flex items-center justify-between gap-2">
                <Icon size={16} class={active ? "text-primary" : done ? "text-secondary" : "text-base-content/45"} />
                <span class={`text-[10px] ${done ? "text-secondary" : "text-base-content/35"}`}>
                  {done ? "ok" : `0${s.id}`}
                </span>
              </span>
              <span class={`font-display text-sm font-semibold ${active ? "text-base-content" : "text-base-content/70"}`}>
                {s.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div class="border border-base-content/10 bg-base-100/70 p-5 backdrop-blur-sm md:p-8">
        {stepKey === "stats" && (
          <StatsStep
            track={project.track}
            artist={project.artist}
            distrokid={project.distrokid}
            cover={project.cover}
            projectId={projectId}
          />
        )}
        {stepKey === "lyrics" && (
          <LyricsStep
            lyrics={project.lyrics}
            versions={project.lyricsVersions || []}
            activeId={project.activeLyricsId}
            artist={project.artist}
            loading={loading}
            onGenerate={(payload) =>
              runStep(
                () =>
                  api.lyrics({
                    ...payload,
                    artist: project.artist,
                    trends: project.trends,
                  }),
                "lyrics",
                stepIdOf("lyrics"),
              )
            }
            onSelectVersion={(id) => {
              const next = selectVersion(project, "lyrics", id);
              setProject(next);
              persist(next, {
                stepKey: "lyrics",
                eventType: "version-select",
                message: "Version de paroles sélectionnée",
              });
            }}
            onDeleteVersion={(id) => {
              const { project: next } = deleteVersion(project, "lyrics", id);
              setProject(next);
              persist(next, {
                stepKey: "lyrics",
                eventType: "version-delete",
                message: "Version de paroles supprimée",
              });
            }}
          />
        )}
        {stepKey === "tracks" && (
          <TracksStep
            track={project.track}
            versions={project.trackVersions || []}
            activeId={project.activeTrackId}
            lyrics={project.lyrics}
            artist={project.artist}
            musicArrange={project.musicArrange}
            loading={trackUiLoading}
            progress={stepKey === "tracks" || trackBusy ? stepProgress : null}
            projectId={projectId}
            distrokid={project.distrokid}
            onOpenSettings={() => {
              window.location.href = "/parametres?section=morceaux";
            }}
            onMusicArrangeChange={(next) => {
              setProject((prev) => ({ ...prev, musicArrange: next }));
            }}
            onSelectVersion={(id) => {
              const next = selectVersion(project, "track", id);
              setProject(next);
              persist(next, {
                stepKey: "track",
                eventType: "version-select",
                message: "Version audio sélectionnée",
              });
            }}
            onDeleteVersion={(id) => {
              const { project: next } = deleteVersion(project, "track", id);
              setProject(next);
              persist(next, {
                stepKey: "track",
                eventType: "version-delete",
                message: "Version audio supprimée",
              });
            }}
            onRenameTrack={(title) => {
              setError("");
              setProject((prev) => {
                const base = normalizeProjectState(prev);
                if (!base.track || !base.activeTrackId) return prev;
                const next = applySongTitle(base, title);
                persist(next, {
                  stepKey: "track",
                  eventType: "track-rename",
                  message: `Titre : ${String(title || "").trim()}`,
                });
                return next;
              });
            }}
            onApplyStyleTrack={async (pick) => {
              if (!pick?.source || !pick?.id) return;
              const data = await api.resolveStyleTrack(pick);
              if (!data?.styleLock) throw new Error("Style lock vide");
              setProject((prev) => {
                if (!prev.artist) return prev;
                const lock = data.styleLock;
                const refName = lock.matchedName || lock.seedTrack?.artistName || "";
                const styleTrack = lock.seedTrack?.title
                  ? `${lock.seedTrack.title}${
                      lock.seedTrack.artistName ? ` — ${lock.seedTrack.artistName}` : ""
                    }`
                  : prev.artist.styleTrack;
                const next = {
                  ...prev,
                  artist: {
                    ...prev.artist,
                    styleLock: lock,
                    styleTrack,
                    ...(refName
                      ? { styleArtist: refName, styleArtists: [refName] }
                      : {}),
                    ...(lock.genreSummary ? { genre: lock.genreSummary } : {}),
                    ...(Array.isArray(lock.genres) && lock.genres.length
                      ? { genres: lock.genres }
                      : {}),
                  },
                  styleTrackPick: pick,
                  musicArrange: musicArrangeFromStyleLock(lock),
                };
                persist(next, {
                  stepKey: "artist",
                  eventType: "style-track",
                  message: `Style calé sur « ${pick.name} »`,
                });
                return next;
              });
            }}
            onDeleteProject={async () => {
              if (!projectId) return;
              setLoading(true);
              setError("");
              try {
                await api.deleteProject(projectId);
                const slug = project.artist?.slug;
                window.location.href = slug
                  ? `/artiste/${encodeURIComponent(slug)}`
                  : "/";
              } catch (e) {
                setError(e.message || "Suppression impossible");
                setLoading(false);
              }
            }}
            onGeneratePreview={() => startTrackBackground(true)}
            onGenerate={() => startTrackBackground(false)}
            onCancelGenerate={() => cancelStepGeneration()}
            onAcceptTrackPreview={() => startTrackBackground(false)}
            onRejectTrackPreview={() => {
              setError("");
              setProject((prev) => {
                const base = normalizeProjectState(prev);
                if (!base.track || !base.activeTrackId) return prev;
                const next = updateVersion(base, "track", base.activeTrackId, {
                  ...base.track,
                  audioUrl: null,
                  audioS3Key: undefined,
                  audioEphemeral: false,
                  waveform: [],
                  status: "prompt-ready",
                  isPreview: false,
                  warning: undefined,
                  note: "Extrait rejeté — relance un extrait ou le complet.",
                  assetMissingReason: undefined,
                });
                persist(next, {
                  stepKey: "track",
                  eventType: "track-reject-preview",
                  message: "Extrait rejeté",
                });
                return next;
              });
            }}
            onAttachAudio={(audioUrl, meta = {}) => {
              setError("");
              setProject((prev) => {
                const base = normalizeProjectState(prev);
                const note =
                  meta.note ||
                  (meta.provider === "once-original"
                    ? `Audio ORIGINAL ONCE (${meta.releaseId || prev.distrokid?.releaseId || "?"}).`
                    : meta.provider === "import-file"
                      ? `Audio importé (${meta.fileName || "fichier"})${meta.persisted ? " · S3" : ""}.`
                      : `Audio attaché via URL${meta.persisted ? " · S3" : ""}.`);
                const resolvedTitle = resolveImportedTitle(meta, base);
                const fields = {
                  audioUrl,
                  audioS3Key: meta.s3Key || base.track?.audioS3Key,
                  provider: meta.provider || "import",
                  status: "audio-ready",
                  duration: base.track?.duration || "~",
                  audioEphemeral: !meta.persisted && !meta.s3Key,
                  note,
                  warning: meta.warning,
                  assetMissingReason: undefined,
                  isPreview: false,
                };
                const sameAudio = base.track?.audioUrl === audioUrl;
                const isFreshImport =
                  !sameAudio &&
                  ["import-url", "import-file", "once-original"].includes(meta.provider);
                let next;
                if (!base.track) {
                  next = appendVersion(base, "track", {
                    title: resolvedTitle,
                    artist: base.artist?.name,
                    ...fields,
                  });
                } else if (isFreshImport && base.track.audioUrl) {
                  const rest = { ...base.track };
                  delete rest.id;
                  delete rest.createdAt;
                  next = appendVersion(base, "track", { ...rest, ...fields, title: resolvedTitle });
                } else {
                  next = updateVersion(base, "track", base.activeTrackId, {
                    ...base.track,
                    ...fields,
                    title: resolvedTitle,
                    audioS3Key: meta.s3Key || base.track.audioS3Key,
                  });
                }
                next = applySongTitle(next, resolvedTitle);
                if (meta.releaseId) {
                  next = {
                    ...next,
                    distrokid: {
                      ...(next.distrokid || {}),
                      releaseId: meta.releaseId,
                      dashboardUrl: `https://beta.once.app/releases/${meta.releaseId}`,
                    },
                  };
                }
                persist(next, {
                  stepKey: "track",
                  eventType:
                    meta.provider === "once-original" ? "audio-restore-once" : "audio-import",
                  message:
                    meta.provider === "once-original"
                      ? "Audio original ONCE restauré"
                      : isFreshImport && base.track?.audioUrl
                        ? "Nouvelle version audio importée"
                        : "Audio importé",
                });
                return next;
              });
            }}
          />
        )}
        {stepKey === "covers" && (
          <CoverStep
            cover={project.cover}
            versions={project.coverVersions || []}
            activeId={project.activeCoverId}
            artist={project.artist}
            track={project.track}
            loading={loading}
            onSelectVersion={(id) => {
              const next = selectVersion(project, "cover", id);
              setProject(next);
              persist(next, {
                stepKey: "cover",
                eventType: "version-select",
                message: "Version de jaquette sélectionnée",
              });
            }}
            onDeleteVersion={(id) => {
              const { project: next } = deleteVersion(project, "cover", id);
              setProject(next);
              persist(next, {
                stepKey: "cover",
                eventType: "version-delete",
                message: "Version de jaquette supprimée",
              });
            }}
            onGenerate={(payload) => {
              if (!isTrackAudioFinal(project.track)) {
                setStep(stepIdOf("tracks"));
                setError(
                  (project.track?.status === "preview-ready" || project.track?.status === "pending-review")
                    ? "Génère d’abord le morceau complet (étape Morceaux) — l’extrait ne suffit pas pour la jaquette."
                    : "Crée d'abord le morceau audio (étape Morceaux) avant la jaquette.",
                );
                return;
              }
              return runStep(
                () => api.cover({ ...payload, artist: project.artist, track: project.track }),
                "cover",
                stepIdOf("covers"),
              );
            }}
          />
        )}
        {stepKey === "distrokid" && (
          <DistroKidStep
            distrokid={project.distrokid}
            track={project.track}
            cover={project.cover}
            artist={project.artist}
            loading={loading}
            configured={Boolean(loadKeys().onceApiToken)}
            onConfigure={() => {
              window.location.href = "/parametres?section=distribution";
            }}
            onGoToCover={() => setStep(stepIdOf("covers"))}
            onPrepare={() => {
              if (!isTrackAudioFinal(project.track)) {
                setStep(stepIdOf("tracks"));
                setError(
                  (project.track?.status === "preview-ready" || project.track?.status === "pending-review")
                    ? "Génère d’abord le morceau complet (étape Morceaux) — l’extrait ne suffit pas pour ONCE."
                    : "Crée d'abord le morceau audio (étape Morceaux) avant ONCE.",
                );
                return;
              }
              return runStep(
                () =>
                  api.distrokid({
                    artist: project.artist,
                    track: project.track,
                    cover:
                      project.cover?.imageUrl
                        ? project.cover
                        : project.artist?.imageUrl
                          ? {
                              ...(project.cover || {}),
                              imageUrl: project.artist.imageUrl,
                              prompt:
                                project.cover?.prompt ||
                                `Album cover style portrait for ${project.artist?.name || "artist"}`,
                            }
                          : project.cover,
                    lyrics: project.lyrics,
                    submit: true,
                    reuseRelease: false,
                  }),
                "distrokid",
                stepIdOf("distrokid"),
              );
            }}
            onReuse={() => {
              if (!isTrackAudioFinal(project.track)) {
                setStep(stepIdOf("tracks"));
                setError(
                  (project.track?.status === "preview-ready" || project.track?.status === "pending-review")
                    ? "Génère d’abord le morceau complet (étape Morceaux) — l’extrait ne suffit pas pour ONCE."
                    : "Crée d'abord le morceau audio (étape Morceaux) avant ONCE.",
                );
                return;
              }
              return runStep(
                () =>
                  api.distrokid({
                    artist: project.artist,
                    track: project.track,
                    cover:
                      project.cover?.imageUrl
                        ? project.cover
                        : project.artist?.imageUrl
                          ? {
                              ...(project.cover || {}),
                              imageUrl: project.artist.imageUrl,
                              prompt:
                                project.cover?.prompt ||
                                `Album cover style portrait for ${project.artist?.name || "artist"}`,
                            }
                          : project.cover,
                    lyrics: project.lyrics,
                    submit: true,
                    reuseRelease: true,
                    releaseId: project.distrokid?.releaseId,
                  }),
                "distrokid",
                stepIdOf("distrokid"),
              );
            }}
          />
        )}
        {stepKey === "clip" && (
          <ClipStep
            projectId={projectId}
            social={project.social}
            clip={project.clip}
            clips={project.clips || []}
            activeClipId={project.activeClipId}
            artist={project.artist}
            track={project.track}
            cover={project.cover || (project.artist?.imageUrl ? { imageUrl: project.artist.imageUrl } : null)}
            lyrics={project.lyrics}
            loading={loading}
            onGoToTracks={() => setStep(stepIdOf("tracks"))}
            onGoToArtist={() => {
              const slug = project.artist?.slug;
              window.location.href = slug
                ? `/artiste/${encodeURIComponent(slug)}/editer`
                : "/artistes";
            }}
            onGoToCover={() => setStep(stepIdOf("covers"))}
            onGoToSocial={() => setStep(stepIdOf("social"))}
            onSelectClip={(clipId) => {
              // Différé : évite les violations « click handler took Xs »
              requestAnimationFrame(() => {
                setProject((prev) => setActiveProjectClip(prev, clipId));
              });
            }}
            onRemoveClip={(clipId) => {
              requestAnimationFrame(() => {
                setProject((prev) => {
                  const next = removeProjectClip(prev, clipId);
                  persist(next, {
                    stepKey: "clip",
                    eventType: "clip",
                    message: "Clip supprimé",
                  });
                  return next;
                });
              });
            }}
            onGeneratePack={() => {
              if (!isTrackAudioFinal(project.track)) {
                setStep(stepIdOf("tracks"));
                setError(
                  (project.track?.status === "preview-ready" || project.track?.status === "pending-review")
                    ? "Génère d’abord le morceau complet (étape Morceaux) — l’extrait ne suffit pas pour le clip."
                    : "Crée d'abord le morceau audio (étape Morceaux) avant le clip.",
                );
                return;
              }
              return runStep(
                () =>
                  api.social({
                    artist: project.artist,
                    track: project.track,
                    lyrics: project.lyrics,
                    cover: project.cover,
                  }),
                "social",
                stepIdOf("clip"),
              );
            }}
            onClipReady={(nextClip, _blob, storageKey) => {
              setProject((prev) => {
                const next = upsertProjectClip(prev, nextClip, { activate: true });
                const light = next.clip;
                const brief = light?.audioBrief || next.social?.audioBrief || null;
                const withSocial = {
                  ...next,
                  social: next.social
                    ? {
                        ...next.social,
                        ...(brief ? { audioBrief: brief } : {}),
                        veo: {
                          provider: light?.provider,
                          prompt: light?.prompt,
                          mode: light?.mode,
                          at: light?.at,
                          storageKey: storageKey || null,
                          clipId: light?.id || null,
                          kind: light?.kind || null,
                          ...(brief ? { audioBrief: brief } : {}),
                        },
                      }
                    : next.social,
                };
                persist(withSocial, {
                  stepKey: "clip",
                  eventType: "clip",
                  message:
                    light?.provider === "user-upload"
                      ? light?.kind === "full"
                        ? "Full importé"
                        : "Short importé"
                      : light?.provider === "canvas-fallback"
                        ? "Maquette clip générée"
                        : "Short Veo généré",
                });
                return withSocial;
              });
            }}
          />
        )}
        {stepKey === "social" && (
          <SocialStep
            projectId={projectId}
            social={project.social}
            clip={project.clip}
            clips={project.clips || []}
            activeClipId={project.activeClipId}
            artist={project.artist}
            track={project.track}
            cover={project.cover || (project.artist?.imageUrl ? { imageUrl: project.artist.imageUrl } : null)}
            loading={loading}
            published={published}
            onGoToClip={() => setStep(stepIdOf("clip"))}
            onConfigure={() => {
              window.location.href = "/parametres?section=reseaux";
            }}
            onSelectClip={(clipId) => {
              requestAnimationFrame(() => {
                setProject((prev) => setActiveProjectClip(prev, clipId));
              });
            }}
            onRemoveClip={(clipId) => {
              requestAnimationFrame(() => {
                setProject((prev) => {
                  const next = removeProjectClip(prev, clipId);
                  persist(next, {
                    stepKey: "clip",
                    eventType: "clip",
                    message: "Clip supprimé",
                  });
                  return next;
                });
              });
            }}
            onGenerate={() => {
              if (!isTrackAudioFinal(project.track)) {
                setStep(stepIdOf("tracks"));
                setError(
                  (project.track?.status === "preview-ready" || project.track?.status === "pending-review")
                    ? "Génère d’abord le morceau complet (étape Morceaux) — l’extrait ne suffit pas."
                    : "Crée d'abord le morceau audio (étape Morceaux).",
                );
                return;
              }
              return runStep(
                () =>
                  api.social({
                    artist: project.artist,
                    track: project.track,
                    lyrics: project.lyrics,
                    cover: project.cover,
                  }),
                "social",
                stepIdOf("social"),
              );
            }}
            onPublish={() => setPublished(true)}
            onSocialUpdate={(nextSocial) => {
              setProject((prev) => {
                const next = { ...prev, social: nextSocial };
                persist(next, {
                  stepKey: "social",
                  eventType: "publish",
                  message: "Short diffusé",
                });
                return next;
              });
            }}
          />
        )}

        <footer class="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-base-content/10 pt-5">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            disabled={step <= 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            Précédent
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm gap-1"
            disabled={step >= STEPS.length}
            onClick={() => {
              if (stepKey === "tracks" && (project.track?.status === "preview-ready" || project.track?.status === "pending-review")) {
                setError("Génère d’abord le morceau complet (l’extrait ne suffit pas) avant de continuer.");
                return;
              }
              setStep((s) => Math.min(STEPS.length, s + 1));
            }}
          >
            Étape suivante <ChevronRight size={16} />
          </button>
        </footer>
      </div>

      <HistoryPanel
        open={historyOpen}
        currentId={projectId}
        onClose={() => setHistoryOpen(false)}
        onLoad={loadFromHistory}
      />
    </div>
    </AppShell>
  );
}
