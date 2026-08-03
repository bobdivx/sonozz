import { useEffect, useState } from "preact/hooks";
import {
  TrendingUp,
  UserRound,
  PenLine,
  AudioLines,
  ImagePlus,
  Music2,
  Clapperboard,
  ChevronRight,
  Waves,
  Settings2,
  Zap,
  History,
  Save,
} from "lucide-preact";
import TrendsStep from "./steps/TrendsStep.jsx";
import ArtistStep from "./steps/ArtistStep.jsx";
import LyricsStep from "./steps/LyricsStep.jsx";
import TracksStep from "./steps/TracksStep.jsx";
import CoverStep from "./steps/CoverStep.jsx";
import DistroKidStep from "./steps/DistroKidStep.jsx";
import SocialStep from "./steps/SocialStep.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import HistoryPanel from "./HistoryPanel.jsx";
import { STEPS, emptyProject } from "../lib/studio.js";
import { api } from "../lib/apiClient.js";
import { keysReady, loadKeys } from "../lib/keys.js";

const ICONS = {
  1: TrendingUp,
  2: UserRound,
  3: PenLine,
  4: AudioLines,
  5: ImagePlus,
  6: Music2,
  7: Clapperboard,
};

const STEP_STATUS_LABEL = {
  trends: "Tendances",
  artist: "Artiste",
  lyrics: "Paroles",
  track: "Morceau",
  cover: "Jaquette",
  distrokid: "ONCE",
  social: "Réseaux",
  done: "Terminé",
};

export default function Dashboard() {
  const [step, setStep] = useState(1);
  const [project, setProject] = useState(emptyProject);
  const [loading, setLoading] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState([]);
  const [seed, setSeed] = useState({ name: "", bioHint: "", theme: "", market: "FR" });
  const [published, setPublished] = useState(false);
  const [projectId, setProjectId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    setReady(keysReady(loadKeys()));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pid = params.get("project");
    const stepParam = Number(params.get("step"));
    if (!pid) return;
    (async () => {
      setLoading(true);
      try {
        const { project: saved } = await api.getProject(pid);
        setProjectId(saved.id);
        setProject({ ...emptyProject(), ...(saved.project || {}) });
        if (saved.seed) setSeed((s) => ({ ...s, ...saved.seed }));
        if (stepParam >= 1 && stepParam <= 7) setStep(stepParam);
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
    1: Boolean(project.trends),
    2: Boolean(project.artist),
    3: Boolean(project.lyrics),
    4: Boolean(project.track),
    5: Boolean(project.cover),
    6: Boolean(project.distrokid),
    7: Boolean(project.social),
  };
  const completed = Object.values(doneMap).filter(Boolean).length;
  const progress = Math.round((completed / STEPS.length) * 100);

  async function persist(nextProject, event) {
    setSaving(true);
    setSaveMsg("");
    try {
      const data = await api.saveProject({
        id: projectId,
        project: nextProject,
        seed,
        event,
      });
      const saved = data.project;
      setProjectId(saved.id);
      if (data.artist?.slug) {
        setProject({
          ...nextProject,
          artist: nextProject.artist
            ? { ...nextProject.artist, slug: data.artist.slug }
            : nextProject.artist,
        });
        setSaveMsg(`Sauvé · /artiste/${data.artist.slug}`);
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
      setSettingsOpen(true);
      setError("Configure d'abord ta clé Gemini.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await fn();
      const next = { ...project, [key]: result };
      setProject(next);
      if (goTo) setStep(goTo);
      await persist(next, {
        stepKey: key,
        eventType: "step",
        message: `Étape ${STEP_STATUS_LABEL[key] || key} générée`,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function runFullAuto() {
    if (!keysReady(loadKeys())) {
      setSettingsOpen(true);
      setError("Configure d'abord ta clé Gemini pour lancer l'auto.");
      return;
    }
    setAutoRunning(true);
    setLoading(true);
    setError("");
    setLog([{ step: "start", message: "Démarrage du pipeline automatique…" }]);
    setPublished(false);
    try {
      const data = await api.pipeline(seed);
      const next = {
        trends: data.trends,
        artist: data.artist,
        lyrics: data.lyrics,
        track: data.track,
        cover: data.cover,
        distrokid: data.distrokid,
        social: data.social,
      };
      setProject(next);
      setLog(data.log || []);
      await persist(next, {
        stepKey: "pipeline",
        eventType: "pipeline",
        message: "Pipeline A→Z terminé",
        payload: { log: data.log },
      });
      if (data.track?.audioUrl) {
        setStep(7);
      } else {
        setStep(4);
        setError(
          "Pipeline OK jusqu'au morceau, mais sans fichier audio. Ajoute Replicate (ou finalise Suno) à l'étape 4 avant les shorts.",
        );
      }
    } catch (e) {
      setError(e.message);
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
      setProject({ ...emptyProject(), ...(saved.project || {}) });
      if (saved.seed) setSeed((s) => ({ ...s, ...saved.seed }));
      setHistoryOpen(false);
      setSaveMsg(`Chargé : ${saved.title}`);
      // Place l'utilisateur sur la dernière étape utile
      if (saved.project?.social) setStep(7);
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
    <div class="mx-auto min-h-screen w-full max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <header class="mb-8 grid gap-8 md:grid-cols-[1.15fr_0.85fr] md:items-end">
        <div class="space-y-4 animate-rise">
          <div class="flex flex-wrap items-center gap-3">
            <p class="inline-flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-primary">
              <Waves size={14} /> Studio automatisé
            </p>
            <button type="button" class="btn btn-ghost btn-xs gap-1" onClick={() => setSettingsOpen(true)}>
              <Settings2 size={14} />
              Clés API
              <span class={`ml-1 h-2 w-2 rounded-full ${ready ? "bg-success" : "bg-warning animate-pulse-soft"}`} />
            </button>
            <button type="button" class="btn btn-ghost btn-xs gap-1" onClick={() => setHistoryOpen(true)}>
              <History size={14} />
              Historique
            </button>
            <a href="/artistes" class="btn btn-ghost btn-xs gap-1">
              <UserRound size={14} />
              Artistes
            </a>
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
          <h1 class="font-display text-5xl font-extrabold leading-[0.95] tracking-tight md:text-7xl">
            SONOZZ
          </h1>
          <p class="max-w-md text-base text-base-content/70 md:text-lg">
            Pipeline A→Z : Deezer + Gemini + ONCE → Spotify + shorts.
          </p>
        </div>

        <div class="animate-rise space-y-3">
          <div class="flex items-center justify-between text-sm">
            <span class="text-base-content/60">Pipeline</span>
            <span class="font-display text-primary">{progress}%</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-base-300">
            <div class="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          {project.artist && (
            <p class="text-sm text-base-content/55">
              Projet : <span class="text-base-content">{project.artist.name}</span>
              {project.lyrics?.title ? ` — ${project.lyrics.title}` : ""}
            </p>
          )}
        </div>
      </header>

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
          <input
            class="input input-bordered bg-base-200"
            placeholder="Nom artiste (optionnel)"
            value={seed.name}
            onInput={(e) => setSeed((s) => ({ ...s, name: e.currentTarget.value }))}
          />
          <input
            class="input input-bordered bg-base-200"
            placeholder="Thème / titre (optionnel)"
            value={seed.theme}
            onInput={(e) => setSeed((s) => ({ ...s, theme: e.currentTarget.value }))}
          />
          <input
            class="input input-bordered bg-base-200 md:col-span-2"
            placeholder="Indices bio / style (optionnel)"
            value={seed.bioHint}
            onInput={(e) => setSeed((s) => ({ ...s, bioHint: e.currentTarget.value }))}
          />
        </div>
        {log.length > 0 && (
          <ul class="mt-4 max-h-28 space-y-1 overflow-y-auto text-xs text-base-content/55">
            {log.map((item, i) => (
              <li key={`${item.step}-${i}`}>
                <span class="text-primary">{STEP_STATUS_LABEL[item.step] || item.step}</span> — {item.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <div class="mb-4 border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>
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
          <TrendsStep
            trends={project.trends}
            loading={loading}
            onAnalyze={() => runStep(() => api.trends({ market: seed.market }), "trends", 1)}
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
                () => api.lyrics({ ...payload, artist: project.artist, trends: project.trends }),
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
            onOpenSettings={() => setSettingsOpen(true)}
            onGenerate={() =>
              runStep(() => api.track({ lyrics: project.lyrics, artist: project.artist }), "track", 4)
            }
            onAttachAudio={(audioUrl, meta = {}) => {
              setError("");
              setProject((prev) => {
                if (!prev.track) return prev;
                const next = {
                  ...prev,
                  track: {
                    ...prev.track,
                    audioUrl,
                    provider: meta.provider || "import",
                    status: "audio-ready",
                    duration: prev.track.duration || "~",
                    note:
                      meta.provider === "import-file"
                        ? `Audio importé (${meta.fileName || "fichier"}).`
                        : "Audio attaché via URL.",
                    warning: undefined,
                  },
                };
                persist(next, {
                  stepKey: "track",
                  eventType: "audio-import",
                  message: "Audio importé",
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
            onConfigure={() => setSettingsOpen(true)}
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
          <SocialStep
            social={project.social}
            artist={project.artist}
            track={project.track}
            cover={project.cover || (project.artist?.imageUrl ? { imageUrl: project.artist.imageUrl } : null)}
            lyrics={project.lyrics}
            loading={loading}
            published={published}
            onGoToTracks={() => setStep(4)}
            onGenerate={() => {
              if (!project.track?.audioUrl) {
                setStep(4);
                setError("Crée d'abord le morceau audio (étape 4) avant les shorts.");
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
            onPublish={() => setPublished(true)}
            onSocialUpdate={(nextSocial) => {
              setProject((prev) => {
                const next = { ...prev, social: nextSocial };
                persist(next, {
                  stepKey: "social",
                  eventType: "publish",
                  message: "Short diffusé / exporté",
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

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(keys) => {
          setReady(keysReady(keys));
        }}
      />
      <HistoryPanel
        open={historyOpen}
        currentId={projectId}
        onClose={() => setHistoryOpen(false)}
        onLoad={loadFromHistory}
      />
    </div>
  );
}
