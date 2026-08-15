import { useEffect, useRef, useState } from "preact/hooks";
import {
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Radio,
  XCircle,
} from "lucide-preact";
import { saveKeysAsync, isStudioEnabled, keysAfterStudioToggle } from "../lib/keys.js";
import { api } from "../lib/apiClient.js";
import AceStepModelsPanel from "./AceStepModelsPanel.jsx";
import SongGenModelsPanel from "./SongGenModelsPanel.jsx";

const STUDIOS = [
  {
    id: "acestep",
    title: "ACE-Step Studio",
    kind: "local",
    blurb: "Local Pinokio — voix + toutes langues, jusqu’à ~8 min.",
    docs: "https://github.com/timoncool/ACE-Step-Studio",
  },
  {
    id: "songgen",
    title: "SongGeneration Studio",
    kind: "local",
    blurb: "Local Pinokio — chante surtout EN / ZH (FR via MiniMax).",
    docs: "https://github.com/BazedFrog/SongGeneration-Studio",
  },
  {
    id: "replicate",
    title: "MiniMax (Replicate)",
    kind: "cloud",
    blurb: "Cloud — toutes langues. Token aussi utilisé pour Flux et Seedance.",
    docs: "https://replicate.com/account/api-tokens",
  },
];

function StatusLine({ status, message }) {
  if (status === "checking") {
    return (
      <span class="inline-flex items-center gap-1.5 text-sm text-base-content/60">
        <span class="loading loading-spinner loading-xs" />
        Test en cours…
      </span>
    );
  }
  if (status === "ok") {
    return (
      <span class="inline-flex items-start gap-1.5 text-sm text-success">
        <CheckCircle2 size={15} class="mt-0.5 shrink-0" />
        <span class="break-words">{message || "Joignable"}</span>
      </span>
    );
  }
  if (status === "error") {
    return (
      <span class="inline-flex items-start gap-1.5 text-sm text-error">
        <XCircle size={15} class="mt-0.5 shrink-0" />
        <span class="break-words">{message || "Injoignable"}</span>
      </span>
    );
  }
  return <span class="text-sm text-base-content/45">Pas encore testé</span>;
}

function emptyStudioState() {
  return {
    status: "idle",
    message: "",
    models: [],
    gpu: null,
    pickedModel: null,
    preferredModel: null,
    activeModel: null,
    hasReadyModel: null,
    base: "",
  };
}

export default function MusicStudiosPanel({ keys, onChange, onKeysReplace }) {
  const [ace, setAce] = useState(emptyStudioState);
  const [song, setSong] = useState(emptyStudioState);
  const [mini, setMini] = useState(emptyStudioState);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState({ acestep: "", songgen: "", replicate: "" });
  const [providerBusy, setProviderBusy] = useState(false);
  const downloadPollRef = useRef(null);
  const mounted = useRef(true);

  const provider = String(keys?.musicProvider || "replicate").trim() || "replicate";

  function studioOn(id) {
    return isStudioEnabled(keys, id);
  }

  useEffect(() => {
    mounted.current = true;
    void probeAll();
    return () => {
      mounted.current = false;
      if (downloadPollRef.current) clearInterval(downloadPollRef.current);
    };
  }, []);

  async function persist(partial = {}) {
    const next = { ...keys, ...partial };
    onKeysReplace?.(next);
    const { keys: saved } = await saveKeysAsync(next);
    onKeysReplace?.(saved);
    return saved;
  }

  async function probeAceRaw() {
    const res = await api.probeAceStep();
    if (!mounted.current) return;
    applyAce(res);
  }

  async function probeSongRaw() {
    const res = await api.probeSongGen();
    if (!mounted.current) return;
    applySong(res);
    maybePollSong(res?.models);
    if (!anyDownloading(res?.models)) setBusyId(null);
  }

  async function probeMiniRaw() {
    const res = await api.probeReplicate();
    if (!mounted.current) return;
    setMini({
      status: res?.ok ? "ok" : "error",
      message: res?.message || (res?.ok ? "Compte OK" : "Token invalide"),
      models: [],
      gpu: null,
      pickedModel: null,
      preferredModel: null,
      activeModel: null,
      hasReadyModel: res?.ok ?? null,
      base: "",
    });
  }

  function applyAce(res) {
    setAce({
      status: res?.ok ? "ok" : "error",
      message: res?.message || (res?.ok ? "Joignable" : "Injoignable"),
      models: Array.isArray(res?.models) ? res.models : [],
      gpu: res?.gpu || null,
      pickedModel: res?.pickedModel || res?.activeModel || null,
      preferredModel: res?.preferredModel || keys.aceStepPreferredModel || null,
      activeModel: res?.activeModel || res?.pickedModel || null,
      hasReadyModel: res?.hasReadyModel ?? null,
      base: res?.base || keys.aceStepBaseUrl || "",
    });
  }

  function applySong(res) {
    setSong({
      status: res?.ok ? "ok" : "error",
      message: res?.message || (res?.ok ? "Joignable" : "Injoignable"),
      models: Array.isArray(res?.models) ? res.models : [],
      gpu: res?.gpu || null,
      pickedModel: res?.pickedModel || res?.defaultModel || null,
      preferredModel: res?.preferredModel || keys.songGenPreferredModel || null,
      activeModel: res?.pickedModel || res?.defaultModel || null,
      hasReadyModel: res?.hasReadyModel ?? null,
      base: res?.base || keys.songGenBaseUrl || "",
    });
  }

  function anyDownloading(models) {
    return (models || []).some((m) => m?.status === "downloading");
  }

  function maybePollSong(models) {
    if (downloadPollRef.current) {
      clearInterval(downloadPollRef.current);
      downloadPollRef.current = null;
    }
    if (!anyDownloading(models)) return;
    downloadPollRef.current = setInterval(() => {
      void probeSong({ quiet: true });
    }, 4000);
  }

  async function probeAce({ quiet = false } = {}) {
    if (!quiet) setAce((s) => ({ ...s, status: "checking", message: "" }));
    try {
      await persist();
      await probeAceRaw();
    } catch (e) {
      if (!mounted.current) return;
      setAce((s) => ({
        ...s,
        status: "error",
        message: e.message || "Test impossible",
        models: [],
      }));
    }
  }

  async function probeSong({ quiet = false } = {}) {
    if (!quiet) setSong((s) => ({ ...s, status: "checking", message: "" }));
    try {
      await persist();
      await probeSongRaw();
    } catch (e) {
      if (!mounted.current) return;
      setSong((s) => ({
        ...s,
        status: "error",
        message: e.message || "Test impossible",
        models: [],
      }));
      if (downloadPollRef.current) {
        clearInterval(downloadPollRef.current);
        downloadPollRef.current = null;
      }
    }
  }

  async function probeMini({ quiet = false } = {}) {
    if (!quiet) setMini((s) => ({ ...s, status: "checking", message: "" }));
    try {
      await persist();
      await probeMiniRaw();
    } catch (e) {
      if (!mounted.current) return;
      setMini((s) => ({
        ...s,
        status: "error",
        message: e.message || "Test impossible",
      }));
    }
  }

  async function probeAll() {
    setAce((s) => ({ ...s, status: "checking", message: "" }));
    setSong((s) => ({ ...s, status: "checking", message: "" }));
    setMini((s) => ({ ...s, status: "checking", message: "" }));
    try {
      await persist();
    } catch {
      /* probe quand même avec les clés déjà hydratées */
    }
    const jobs = [];
    if (isStudioEnabled(keys, "acestep")) {
      jobs.push(
        probeAceRaw().catch((e) => {
          if (!mounted.current) return;
          setAce((s) => ({
            ...s,
            status: "error",
            message: e.message || "Test impossible",
            models: [],
          }));
        }),
      );
    } else {
      setAce((s) => ({ ...s, status: "idle", message: "Désactivé", models: [] }));
    }
    if (isStudioEnabled(keys, "songgen")) {
      jobs.push(
        probeSongRaw().catch((e) => {
          if (!mounted.current) return;
          setSong((s) => ({
            ...s,
            status: "error",
            message: e.message || "Test impossible",
            models: [],
          }));
        }),
      );
    } else {
      setSong((s) => ({ ...s, status: "idle", message: "Désactivé", models: [] }));
    }
    if (isStudioEnabled(keys, "replicate")) {
      jobs.push(
        probeMiniRaw().catch((e) => {
          if (!mounted.current) return;
          setMini((s) => ({
            ...s,
            status: "error",
            message: e.message || "Test impossible",
          }));
        }),
      );
    } else {
      setMini((s) => ({ ...s, status: "idle", message: "Désactivé" }));
    }
    await Promise.all(jobs);
  }

  async function useProvider(id) {
    if (!studioOn(id) || id === provider || providerBusy) return;
    setProviderBusy(true);
    try {
      await persist({ musicProvider: id });
    } finally {
      setProviderBusy(false);
    }
  }

  async function toggleStudio(id, enabled) {
    if (providerBusy) return;
    setProviderBusy(true);
    try {
      const next = keysAfterStudioToggle(keys, id, enabled);
      await persist(next);
      if (enabled) {
        if (id === "acestep") await probeAce();
        else if (id === "songgen") await probeSong();
        else await probeMini();
      } else if (id === "acestep") {
        setAce((s) => ({ ...s, status: "idle", message: "Désactivé", models: [] }));
      } else if (id === "songgen") {
        setSong((s) => ({ ...s, status: "idle", message: "Désactivé", models: [] }));
      } else {
        setMini((s) => ({ ...s, status: "idle", message: "Désactivé" }));
      }
    } finally {
      setProviderBusy(false);
    }
  }

  async function runAceUse(modelId) {
    if (!modelId || busyId) return;
    setBusyId(modelId);
    setActionError((e) => ({ ...e, acestep: "" }));
    try {
      await persist({ aceStepPreferredModel: modelId });
      const res = await api.switchAceStepModel(modelId);
      if (!res?.ok) {
        setActionError((e) => ({ ...e, acestep: res?.message || "Switch impossible" }));
      } else if (res.probe) applyAce(res.probe);
      else await probeAce({ quiet: true });
    } catch (e) {
      setActionError((err) => ({ ...err, acestep: e.message || "Switch impossible" }));
    } finally {
      setBusyId(null);
    }
  }

  async function runSongAction(modelId, action) {
    if ((!modelId && action !== "unload") || busyId) return;
    setBusyId(modelId || "__unload__");
    setActionError((e) => ({ ...e, songgen: "" }));
    try {
      let res;
      if (action === "download") res = await api.downloadSongGenModel(modelId);
      else if (action === "cancel") res = await api.cancelSongGenDownload(modelId);
      else if (action === "delete") res = await api.deleteSongGenModel(modelId);
      else if (action === "use") {
        await persist({ songGenPreferredModel: modelId });
        res = await api.loadSongGenModel(modelId);
      } else throw new Error("Action inconnue");

      if (!res?.ok) {
        setActionError((e) => ({ ...e, songgen: res?.message || "Action impossible" }));
        setBusyId(null);
        return;
      }
      if (res.probe) applySong(res.probe);
      else await probeSong({ quiet: true });
      maybePollSong(res.probe?.models || song.models);
      if (action !== "download" || res.alreadyReady) setBusyId(null);
      else if (!anyDownloading(res.probe?.models || [])) setBusyId(null);
    } catch (e) {
      setActionError((err) => ({ ...err, songgen: e.message || "Action impossible" }));
      setBusyId(null);
    }
  }

  function studioState(id) {
    if (id === "acestep") return ace;
    if (id === "songgen") return song;
    return mini;
  }

  function onRetest(id) {
    if (id === "acestep") return probeAce();
    if (id === "songgen") return probeSong();
    return probeMini();
  }

  return (
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-base-content/60">
          Configure chaque moteur, active-le, teste-le, puis choisis celui qui génère.
        </p>
        <button
          type="button"
          class="btn btn-ghost btn-sm gap-1"
          onClick={() => void probeAll()}
        >
          <RefreshCw size={14} /> Tout retester
        </button>
      </div>

      {STUDIOS.map((studio) => {
        const st = studioState(studio.id);
        const on = studioOn(studio.id);
        const active = on && provider === studio.id;
        return (
          <article
            key={studio.id}
            class={`space-y-3 border p-4 ${
              !on
                ? "border-base-content/10 bg-base-200/20 opacity-70"
                : active
                  ? "border-primary bg-primary/5"
                  : "border-base-content/10 bg-base-200/30"
            }`}
          >
            <header class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="font-display text-lg font-semibold">{studio.title}</h3>
                  {on ? (
                    active ? (
                      <span class="badge badge-primary badge-sm">moteur actif</span>
                    ) : (
                      <span class="badge badge-ghost badge-sm">
                        {studio.kind === "local" ? "local" : "cloud"}
                      </span>
                    )
                  ) : (
                    <span class="badge badge-ghost badge-sm">désactivé</span>
                  )}
                </div>
                <p class="text-xs text-base-content/55">{studio.blurb}</p>
              </div>
              <div class="flex flex-wrap items-center gap-3">
                <label class="flex cursor-pointer items-center gap-2 text-sm">
                  <span class={on ? "text-success" : "text-base-content/50"}>
                    {on ? "Activé" : "Désactivé"}
                  </span>
                  <input
                    type="checkbox"
                    class="toggle toggle-sm toggle-primary"
                    checked={on}
                    disabled={providerBusy}
                    onChange={(e) => void toggleStudio(studio.id, e.currentTarget.checked)}
                  />
                </label>
                {on && (
                  <>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs gap-1"
                      disabled={st.status === "checking"}
                      onClick={() => void onRetest(studio.id)}
                    >
                      <RefreshCw size={12} /> Retester
                    </button>
                    <button
                      type="button"
                      class={`btn btn-xs gap-1 ${active ? "btn-primary" : "btn-outline"}`}
                      disabled={active || providerBusy}
                      onClick={() => void useProvider(studio.id)}
                    >
                      <Radio size={12} />
                      {active ? "En service" : "Utiliser"}
                    </button>
                  </>
                )}
              </div>
            </header>

            {on ? (
              <StatusLine status={st.status} message={st.message} />
            ) : (
              <p class="text-sm text-base-content/45">
                Désactivé — il n’apparaît plus à l’étape Morceaux et ne sera pas utilisé.
              </p>
            )}

            {on && studio.id === "acestep" && (
              <div class="space-y-3">
                <label class="form-control w-full max-w-xl">
                  <span class="mb-1 flex items-center justify-between text-sm">
                    URL ACE-Step
                    <a
                      href={studio.docs}
                      target="_blank"
                      rel="noreferrer"
                      class="inline-flex items-center gap-1 text-xs text-secondary hover:underline"
                    >
                      Docs <ExternalLink size={12} />
                    </a>
                  </span>
                  <input
                    type="url"
                    class="input input-bordered w-full bg-base-100 font-mono text-sm"
                    placeholder="http://127.0.0.1:3001"
                    value={keys.aceStepBaseUrl || ""}
                    onInput={(e) => onChange("aceStepBaseUrl", e.currentTarget.value)}
                    onBlur={() => void probeAce()}
                  />
                </label>
                {st.status === "ok" && (
                  <AceStepModelsPanel
                    models={st.models}
                    activeModelId={st.activeModel}
                    preferredModelId={st.preferredModel || keys.aceStepPreferredModel}
                    gpu={st.gpu}
                    busyId={busyId}
                    disabled={st.status === "checking"}
                    error={actionError.acestep}
                    onUse={(id) => void runAceUse(id)}
                  />
                )}
              </div>
            )}

            {on && studio.id === "songgen" && (
              <div class="space-y-3">
                <label class="form-control w-full max-w-xl">
                  <span class="mb-1 flex items-center justify-between text-sm">
                    URL SongGeneration
                    <a
                      href={studio.docs}
                      target="_blank"
                      rel="noreferrer"
                      class="inline-flex items-center gap-1 text-xs text-secondary hover:underline"
                    >
                      Docs <ExternalLink size={12} />
                    </a>
                  </span>
                  <input
                    type="url"
                    class="input input-bordered w-full bg-base-100 font-mono text-sm"
                    placeholder="http://127.0.0.1:7860"
                    value={keys.songGenBaseUrl || ""}
                    onInput={(e) => onChange("songGenBaseUrl", e.currentTarget.value)}
                    onBlur={() => void probeSong()}
                  />
                </label>
                {st.status === "ok" && (
                  <SongGenModelsPanel
                    models={st.models}
                    pickedModelId={st.pickedModel}
                    preferredModelId={st.preferredModel || keys.songGenPreferredModel}
                    gpu={st.gpu}
                    busyId={busyId}
                    disabled={st.status === "checking"}
                    error={actionError.songgen}
                    onDownload={(id) => void runSongAction(id, "download")}
                    onCancelDownload={(id) => void runSongAction(id, "cancel")}
                    onDelete={(id) => void runSongAction(id, "delete")}
                    onUse={(id) => void runSongAction(id, "use")}
                  />
                )}
              </div>
            )}

            {on && studio.id === "replicate" && (
              <label class="form-control w-full max-w-xl">
                <span class="mb-1 flex items-center justify-between text-sm">
                  Token Replicate
                  <a
                    href={studio.docs}
                    target="_blank"
                    rel="noreferrer"
                    class="inline-flex items-center gap-1 text-xs text-secondary hover:underline"
                  >
                    Obtenir <ExternalLink size={12} />
                  </a>
                </span>
                <input
                  type="password"
                  autocomplete="off"
                  class="input input-bordered w-full bg-base-100 font-mono text-sm"
                  placeholder="r8_..."
                  value={keys.replicateApiToken || ""}
                  onInput={(e) => onChange("replicateApiToken", e.currentTarget.value)}
                  onBlur={() => void probeMini()}
                />
                <span class="mt-1 text-xs text-base-content/45">
                  Facturé à l’usage. Utile aussi pour les jaquettes Flux et les clips Seedance.
                </span>
              </label>
            )}
          </article>
        );
      })}
    </div>
  );
}
