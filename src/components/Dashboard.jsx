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
import { STEPS, emptyProject, MUSIC_STYLES, MUSIC_LANGUAGES, formatGenres } from "../lib/studio.js";
import { api } from "../lib/apiClient.js";
import { keysReady, loadKeys, ensureKeysHydrated } from "../lib/keys.js";
import { persistAudioRemote } from "../lib/audioResolve.js";
import { migrateProjectClipBlobs } from "../lib/clipStore.js";
import StyleArtistPicker from "./StyleArtistPicker.jsx";
import {
  isClipReady,
  normalizeProjectClips,
  removeProjectClip,
  setActiveProjectClip,
  stripClipsForDb,
  upsertProjectClip,
} from "../lib/clipsModel.js";
import { patchJob } from "../lib/jobStore.js";
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

export default function Dashboard() {
  const [step, setStep] = useState(1);
  const [project, setProject] = useState(emptyProject);
  const [loading, setLoading] = useState(false);
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
  });
  const [published, setPublished] = useState(false);
  const [projectId, setProjectId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  /** Accueil studio `/` uniquement — masqué quand un projet est ouvert via ?project= */
  const [showHomePipeline, setShowHomePipeline] = useState(true);

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
    if (!pid) return;
    setShowHomePipeline(false);
    (async () => {
      setLoading(true);
      try {
        const { project: saved } = await api.getProject(pid);
        setProjectId(saved.id);
        setProject(
          normalizeProjectClips({ ...emptyProject(), ...(saved.project || {}) }),
        );
        if (saved.seed) setSeed((s) => ({ ...s, ...saved.seed }));
        if (stepParam >= 1 && stepParam <= STEPS.length) setStep(stepParam);
        else if (!saved.project?.lyrics) setStep(3);
        else if (!saved.project?.track) setStep(4);
        setSaveMsg(`Projet ${saved.title}`);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const artistSlug = project.artist?.slug;

  const doneMap = {
    1: Boolean(project.track || project.distrokid),
    2: Boolean(project.artist),
    3: Boolean(project.lyrics),
    4: Boolean(project.track),
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

  async function persist(nextProject, event) {
    setSaving(true);
    setSaveMsg("");
    try {
      const normalized = normalizeProjectClips(nextProject);
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
          normalizeProjectClips({
            ...prev,
            ...normalized,
          }),
        );
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
    setLoading(true);
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
      let result = await fn();

      // Persiste immédiatement l’audio Replicate sur S3 (sinon expire ~1 h)
      if (key === "track" && result?.audioUrl) {
        patchJob(stepJobId, { progress: 70, message: "Persistance audio S3…" });
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
      }

      patchJob(stepJobId, { progress: 88, message: "Sauvegarde projet…" });
      const next = { ...project, [key]: result };
      setProject(next);
      if (goTo) setStep(goTo);
      await persist(next, {
        stepKey: key,
        eventType: "step",
        message: `Étape ${stepLabel} générée`,
      });
      finishStepJob(stepJobId, {
        ok: true,
        message: `${stepLabel} terminé`,
      });
    } catch (e) {
      setError(e.message);
      finishStepJob(stepJobId, {
        ok: false,
        message: e.message || `${stepLabel} en erreur`,
      });
    } finally {
      setLoading(false);
    }
  }

  async function runFullAuto() {
    if (!keysReady(loadKeys())) {
      setError("Configure d'abord un LLM (Gemini ou Ollama) pour lancer l'auto.");
      window.location.href = "/parametres?section=ia";
      return;
    }
    if (seed.styleArtist?.trim() && !seed.styleArtistPick?.id) {
      setError(
        "Choisis et valide un artiste dans les résultats de recherche avant de lancer l'auto.",
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
      const next = {
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
      };
      setProject(normalizeProjectClips(next));
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
        normalizeProjectClips({ ...emptyProject(), ...(saved.project || {}) }),
      );
      if (saved.seed) setSeed((s) => ({ ...s, ...saved.seed }));
      setHistoryOpen(false);
      setSaveMsg(`Chargé : ${saved.title}`);
      // Place l'utilisateur sur la dernière étape utile
      const loaded = normalizeProjectClips(saved.project || {});
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
            {project.track?.audioUrl ? (
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
                  project.track?.audioUrl ? "text-sm" : "text-base md:text-lg"
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
                {project.lyrics?.title ? ` — ${project.lyrics.title}` : ""}
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
              disabled={autoRunning || loading}
              onClick={runFullAuto}
            >
              {autoRunning ? <span class="loading loading-spinner loading-sm" /> : <Zap size={18} />}
              {autoRunning ? "Pipeline en cours…" : "Auto A → Z"}
            </button>
          </div>
          <div class="grid gap-3 md:grid-cols-2">
            <label class="form-control w-full">
              <span class="label-text mb-1 text-xs text-base-content/55">
                Nom de scène (ton artiste fictionnel)
              </span>
              <input
                class="input input-bordered bg-base-200"
                placeholder="Laisser vide pour inventer un nom"
                value={seed.name}
                disabled={autoRunning}
                onInput={(e) => setSeed((s) => ({ ...s, name: e.currentTarget.value }))}
              />
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
            <div class="form-control w-full md:col-span-2">
              <span class="label-text mb-1 text-xs text-base-content/55">
                Styles musicaux (multi)
              </span>
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
                <p class="mt-1 text-[11px] text-primary">{formatGenres(seed.genres)}</p>
              )}
            </div>
            <div class="md:col-span-2">
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
            </div>
            <label class="form-control w-full">
              <span class="label-text mb-1 text-xs text-base-content/55">Langue des chansons</span>
              <select
                class="select select-bordered w-full bg-base-200"
                value={seed.language}
                disabled={autoRunning}
                onChange={(e) => setSeed((s) => ({ ...s, language: e.currentTarget.value }))}
              >
                {MUSIC_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
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
              Génération en cours — étape {STEPS.find((s) => s.id === step)?.label || step}
            </p>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-base-300">
              <div class="pipeline-indeterminate h-full w-1/3 rounded-full bg-primary" />
            </div>
          </div>
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
              onClick={() => setStep(s.id)}
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
            onGenerate={(payload) =>
              runStep(() => api.artist({ ...payload, trends: project.trends }), "artist", 2)
            }
          />
        )}
        {step === 3 && (
          <LyricsStep
            lyrics={project.lyrics}
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
          />
        )}
        {step === 4 && (
          <TracksStep
            track={project.track}
            lyrics={project.lyrics}
            artist={project.artist}
            loading={loading}
            projectId={projectId}
            distrokid={project.distrokid}
            onOpenSettings={() => {
              window.location.href = "/parametres?section=ia";
            }}
            onGenerate={() =>
              runStep(() => api.track({ lyrics: project.lyrics, artist: project.artist }), "track", 4)
            }
            onAttachAudio={(audioUrl, meta = {}) => {
              setError("");
              setProject((prev) => {
                if (!prev.track) return prev;
                const note =
                  meta.note ||
                  (meta.provider === "once-original"
                    ? `Audio ORIGINAL ONCE (${meta.releaseId || prev.distrokid?.releaseId || "?"}).`
                    : meta.provider === "import-file"
                      ? `Audio importé (${meta.fileName || "fichier"})${meta.persisted ? " · S3" : ""}.`
                      : `Audio attaché via URL${meta.persisted ? " · S3" : ""}.`);
                const next = {
                  ...prev,
                  track: {
                    ...prev.track,
                    audioUrl,
                    audioS3Key: meta.s3Key || prev.track.audioS3Key,
                    provider: meta.provider || "import",
                    status: "audio-ready",
                    duration: prev.track.duration || "~",
                    audioEphemeral: !meta.persisted && !meta.s3Key,
                    note,
                    warning: meta.warning,
                    assetMissingReason: undefined,
                  },
                  distrokid: meta.releaseId
                    ? {
                        ...(prev.distrokid || {}),
                        releaseId: meta.releaseId,
                        dashboardUrl: `https://beta.once.app/releases/${meta.releaseId}`,
                      }
                    : prev.distrokid,
                };
                persist(next, {
                  stepKey: "track",
                  eventType:
                    meta.provider === "once-original" ? "audio-restore-once" : "audio-import",
                  message:
                    meta.provider === "once-original"
                      ? "Audio original ONCE restauré"
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
            artist={project.artist}
            track={project.track}
            loading={loading}
            onGenerate={(payload) =>
              runStep(
                () => api.cover({ ...payload, artist: project.artist, track: project.track }),
                "cover",
                5,
              )
            }
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
            onPrepare={() =>
              runStep(
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
                  }),
                "distrokid",
                6,
              )
            }
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
              if (!project.track?.audioUrl) {
                setStep(4);
                setError("Crée d'abord le morceau audio (étape 4) avant le clip.");
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
              if (!project.track?.audioUrl) {
                setStep(4);
                setError("Crée d'abord le morceau audio (étape 4).");
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
            onClick={() => setStep((s) => Math.min(STEPS.length, s + 1))}
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
