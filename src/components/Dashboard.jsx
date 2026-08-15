import { useEffect, useRef, useState } from "preact/hooks";
import {
  BarChart3,
  UserRound,
  PenLine,
  AudioLines,
  ImagePlus,
  Music2,
  Film,
  Share2,
  ChevronRight,
  Waves,
  Settings2,
  Zap,
  History,
  Save,
  Check,
  LoaderCircle,
} from "lucide-preact";
import StatsStep from "./steps/StatsStep.jsx";
import ArtistStep from "./steps/ArtistStep.jsx";
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
  MUSIC_STYLES,
  languagesForProvider,
  songGenLanguageHint,
  languageEngineLabel,
  formatGenres,
  createAlbumId,
  createAlbumTrackId,
  isTrackAudioFinal,
  isPlaceholderTitle,
  titleFromAudioFileName,
} from "../lib/studio.js";
import { api } from "../lib/apiClient.js";
import { keysReady, loadKeys, ensureKeysHydrated } from "../lib/keys.js";
import { persistAudioRemote } from "../lib/audioResolve.js";
import { migrateProjectClipBlobs } from "../lib/clipStore.js";
import { musicArrangeFromStyleLock } from "../lib/musicArrange.js";
import { withResolvedArtistGender } from "../lib/artistGender.js";
import StyleArtistPicker from "./StyleArtistPicker.jsx";
import StyleTrackPicker from "./StyleTrackPicker.jsx";
import ArtistNameField, { isArtistNameBlocked } from "./ArtistNameField.jsx";
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
import { patchJob } from "../lib/jobStore.js";
import { mirrorAlbumJob } from "../lib/albumJobMirror.js";
import {
  bootJobRunner,
  finishPipelineJob,
  finishStepJob,
  trackPipelineJob,
  trackStepJob,
} from "../lib/jobRunner.js";

const ICONS = {
  1: BarChart3,
  2: UserRound,
  3: PenLine,
  4: AudioLines,
  5: ImagePlus,
  6: Music2,
  7: Film,
  8: Share2,
};

const STEP_STATUS_LABEL = {
  trends: "Tendances",
  stats: "Stats",
  artist: "Artiste",
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
  { key: "artist", label: "Artiste" },
  { key: "lyrics", label: "Paroles" },
  { key: "track", label: "Morceau" },
  { key: "cover", label: "Jaquette" },
  { key: "distrokid", label: "ONCE" },
  { key: "social", label: "Réseaux" },
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
    name: "",
    bioHint: "",
    theme: "",
    market: "FR",
    genre: "",
    genres: [],
    language: "fr",
    styleArtist: "",
    styleArtistPick: null,
    styleTrackPick: null,
    allowTakenName: false,
  });
  const [seedNameStatus, setSeedNameStatus] = useState(null);
  const [published, setPublished] = useState(false);
  const [projectId, setProjectId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  /** Accueil studio `/` uniquement — masqué quand un projet est ouvert via ?project= */
  const [showHomePipeline, setShowHomePipeline] = useState(true);
  const [artistMode, setArtistMode] = useState(null);
  /** Génération album lancée dans cet onglet (évite d’écraser l’état live par le poll). */
  const albumLocalRunRef = useRef(false);
  const albumAbortRef = useRef(null);
  const albumWorkingRef = useRef(null);
  /** Annulation génération étape (morceau / extrait). */
  const stepAbortRef = useRef(null);

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
    if (modeParam === "self" || modeParam === "fiction") {
      setArtistMode(modeParam);
    }
    if (stepParam >= 1 && stepParam <= STEPS.length && !pid) {
      setShowHomePipeline(false);
      setStep(stepParam);
    }
    if (!pid) return;
    setShowHomePipeline(false);
    (async () => {
      setLoading(true);
      try {
        const { project: saved } = await api.getProject(pid);
        setProjectId(saved.id);
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
        if (saved.seed) setSeed((s) => ({ ...s, ...saved.seed }));
        if (stepParam >= 1 && stepParam <= STEPS.length) setStep(stepParam);
        else if (!saved.project?.lyrics) setStep(3);
        else if (!saved.project?.track && !saved.project?.distrokid?.releaseId) setStep(4);
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

  const artistSlug = project.artist?.slug;

  const doneMap = {
    1: Boolean(project.track || project.distrokid),
    2: Boolean(project.artist),
    3: Boolean(project.lyrics),
    4: isTrackAudioFinal(project.track),
    5: Boolean(project.cover),
    6: Boolean(project.distrokid),
    7: Boolean(
      (Array.isArray(project.clips) && project.clips.some(isClipReady)) ||
        isClipReady(project.clip),
    ),
    8: Boolean(project.social?.publishedAt || project.social?.publish),
  };
  const completed = Object.values(doneMap).filter(Boolean).length;
  const progress = Math.round((completed / STEPS.length) * 100);
  const projectSongTitle = [project.lyrics?.title, project.track?.title].find(
    (t) => t && !isPlaceholderTitle(t),
  );

  async function persist(nextProject, event, opts = {}) {
    const { skipLocalUpdate = false } = opts;
    setSaving(true);
    setSaveMsg("");
    try {
      const normalized = normalizeProjectState(nextProject);
      const projectForDb = stripClipsForDb(normalized);
      const data = await api.saveProject({
        id: projectId,
        project: projectForDb,
        seed,
        event,
      });
      const saved = data.project;
      const prevId = projectId;
      setProjectId(saved.id);
      if (prevId !== saved.id) {
        try {
          const clipIds = (normalized.clips || []).map((c) => c.id).filter(Boolean);
          await migrateProjectClipBlobs(prevId || null, saved.id, clipIds);
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
          setSaveMsg(`Sauvé · /artiste/${data.artist.slug}`);
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
    if (stepAbortRef.current) {
      stepAbortRef.current.aborted = true;
    }
  }

  function syncAlbumWorking(next) {
    albumWorkingRef.current = next;
    setProject(next);
    return next;
  }

  function cancelAlbumGeneration() {
    if (albumAbortRef.current) {
      albumAbortRef.current.aborted = true;
      return;
    }
    // Run distant / zombie (onglet fermé) : stoppe le statut en base
    if (project.album?.status !== "running") return;
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
        { skipLocalUpdate: albumLocalRunRef.current },
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
      { skipLocalUpdate: albumLocalRunRef.current },
    );
  }

  async function clearAlbum() {
    if (albumLocalRunRef.current) {
      cancelAlbumGeneration();
    }
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
   * Album autonome : le lead (project.track) est gardé ; génère N-1 titres (paroles + audio).
   * @param {number} totalCount total souhaité (lead inclus)
   */
  async function runAlbumGeneration(totalCount = 8) {
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
    if (albumLocalRunRef.current) return;

    const total = Math.min(12, Math.max(3, Number(totalCount) || 8));
    const extra = total - 1;
    const abortState = { aborted: false };
    albumAbortRef.current = abortState;
    albumLocalRunRef.current = true;
    setLoading(true);
    setStepProgress({ percent: 2, message: "Planification de la tracklist…" });
    setError("");

    const jobId = trackStepJob({
      type: "step",
      label: `Album · ${total} titres`,
      projectId,
      stepKey: "4",
      message: "Planification tracklist…",
      progress: 4,
      href: projectId ? `/?project=${projectId}&step=4` : "/?step=4",
    });

    let lastLivePersistAt = 0;

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
      // Ne pas mirror ici : ce client possède déjà le job local (trackStepJob)
      patchJob(jobId, { progress: percent, message });
      const now = Date.now();
      if (persistNow || now - lastLivePersistAt > 20_000) {
        lastLivePersistAt = now;
        return persist(working, null, { skipLocalUpdate: true });
      }
      return Promise.resolve(null);
    };

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
    // Job local via trackStepJob — les autres appareils liront album.live via Turso

    const persistAlbum = (event) =>
      persist(working, event, { skipLocalUpdate: true });

    try {
      // Persiste tout de suite pour que mobile voie la tâche
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
            label: plan.albumTitle
              ? `Album · ${plan.albumTitle}`
              : `Album · ${total} titres`,
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
        // Resync si l’utilisateur a retiré des pistes pendant le run
        working = albumWorkingRef.current || working;

        // Honore annulation / suppressions faites depuis un autre appareil
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
        setStepProgress({
          percent: basePct,
          message: `Titre ${slot.index}/${total} — paroles « ${slot.workingTitle} »…`,
        });

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

        mark({ lyrics: lyricsI, workingTitle: lyricsI?.title || slot.workingTitle, status: "audio" });
        await setAlbumLive(
          basePct + 4,
          `Titre ${slot.index}/${total} — composition audio…`,
          { persistNow: true },
        );
        setStepProgress({
          percent: basePct + 4,
          message: `Titre ${slot.index}/${total} — composition audio…`,
        });

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
              const msg = `Titre ${slot.index}/${total} — ${p?.message || "composition…"}`;
              setStepProgress({ percent: local, message: msg });
              void setAlbumLive(local, `${slot.index}/${total} · ${p?.message || "audio…"}`);
            },
            { signal: abortState },
          );
        } catch (e) {
          if (abortState.aborted || e?.name === "AbortError") break;
          mark({ status: "error", error: e.message || "Audio échoué" });
          await setAlbumLive(basePct + 4, `Erreur audio titre ${slot.index}`, { persistNow: true });
          continue;
        }
        if (abortState.aborted) break;
        if (!working.album.tracks.some((t) => t.id === slot.id)) continue;

        let s3Warning;
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
            } else if (saved && saved.persisted === false) {
              s3Warning = "Audio non persisté sur S3 — lien temporaire";
              trackI = { ...trackI, audioEphemeral: true, warning: s3Warning };
            }
          } catch (persistErr) {
            s3Warning = persistErr.message || "Persistance S3 échouée";
            trackI = {
              ...trackI,
              audioEphemeral: true,
              warning: s3Warning,
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
      // Remet en attente les pistes interrompues mid-flight
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
      setStepProgress({
        percent: 100,
        message: wasCancelled
          ? `Album annulé · ${doneCount}/${tracks.length}`
          : `Album prêt · ${doneCount}/${tracks.length}`,
      });
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
      setTimeout(() => setStepProgress(null), 2500);
    }
  }

  async function runFullAuto() {
    if (!keysReady(loadKeys())) {
      setError("Configure d'abord un LLM (Gemini ou Ollama) pour lancer l'auto.");
      window.location.href = "/parametres?section=ia";
      return;
    }
    if (seed.styleArtist?.trim() && !seed.styleArtistPick?.id && !seed.styleTrackPick?.id) {
      setError(
        "Choisis et valide un artiste ou un titre dans les résultats avant de lancer l'auto.",
      );
      return;
    }
    if (isArtistNameBlocked(seed.name, seedNameStatus, seed.allowTakenName)) {
      setError(
        "Ce nom de scène est déjà pris sur les plateformes de streaming — choisis-en un autre ou force quand même.",
      );
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
    try {
      const data = await api.pipeline(seed, (evt) => {
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
        // Suit l’étape active dans la nav
        const navMap = {
          trends: 1,
          artist: 2,
          lyrics: 3,
          track: 4,
          cover: 5,
          distrokid: 6,
          social: 8,
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
      setAutoProgress((p) => ({ ...p, step: "done", message: "Pipeline terminé", percent: 100 }));
      await persist(next, {
        stepKey: "pipeline",
        eventType: "pipeline",
        message: "Pipeline A→Z terminé",
        payload: { log: data.log },
      });
      finishPipelineJob(pipeJobId, {
        ok: true,
        message: "Pipeline terminé",
        projectId,
      });
      if (data.track?.audioUrl) {
        setStep(7);
      } else {
        setStep(4);
        setError(
          "Pipeline OK jusqu'au morceau, mais sans fichier audio. Ajoute Replicate (ou finalise Suno) à l'étape 4 avant le clip.",
        );
      }
    } catch (e) {
      setError(e.message);
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
      setProjectId(saved.id);
      setProject(
        normalizeProjectState({ ...emptyProject(), ...(saved.project || {}) }),
      );
      if (saved.seed) setSeed((s) => ({ ...s, ...saved.seed }));
      setHistoryOpen(false);
      setSaveMsg(`Chargé : ${saved.title}`);
      // Place l'utilisateur sur la dernière étape utile
      const loaded = normalizeProjectState(saved.project || {});
      if (saved.project?.social?.publishedAt || saved.project?.social?.publish) setStep(8);
      else if (
        (Array.isArray(loaded.clips) && loaded.clips.some(isClipReady)) ||
        isClipReady(loaded.clip)
      )
        setStep(8);
      else if (saved.project?.social) setStep(7);
      else if (saved.project?.distrokid) setStep(6);
      else if (saved.project?.cover) setStep(5);
      else if (saved.project?.track) setStep(4);
      else if (saved.project?.lyrics) setStep(3);
      else if (saved.project?.artist) setStep(2);
      else setStep(1);
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
            <Waves size={14} /> Studio automatisé
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
              /{artistSlug}
            </a>
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
                Pipeline A→Z : Deezer + Gemini + ONCE → Spotify + clip + réseaux.
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
              <h2 class="font-display text-lg font-semibold">Lancer tout automatiquement</h2>
              <p class="text-sm text-base-content/60">Seeds optionnels — laisse vide pour génération totale.</p>
            </div>
            <button
              type="button"
              class="btn btn-primary gap-2"
              disabled={
                autoRunning ||
                loading ||
                isArtistNameBlocked(seed.name, seedNameStatus, seed.allowTakenName)
              }
              onClick={runFullAuto}
            >
              {autoRunning ? <span class="loading loading-spinner loading-sm" /> : <Zap size={18} />}
              {autoRunning ? "Pipeline en cours…" : "Auto A → Z"}
            </button>
          </div>
          <div class="grid gap-3 md:grid-cols-2">
            <ArtistNameField
              value={seed.name}
              disabled={autoRunning}
              placeholder="Laisser vide pour inventer un nom"
              allowTakenName={Boolean(seed.allowTakenName)}
              onChange={(name) => setSeed((s) => ({ ...s, name }))}
              onAllowTakenNameChange={(allowTakenName) =>
                setSeed((s) => ({ ...s, allowTakenName }))
              }
              onAvailabilityChange={setSeedNameStatus}
            />
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
            <div class="form-control w-full md:col-span-2">
              <span class="label-text mb-1 text-xs text-base-content/55">
                Styles musicaux (optionnel)
              </span>
              <p class="mb-2 text-[11px] text-base-content/45">
                {seed.styleTrackPick?.id || seed.styleArtistPick?.id
                  ? "Inutile si tu as déjà un artiste / titre de référence — ne coche que pour forcer un genre."
                  : "Ou choisis plutôt un artiste / titre ci-dessous pour caler le style automatiquement."}
              </p>
              <div class="flex flex-wrap gap-2">
                {MUSIC_STYLES.map((s) => {
                  const selected = s.value
                    ? (seed.genres || []).includes(s.value)
                    : !(seed.genres || []).length;
                  return (
                    <button
                      key={s.label}
                      type="button"
                      class={`btn btn-xs ${selected ? "btn-primary" : "btn-ghost border border-base-content/15"}`}
                      disabled={autoRunning}
                      onClick={() => {
                        if (!s.value) {
                          setSeed((prev) => ({ ...prev, genres: [], genre: "" }));
                          return;
                        }
                        setSeed((prev) => {
                          const cur = prev.genres || [];
                          const next = cur.includes(s.value)
                            ? cur.filter((g) => g !== s.value)
                            : [...cur, s.value];
                          return { ...prev, genres: next, genre: formatGenres(next) };
                        });
                      }}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
              {(seed.genres || []).length > 0 && (
                <p class="mt-1 text-[11px] text-primary">Forçage : {formatGenres(seed.genres)}</p>
              )}
            </div>
            <div class="md:col-span-2 space-y-3">
              <StyleArtistPicker
                value={seed.styleArtist}
                pick={seed.styleArtistPick}
                disabled={autoRunning}
                compact
                onQueryChange={(q) =>
                  setSeed((s) => ({ ...s, styleArtist: q, styleArtistPick: null }))
                }
                onPickChange={(pick) =>
                  setSeed((s) => ({
                    ...s,
                    styleArtist: pick?.name || s.styleArtist,
                    styleArtistPick: pick,
                  }))
                }
              />
              <StyleTrackPicker
                pick={seed.styleTrackPick}
                disabled={autoRunning}
                compact
                onPickChange={(pick) =>
                  setSeed((s) => ({ ...s, styleTrackPick: pick }))
                }
              />
            </div>
            <label class="form-control w-full">
              <span class="label-text mb-1 text-xs text-base-content/55">Langue des chansons</span>
              {String(loadKeys().musicProvider || "") === "songgen" && (
                <p class="mb-1 text-[11px] text-warning">
                  {songGenLanguageHint(loadKeys().songGenPreferredModel || "songgeneration_large")}
                </p>
              )}
              <select
                class="select select-bordered w-full bg-base-200"
                value={
                  languagesForProvider(
                    loadKeys().musicProvider,
                    loadKeys().songGenPreferredModel,
                  ).some((l) => l.code === seed.language)
                    ? seed.language
                    : languagesForProvider(
                        loadKeys().musicProvider,
                        loadKeys().songGenPreferredModel,
                      )[0]?.code || "en"
                }
                disabled={autoRunning}
                onChange={(e) => setSeed((s) => ({ ...s, language: e.currentTarget.value }))}
              >
                {languagesForProvider(
                  loadKeys().musicProvider,
                  loadKeys().songGenPreferredModel,
                ).map((l) => {
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
            <input
              class="input input-bordered bg-base-200 md:col-span-2"
              placeholder="Personnalité / univers (optionnel) — pas le style musical"
              value={seed.bioHint}
              disabled={autoRunning}
              onInput={(e) => setSeed((s) => ({ ...s, bioHint: e.currentTarget.value }))}
            />
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

      {loading && !autoRunning && (
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
          {step === 4 ? (
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
          const Icon = ICONS[s.id];
          const active = step === s.id;
          const done = doneMap[s.id];
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                if (s.id > 4 && (project.track?.status === "preview-ready" || project.track?.status === "pending-review")) {
                  setStep(4);
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
        {step === 1 && (
          <StatsStep
            track={project.track}
            artist={project.artist}
            distrokid={project.distrokid}
            cover={project.cover}
            projectId={projectId}
          />
        )}
        {step === 2 && (
          <ArtistStep
            artist={project.artist}
            trends={project.trends}
            loading={loading}
            initialMode={artistMode || undefined}
            onGenerate={(payload) =>
              runStep(() => api.artist({ ...payload, trends: project.trends }), "artist", 2)
            }
            onPatchArtist={(patch) => {
              setProject((prev) =>
                prev.artist
                  ? { ...prev, artist: { ...prev.artist, ...patch } }
                  : prev,
              );
            }}
          />
        )}
        {step === 3 && (
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
                3,
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
        {step === 4 && (
          <TracksStep
            track={project.track}
            versions={project.trackVersions || []}
            activeId={project.activeTrackId}
            lyrics={project.lyrics}
            artist={project.artist}
            musicArrange={project.musicArrange}
            loading={loading}
            progress={step === 4 ? stepProgress : null}
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
                const mergedLock = {
                  ...(prev.artist.styleLock || {}),
                  ...data.styleLock,
                };
                const next = {
                  ...prev,
                  artist: {
                    ...prev.artist,
                    styleLock: mergedLock,
                    styleTrack: data.styleLock.seedTrack?.title
                      ? `${data.styleLock.seedTrack.title}${
                          data.styleLock.seedTrack.artistName
                            ? ` — ${data.styleLock.seedTrack.artistName}`
                            : ""
                        }`
                      : prev.artist.styleTrack,
                  },
                  styleTrackPick: pick,
                  // Pré-sélection arrangement comme pour les styles (titre prime)
                  musicArrange: musicArrangeFromStyleLock(mergedLock),
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
            onGeneratePreview={() =>
              runStep(
                (onProgress, signal) =>
                  api.track(
                    {
                      preview: true,
                      lyrics: project.lyrics,
                      artist: {
                        ...project.artist,
                        musicArrange: project.musicArrange,
                      },
                    },
                    onProgress,
                    { signal },
                  ),
                "track",
                4,
              )
            }
            onGenerate={() =>
              runStep(
                (onProgress, signal) =>
                  api.track(
                    {
                      preview: false,
                      lyrics: project.lyrics,
                      artist: {
                        ...project.artist,
                        musicArrange: project.musicArrange,
                      },
                    },
                    onProgress,
                    { signal },
                  ),
                "track",
                4,
              )
            }
            onCancelGenerate={() => cancelStepGeneration()}
            onAcceptTrackPreview={() => {
              // Valider le style de l’extrait → lancer la gen complète (nouvelle génération)
              runStep(
                (onProgress, signal) =>
                  api.track(
                    {
                      preview: false,
                      lyrics: project.lyrics,
                      artist: {
                        ...project.artist,
                        musicArrange: project.musicArrange,
                      },
                    },
                    onProgress,
                    { signal },
                  ),
                "track",
                4,
              );
            }}
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
        {step === 5 && (
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
                setStep(4);
                setError(
                  (project.track?.status === "preview-ready" || project.track?.status === "pending-review")
                    ? "Génère d’abord le morceau complet (étape 4) — l’extrait ne suffit pas pour la jaquette."
                    : "Crée d'abord le morceau audio (étape 4) avant la jaquette.",
                );
                return;
              }
              return runStep(
                () => api.cover({ ...payload, artist: project.artist, track: project.track }),
                "cover",
                5,
              );
            }}
          />
        )}
        {step === 6 && (
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
            onGoToCover={() => setStep(5)}
            onPrepare={() => {
              if (!isTrackAudioFinal(project.track)) {
                setStep(4);
                setError(
                  (project.track?.status === "preview-ready" || project.track?.status === "pending-review")
                    ? "Génère d’abord le morceau complet (étape 4) — l’extrait ne suffit pas pour ONCE."
                    : "Crée d'abord le morceau audio (étape 4) avant ONCE.",
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
                6,
              );
            }}
            onReuse={() => {
              if (!isTrackAudioFinal(project.track)) {
                setStep(4);
                setError(
                  (project.track?.status === "preview-ready" || project.track?.status === "pending-review")
                    ? "Génère d’abord le morceau complet (étape 4) — l’extrait ne suffit pas pour ONCE."
                    : "Crée d'abord le morceau audio (étape 4) avant ONCE.",
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
                6,
              );
            }}
          />
        )}
        {step === 7 && (
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
            onGoToTracks={() => setStep(4)}
            onGoToArtist={() => setStep(2)}
            onGoToCover={() => setStep(5)}
            onGoToSocial={() => setStep(8)}
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
                setStep(4);
                setError(
                  (project.track?.status === "preview-ready" || project.track?.status === "pending-review")
                    ? "Génère d’abord le morceau complet (étape 4) — l’extrait ne suffit pas pour le clip."
                    : "Crée d'abord le morceau audio (étape 4) avant le clip.",
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
                7,
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
        {step === 8 && (
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
            onGoToClip={() => setStep(7)}
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
                setStep(4);
                setError(
                  (project.track?.status === "preview-ready" || project.track?.status === "pending-review")
                    ? "Génère d’abord le morceau complet (étape 4) — l’extrait ne suffit pas."
                    : "Crée d'abord le morceau audio (étape 4).",
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
                8,
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
              if (step === 4 && (project.track?.status === "preview-ready" || project.track?.status === "pending-review")) {
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
