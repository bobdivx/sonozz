import { useEffect, useRef, useState } from "preact/hooks";
import {
  ArrowLeft,
  FlaskConical,
  Play,
  RefreshCw,
  Square,
  SlidersHorizontal,
} from "lucide-preact";
import { ensureKeysHydrated } from "../lib/keys.js";
import { api } from "../lib/apiClient.js";

const PRESETS = [
  {
    id: "solo-simple",
    label: "Solo simple",
    title: "Lab Solo",
    style: "clean pop rock, full band, clear male lead vocal, radio mix",
    lyrics: `[Verse]
Walking down the avenue at night
City lights are burning bright

[Chorus]
Hold on, hold on, we make it through
Every song I sing is true`,
    bpm: 110,
  },
  {
    id: "duo-mf",
    label: "Duo H/F",
    title: "Lab Duo Mixte",
    style:
      "pop duet, full band. singer 1 male tenor clear. singer 2 female alto clear. one song only.",
    lyrics: `[Verse]
[singer 1: male]
I see the morning in your eyes

[Verse]
[singer 2: female]
I hear the thunder in the skies

[Chorus]
[singer 1: male]
[singer 2: female]
Together we rise, together we fall`,
    bpm: 100,
  },
  {
    id: "duo-mm-rap-gospel",
    label: "Duo H/H rap×gospel",
    title: "Lab Concrete",
    style:
      "Hip Hop duet — 808, boom-bap drums. ONE song only. singer 1 aggressive male rap. singer 2 solo male gospel lead (NOT a choir). never blend voices.",
    lyrics: `[Intro]
[singer 1: male rap]
Yeah. Another day, another fight.

[Verse]
[singer 2: male gospel]
Pavement cracks whisper tales of the grind
Every corner a battle leaving doubt behind

[Hook]
[singer 1: male rap]
[singer 2: male gospel]
This concrete testament etched in sweat and soul
Through the storm we rise taking back control`,
    bpm: 118,
  },
];

/**
 * Profils de réglages issus de l’historique Sonozz (avant / pendant duo).
 * Champs null = auto (selon DiT actif).
 */
const SETTING_PROFILES = [
  {
    id: "auto",
    label: "Auto DiT",
    hint: "steps/CFG du modèle actif",
    inferenceSteps: "",
    guidanceScale: "",
    coverStrength: 0.5,
    coverNoise: 0.35,
  },
  {
    id: "pre-duo-solo",
    label: "Solo pré-duo",
    hint: "~16 août · cover 0.5 / noise 0.35",
    inferenceSteps: "",
    guidanceScale: "",
    coverStrength: 0.5,
    coverNoise: 0.35,
  },
  {
    id: "duo-intro",
    label: "Duo intro (31/08)",
    hint: "f9f0bf6 · cover 0.22 / noise 0.5",
    inferenceSteps: "",
    guidanceScale: "",
    coverStrength: 0.22,
    coverNoise: 0.5,
  },
  {
    id: "duo-actuel",
    label: "Duo actuel",
    hint: "5f29f5b · cover 0.18 / noise 0.28",
    inferenceSteps: "",
    guidanceScale: "",
    coverStrength: 0.18,
    coverNoise: 0.28,
  },
  {
    id: "turbo-strict",
    label: "Turbo 8/0",
    hint: "force 8 steps · CFG 0",
    inferenceSteps: 8,
    guidanceScale: 0,
    coverStrength: 0.5,
    coverNoise: 0.35,
  },
  {
    id: "sft-classic",
    label: "SFT 50/7",
    hint: "force 50 steps · CFG 7 (DiT SFT requis)",
    inferenceSteps: 50,
    guidanceScale: 7,
    coverStrength: 0.5,
    coverNoise: 0.35,
  },
];

function appendLog(setLogs, line) {
  const ts = new Date().toLocaleTimeString("fr-FR");
  setLogs((prev) => [`[${ts}] ${line}`, ...prev].slice(0, 80));
}

function emptyToUndef(v) {
  if (v === "" || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default function AceLabPage() {
  const [keys, setKeys] = useState(null);
  const [probe, setProbe] = useState(null);
  const [probing, setProbing] = useState(false);
  const [modelId, setModelId] = useState("");
  const [switching, setSwitching] = useState(false);
  const [title, setTitle] = useState("ACE Lab");
  const [style, setStyle] = useState(PRESETS[0].style);
  const [lyrics, setLyrics] = useState(PRESETS[0].lyrics);
  const [bpm, setBpm] = useState(110);
  const [language, setLanguage] = useState("en");
  const [preview, setPreview] = useState(true);
  const [durationSec, setDurationSec] = useState(90);
  const [refUrl, setRefUrl] = useState("");
  const [coverStrength, setCoverStrength] = useState(0.5);
  const [coverNoise, setCoverNoise] = useState(0.35);
  const [inferenceSteps, setInferenceSteps] = useState("");
  const [guidanceScale, setGuidanceScale] = useState("");
  const [randomSeed, setRandomSeed] = useState(true);
  const [seed, setSeed] = useState("");
  const [settingsProfile, setSettingsProfile] = useState("auto");
  const [busy, setBusy] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [jobMeta, setJobMeta] = useState(null);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");
  const pollRef = useRef(null);
  const abortRef = useRef(null);
  /** L’utilisateur a choisi un DiT à la main (ne pas écraser à chaque probe). */
  const userPickedModelRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const k = await ensureKeysHydrated();
      if (cancelled) return;
      setKeys(k);
      // Lab : on aligne sur le DiT réellement chargé (probe), pas la préférence SFT settings.
    })();
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      abortRef.current?.abort?.();
    };
  }, []);

  function ditBase(id) {
    return String(id || "")
      .replace(/^.*\//, "")
      .toLowerCase();
  }

  function resolveCatalogModelId(models, activeId) {
    const active = String(activeId || "").trim();
    if (!active) return "";
    const list = Array.isArray(models) ? models : [];
    const hit = list.find((m) => ditBase(m?.id) === ditBase(active));
    return hit?.id || active;
  }

  async function runProbe() {
    setProbing(true);
    setError("");
    try {
      const res = await api.probeAceStep();
      setProbe(res);
      const active = String(res?.activeModel || "").trim();
      if (active && !userPickedModelRef.current) {
        const aligned = resolveCatalogModelId(res?.models, active);
        setModelId(aligned);
        appendLog(setLogs, `sélection = actif ${aligned}`);
      } else if (active && modelId && ditBase(modelId) !== ditBase(active)) {
        appendLog(
          setLogs,
          `mismatch sélection=${modelId} actif=${active} — utilise « Utiliser l’actif » ou « Charger ce modèle »`,
        );
      }
      appendLog(
        setLogs,
        `probe ok=${res?.ok} model=${res?.activeModel || "?"} offload=${res?.offloadToCpu} vram=${res?.gpu?.usedGb ?? "?"}/${res?.gpu?.totalGb ?? "?"} · ${res?.message || ""}`,
      );
    } catch (e) {
      setError(e.message || "Probe impossible");
      appendLog(setLogs, `probe ERR ${e.message}`);
    } finally {
      setProbing(false);
    }
  }

  useEffect(() => {
    if (keys) void runProbe();
  }, [keys]);

  function useActiveModel() {
    const active = String(probe?.activeModel || "").trim();
    if (!active) return;
    const aligned = resolveCatalogModelId(probe?.models, active);
    userPickedModelRef.current = false;
    setModelId(aligned);
    setError("");
    appendLog(setLogs, `utilisé l’actif → ${aligned}`);
  }

  function applyPreset(p) {
    setTitle(p.title);
    setStyle(p.style);
    setLyrics(p.lyrics);
    setBpm(p.bpm);
    appendLog(setLogs, `preset « ${p.label} »`);
  }

  function applySettingsProfile(p) {
    setSettingsProfile(p.id);
    setInferenceSteps(p.inferenceSteps === "" || p.inferenceSteps == null ? "" : p.inferenceSteps);
    setGuidanceScale(p.guidanceScale === "" || p.guidanceScale == null ? "" : p.guidanceScale);
    setCoverStrength(p.coverStrength);
    setCoverNoise(p.coverNoise);
    // SFT classic suppose le DiT SFT — on ne force pas le switch, on prévient.
    if (p.id === "sft-classic") {
      appendLog(
        setLogs,
        `réglages « ${p.label} » · ${p.hint} — charge d’abord XL SFT si ce n’est pas l’actif`,
      );
    } else {
      appendLog(setLogs, `réglages « ${p.label} » · ${p.hint}`);
    }
  }

  async function switchModel() {
    const id = String(modelId || "").trim();
    if (!id) return;
    setSwitching(true);
    setError("");
    userPickedModelRef.current = true;
    try {
      const res = await api.switchAceStepModel(id);
      if (res?.probe) setProbe(res.probe);
      const active = String(res?.probe?.activeModel || "").trim();
      if (active && ditBase(active) === ditBase(id)) {
        userPickedModelRef.current = false;
        setModelId(resolveCatalogModelId(res?.probe?.models || usable, active));
      }
      appendLog(
        setLogs,
        `switch ${id} → ok=${res?.ok !== false} active=${res?.probe?.activeModel || "?"} offload=${res?.probe?.offloadToCpu}`,
      );
      if (res?.ok === false) setError(res.message || "Switch échoué");
    } catch (e) {
      setError(e.message || "Switch impossible");
      appendLog(setLogs, `switch ERR ${e.message}`);
    } finally {
      setSwitching(false);
      await runProbe();
    }
  }

  function stopPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    abortRef.current?.abort?.();
    abortRef.current = null;
  }

  async function cancelJob() {
    const id = jobMeta?.generationId;
    stopPoll();
    setBusy(false);
    if (id) {
      try {
        await api.cancelTrack?.(id);
        appendLog(setLogs, `cancel ${id}`);
      } catch (e) {
        appendLog(setLogs, `cancel ERR ${e.message}`);
      }
    }
  }

  async function generate() {
    setError("");
    setAudioUrl("");
    setJobMeta(null);
    stopPoll();
    let effectiveModel = String(modelId || "").trim();
    if (!effectiveModel && probe?.activeModel) {
      effectiveModel = resolveCatalogModelId(probe.models, probe.activeModel);
    }
    if (modelMismatch && probe?.activeModel) {
      const prev = effectiveModel;
      effectiveModel = resolveCatalogModelId(probe.models, probe.activeModel);
      setModelId(effectiveModel);
      userPickedModelRef.current = false;
      appendLog(
        setLogs,
        `génération alignée sur l’actif ${effectiveModel} (sélection ${prev} non chargée)`,
      );
    }
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const steps = emptyToUndef(inferenceSteps);
    const cfg = emptyToUndef(guidanceScale);
    const seedN = emptyToUndef(seed);
    try {
      appendLog(
        setLogs,
        `lab start model=${effectiveModel || "(préférence)"} profile=${settingsProfile} ` +
          `steps=${steps ?? "auto"} cfg=${cfg ?? "auto"} cover=${refUrl ? coverStrength : "off"} ` +
          `noise=${refUrl ? coverNoise : "-"} preview=${preview}`,
      );
      const started = await api.labAceStep(
        {
          style,
          lyrics,
          title,
          language,
          bpm,
          preview,
          durationSec: preview ? undefined : durationSec,
          referenceAudioUrl: refUrl,
          audioCoverStrength: refUrl ? coverStrength : undefined,
          coverNoiseStrength: refUrl ? coverNoise : undefined,
          inferenceSteps: steps,
          guidanceScale: cfg,
          randomSeed,
          seed: randomSeed ? undefined : seedN,
          modelId: effectiveModel || undefined,
        },
        { signal: ac.signal },
      );
      setJobMeta(started);
      appendLog(
        setLogs,
        `job ${started.generationId} model=${started.model} pick=${started.pickReason} gpuFree=${started.gpu?.freeGb ?? "?"}`,
      );

      const pollOnce = async () => {
        const tick = await api.pollTrack(started.generationId, {
          musicKind: "acestep",
          signal: ac.signal,
        });
        appendLog(
          setLogs,
          `poll ${tick.status || "?"} done=${Boolean(tick.done)} ${tick.message || tick.progress || ""}`,
        );
        if (tick.done && (tick.url || tick.track?.audioUrl)) {
          const url = tick.url || tick.track.audioUrl;
          setAudioUrl(url);
          setBusy(false);
          stopPoll();
          appendLog(setLogs, `audio OK ${url}`);
          await runProbe();
          return true;
        }
        if (/fail|error|cancel/i.test(String(tick.status || ""))) {
          setError(tick.message || tick.error || "Génération échouée");
          setBusy(false);
          stopPoll();
          return true;
        }
        return false;
      };

      if (await pollOnce()) return;
      pollRef.current = setInterval(() => {
        void pollOnce().catch((e) => {
          if (e?.name === "AbortError") return;
          setError(e.message || "Poll échoué");
          setBusy(false);
          stopPoll();
          appendLog(setLogs, `poll ERR ${e.message}`);
        });
      }, 2500);
    } catch (e) {
      if (e?.name !== "AbortError") {
        setError(e.message || "Génération impossible");
        appendLog(setLogs, `lab ERR ${e.message}`);
      }
      setBusy(false);
    }
  }

  const models = Array.isArray(probe?.models) ? probe.models : [];
  const usable = models.filter(
    (m) => m?.engineKnown !== false && m?.switchable !== false && m?.status !== "unsupported",
  );
  const ghost =
    probe?.offloadToCpu === true ||
    (probe?.gpu?.usedGb != null &&
      probe?.gpu?.totalGb >= 16 &&
      probe.gpu.usedGb < 3.5 &&
      probe?.activeModel);
  const selectedBase = String(modelId || "")
    .replace(/^.*\//, "")
    .toLowerCase();
  const activeBase = String(probe?.activeModel || "")
    .replace(/^.*\//, "")
    .toLowerCase();
  const modelMismatch = Boolean(selectedBase && activeBase && selectedBase !== activeBase);
  const activeIsTurbo = /turbo/i.test(activeBase) && !/merge/i.test(activeBase);
  const autoStepsHint = activeIsTurbo ? 8 : activeBase ? 50 : "?";
  const autoCfgHint = activeIsTurbo ? 0 : activeBase ? 7 : "?";

  return (
    <div class="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs uppercase tracking-wide text-base-content/50">Diagnostic</p>
          <h1 class="font-display flex items-center gap-2 text-2xl font-bold">
            <FlaskConical size={22} />
            Lab ACE-Step
          </h1>
          <p class="mt-1 max-w-2xl text-sm text-base-content/65">
            Test brut : style + paroles + modèle + réglages variables (steps, CFG, cover). Sans
            artiste / wizard / DNA.
          </p>
        </div>
        <a href="/parametres?section=studios" class="btn btn-ghost btn-sm gap-1">
          <ArrowLeft size={14} />
          Paramètres
        </a>
      </div>

      <section class="rounded-box border border-base-content/10 bg-base-200/40 p-4 space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn btn-sm gap-1"
            disabled={probing || !keys}
            onClick={() => void runProbe()}
          >
            <RefreshCw size={14} class={probing ? "animate-spin" : ""} />
            Sonde ACE
          </button>
          {probe?.base ? (
            <a class="link text-sm" href={probe.base} target="_blank" rel="noreferrer">
              {probe.base}
            </a>
          ) : null}
        </div>
        <div class="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p class="text-xs text-base-content/50">État</p>
            <p>
              {probe?.pipelineUp === false ? "pipeline down" : probe?.pipelineState || "—"}
              {probe?.ok === false ? " · KO" : probe?.ok ? " · OK" : ""}
            </p>
          </div>
          <div>
            <p class="text-xs text-base-content/50">Modèle actif</p>
            <p class="break-all">{probe?.activeModel || "—"}</p>
          </div>
          <div>
            <p class="text-xs text-base-content/50">Offload CPU</p>
            <p class={ghost ? "text-error font-medium" : ""}>
              {probe?.offloadToCpu == null ? "—" : probe.offloadToCpu ? "OUI (fantôme)" : "non"}
            </p>
          </div>
          <div>
            <p class="text-xs text-base-content/50">VRAM</p>
            <p>
              {probe?.gpu?.usedGb != null
                ? `${probe.gpu.usedGb} / ${probe.gpu.totalGb} Go`
                : "—"}
            </p>
          </div>
        </div>
        {ghost ? (
          <p class="text-sm text-error">
            DiT probablement en offload CPU — l’audio sera pourri. Switch le modèle ou restart
            ACE avec ACESTEP_OFFLOAD_TO_CPU=0.
          </p>
        ) : null}
        {modelMismatch ? (
          <div class="space-y-2">
            <p class="text-sm text-warning">
              Sélection « {modelId} » ≠ actif « {probe.activeModel} ». La génération utilisera
              l’actif (Turbo). Pour forcer SFT : « Charger ce modèle » (plusieurs minutes).
            </p>
            <button type="button" class="btn btn-warning btn-xs" onClick={() => useActiveModel()}>
              Utiliser l’actif ({probe.activeModel?.replace(/^.*\//, "")})
            </button>
          </div>
        ) : null}
        <p class="text-xs text-base-content/55">{probe?.message || "Pas encore sondé"}</p>
      </section>

      <section class="rounded-box border border-base-content/10 bg-base-200/40 p-4 space-y-3">
        <p class="text-xs font-medium uppercase tracking-wide text-base-content/55">Modèle</p>
        <div class="flex flex-wrap gap-2">
          <select
            class="select select-bordered select-sm min-w-[16rem]"
            value={modelId}
            onChange={(e) => {
              userPickedModelRef.current = true;
              setModelId(e.currentTarget.value);
            }}
          >
            <option value="">DiT actif (recommandé lab)</option>
            {usable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.id}
                {ditBase(m.id) === activeBase ? " · actif" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            class="btn btn-sm"
            disabled={switching || !modelId}
            onClick={() => void switchModel()}
          >
            {switching ? "Switch…" : "Charger ce modèle"}
          </button>
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            disabled={!probe?.activeModel}
            onClick={() => useActiveModel()}
          >
            Utiliser l’actif
          </button>
        </div>
        <p class="text-xs text-base-content/50">
          Le modèle sélectionné doit être celui réellement chargé (actif). Sinon la génération
          est refusée — Gradio ne switch pas via le champ ditModel du job.
        </p>
      </section>

      <section class="rounded-box border border-base-content/10 bg-base-200/40 p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-base-content/55">
            <SlidersHorizontal size={14} />
            Réglages ACE
          </p>
          <p class="text-xs text-base-content/45">
            Auto DiT ≈ steps {autoStepsHint} · CFG {autoCfgHint}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          {SETTING_PROFILES.map((p) => (
            <button
              key={p.id}
              type="button"
              class={`btn btn-xs ${settingsProfile === p.id ? "btn-primary" : "btn-ghost"}`}
              title={p.hint}
              onClick={() => applySettingsProfile(p)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p class="text-xs text-base-content/50">
          {SETTING_PROFILES.find((p) => p.id === settingsProfile)?.hint ||
            "Profils basés sur les commits avant / pendant le duo."}
        </p>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label class="form-control gap-1">
            <span class="label-text text-xs">Inference steps (vide = auto)</span>
            <input
              type="number"
              min="1"
              max="200"
              class="input input-bordered input-sm"
              placeholder={`auto ${autoStepsHint}`}
              value={inferenceSteps}
              onInput={(e) => {
                setSettingsProfile("custom");
                setInferenceSteps(e.currentTarget.value);
              }}
            />
          </label>
          <label class="form-control gap-1">
            <span class="label-text text-xs">Guidance / CFG (vide = auto)</span>
            <input
              type="number"
              min="0"
              max="20"
              step="0.5"
              class="input input-bordered input-sm"
              placeholder={`auto ${autoCfgHint}`}
              value={guidanceScale}
              onInput={(e) => {
                setSettingsProfile("custom");
                setGuidanceScale(e.currentTarget.value);
              }}
            />
          </label>
          <label class="form-control gap-1">
            <span class="label-text text-xs">Cover strength</span>
            <input
              type="number"
              step="0.01"
              min="0.05"
              max="1"
              class="input input-bordered input-sm"
              value={coverStrength}
              onInput={(e) => {
                setSettingsProfile("custom");
                setCoverStrength(Number(e.currentTarget.value) || 0.35);
              }}
            />
          </label>
          <label class="form-control gap-1">
            <span class="label-text text-xs">Cover noise</span>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              class="input input-bordered input-sm"
              value={coverNoise}
              onInput={(e) => {
                setSettingsProfile("custom");
                setCoverNoise(Number(e.currentTarget.value) || 0);
              }}
            />
          </label>
        </div>
        <div class="flex flex-wrap items-end gap-3">
          <label class="label cursor-pointer justify-start gap-2 py-0">
            <input
              type="checkbox"
              class="checkbox checkbox-sm"
              checked={randomSeed}
              onChange={(e) => {
                setSettingsProfile("custom");
                setRandomSeed(e.currentTarget.checked);
              }}
            />
            <span class="label-text text-sm">Seed aléatoire</span>
          </label>
          <label class="form-control gap-1 w-36">
            <span class="label-text text-xs">Seed fixe</span>
            <input
              type="number"
              class="input input-bordered input-sm"
              disabled={randomSeed}
              value={seed}
              onInput={(e) => {
                setSettingsProfile("custom");
                setSeed(e.currentTarget.value);
              }}
            />
          </label>
        </div>
      </section>

      <section class="rounded-box border border-base-content/10 bg-base-200/40 p-4 space-y-3">
        <p class="text-xs font-medium uppercase tracking-wide text-base-content/55">
          Presets paroles / style
        </p>
        <div class="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              class="btn btn-ghost btn-xs"
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <section class="grid gap-4 lg:grid-cols-2">
        <label class="form-control gap-1">
          <span class="label-text text-xs uppercase tracking-wide text-base-content/55">
            Style (caption ACE)
          </span>
          <textarea
            class="textarea textarea-bordered min-h-40 font-mono text-sm"
            value={style}
            onInput={(e) => setStyle(e.currentTarget.value)}
          />
        </label>
        <label class="form-control gap-1">
          <span class="label-text text-xs uppercase tracking-wide text-base-content/55">
            Paroles (tags [singer] inclus)
          </span>
          <textarea
            class="textarea textarea-bordered min-h-40 font-mono text-sm"
            value={lyrics}
            onInput={(e) => setLyrics(e.currentTarget.value)}
          />
        </label>
      </section>

      <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label class="form-control gap-1">
          <span class="label-text text-xs">Titre</span>
          <input
            class="input input-bordered input-sm"
            value={title}
            onInput={(e) => setTitle(e.currentTarget.value)}
          />
        </label>
        <label class="form-control gap-1">
          <span class="label-text text-xs">BPM</span>
          <input
            type="number"
            class="input input-bordered input-sm"
            value={bpm}
            onInput={(e) => setBpm(Number(e.currentTarget.value) || 0)}
          />
        </label>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Langue</span>
          <input
            class="input input-bordered input-sm"
            value={language}
            onInput={(e) => setLanguage(e.currentTarget.value)}
          />
        </label>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Durée full (s)</span>
          <input
            type="number"
            class="input input-bordered input-sm"
            disabled={preview}
            value={durationSec}
            onInput={(e) => setDurationSec(Number(e.currentTarget.value) || 90)}
          />
        </label>
      </section>

      <section class="grid gap-3 sm:grid-cols-[1fr_auto] items-end">
        <label class="form-control gap-1">
          <span class="label-text text-xs">Cover / référence (URL optionnelle)</span>
          <input
            class="input input-bordered input-sm"
            placeholder="https://… (active cover strength + noise)"
            value={refUrl}
            onInput={(e) => setRefUrl(e.currentTarget.value)}
          />
        </label>
        <label class="label cursor-pointer justify-start gap-2 py-0">
          <input
            type="checkbox"
            class="checkbox checkbox-sm"
            checked={preview}
            onChange={(e) => setPreview(e.currentTarget.checked)}
          />
          <span class="label-text text-sm">Preview ~30s</span>
        </label>
      </section>

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-primary gap-1"
          disabled={busy || !keys || (!style.trim() && !lyrics.trim())}
          onClick={() => void generate()}
        >
          <Play size={14} />
          {busy ? "Génération…" : "Générer"}
        </button>
        {busy ? (
          <button type="button" class="btn btn-ghost gap-1" onClick={() => void cancelJob()}>
            <Square size={14} />
            Stop
          </button>
        ) : null}
      </div>

      {error ? <p class="text-sm text-error whitespace-pre-wrap">{error}</p> : null}

      {audioUrl ? (
        <section class="rounded-box border border-success/30 bg-success/5 p-4 space-y-2">
          <p class="text-sm font-medium">Résultat</p>
          <audio controls src={audioUrl} class="w-full" />
          <a class="link text-sm break-all" href={audioUrl} target="_blank" rel="noreferrer">
            {audioUrl}
          </a>
        </section>
      ) : null}

      <section class="rounded-box border border-base-content/10 bg-base-300/30 p-3">
        <p class="mb-2 text-xs font-medium uppercase tracking-wide text-base-content/55">Logs</p>
        <pre class="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-base-content/80">
          {logs.length ? logs.join("\n") : "—"}
        </pre>
      </section>
    </div>
  );
}
