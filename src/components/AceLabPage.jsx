import { useEffect, useRef, useState } from "preact/hooks";
import {
  ArrowLeft,
  FlaskConical,
  Play,
  RefreshCw,
  Square,
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

function appendLog(setLogs, line) {
  const ts = new Date().toLocaleTimeString("fr-FR");
  setLogs((prev) => [`[${ts}] ${line}`, ...prev].slice(0, 80));
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
  const [coverStrength, setCoverStrength] = useState(0.35);
  const [busy, setBusy] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [jobMeta, setJobMeta] = useState(null);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");
  const pollRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const k = await ensureKeysHydrated();
      if (cancelled) return;
      setKeys(k);
      setModelId(String(k?.aceStepPreferredModel || "").trim());
    })();
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      abortRef.current?.abort?.();
    };
  }, []);

  async function runProbe() {
    setProbing(true);
    setError("");
    try {
      const res = await api.probeAceStep();
      setProbe(res);
      if (!modelId && res?.activeModel) setModelId(res.activeModel);
      if (!modelId && res?.preferredModel) setModelId(res.preferredModel);
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

  function applyPreset(p) {
    setTitle(p.title);
    setStyle(p.style);
    setLyrics(p.lyrics);
    setBpm(p.bpm);
    appendLog(setLogs, `preset « ${p.label} »`);
  }

  async function switchModel() {
    const id = String(modelId || "").trim();
    if (!id) return;
    setSwitching(true);
    setError("");
    try {
      const res = await api.switchAceStepModel(id);
      if (res?.probe) setProbe(res.probe);
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
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      appendLog(
        setLogs,
        `lab start model=${modelId || "(préférence)"} preview=${preview} bpm=${bpm} cover=${refUrl ? coverStrength : "off"}`,
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
          modelId: modelId || undefined,
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
            Test brut : style + paroles + modèle, sans artiste / wizard / DNA. Utilise les clés
            SONOZZ et le modèle que tu choisis ici.
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
        <p class="text-xs text-base-content/55">{probe?.message || "Pas encore sondé"}</p>
      </section>

      <section class="rounded-box border border-base-content/10 bg-base-200/40 p-4 space-y-3">
        <p class="text-xs font-medium uppercase tracking-wide text-base-content/55">Modèle</p>
        <div class="flex flex-wrap gap-2">
          <select
            class="select select-bordered select-sm min-w-[16rem]"
            value={modelId}
            onChange={(e) => setModelId(e.currentTarget.value)}
          >
            <option value="">Préférence settings / actif</option>
            {usable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.id}
                {m.id === probe?.activeModel ? " · actif" : ""}
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
        </div>
        <p class="text-xs text-base-content/50">
          Aucune restriction : le modèle sélectionné ici est celui utilisé pour le test.
        </p>
      </section>

      <section class="rounded-box border border-base-content/10 bg-base-200/40 p-4 space-y-3">
        <p class="text-xs font-medium uppercase tracking-wide text-base-content/55">Presets</p>
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

      <section class="grid gap-3 sm:grid-cols-[1fr_8rem_auto] items-end">
        <label class="form-control gap-1">
          <span class="label-text text-xs">Cover / référence (URL optionnelle)</span>
          <input
            class="input input-bordered input-sm"
            placeholder="https://…"
            value={refUrl}
            onInput={(e) => setRefUrl(e.currentTarget.value)}
          />
        </label>
        <label class="form-control gap-1">
          <span class="label-text text-xs">Cover strength</span>
          <input
            type="number"
            step="0.05"
            min="0.05"
            max="1"
            class="input input-bordered input-sm"
            value={coverStrength}
            onInput={(e) => setCoverStrength(Number(e.currentTarget.value) || 0.35)}
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
