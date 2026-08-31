import { useEffect, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import {
  AudioLines,
  Disc3,
  Copy,
  KeyRound,
  Link2,
  Upload,
  ExternalLink,
  RotateCcw,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Trash2,
  Music2,
  SlidersHorizontal,
  User,
  Users,
  Radio,
  Save,
  FileAudio,
  ScrollText,
  Pencil,
  X,
} from "lucide-preact";
import { loadKeys, saveKeysAsync, ensureKeysHydrated, isStudioEnabled } from "../../lib/keys.js";
import { persistAudioRemote, playableAudioSrc } from "../../lib/audioResolve.js";
import { api } from "../../lib/apiClient.js";
import MusicArrangePanel from "../MusicArrangePanel.jsx";
import FeatArtistPicker from "../FeatArtistPicker.jsx";
import SongGenModelsPanel from "../SongGenModelsPanel.jsx";
import AceStepModelsPanel from "../AceStepModelsPanel.jsx";
import StudioGpuMeter from "../StudioGpuMeter.jsx";
import StyleTrackPicker from "../StyleTrackPicker.jsx";
import { normalizeMusicArrange, musicArrangeFromStyleLock, isDefaultMusicArrange } from "../../lib/musicArrange.js";
import { buildSunoPrompt } from "../../lib/sunoPrompt.js";
import {
  confirmDeleteProject,
  isTrackAudioFinal,
  isPlaceholderTitle,
  titleFromAudioFileName,
  isSongGenNativeLanguage,
  languageLabel,
  artistEditHref,
  artistHubHref,
} from "../../lib/studio.js";
import { resolveArtistGender } from "../../lib/artistGender.js";
import VersionPicker from "../VersionPicker.jsx";

function songGenUrlFromKeys(keys) {
  return String(keys?.songGenBaseUrl || "")
    .trim()
    .replace(/\/+$/, "") || "http://127.0.0.1:7860";
}

function aceStepUrlFromKeys(keys) {
  return String(keys?.aceStepBaseUrl || "")
    .trim()
    .replace(/\/+$/, "") || "http://127.0.0.1:3001";
}

function normalizeMusicProvider(value) {
  const v = String(value || "").trim();
  return v === "songgen" || v === "acestep" ? v : "replicate";
}

const AUDIO_FILE_ACCEPT = "audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.webm";

function StepModal({ open, title, onClose, children, wide = false }) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <dialog class="modal modal-open z-[100]" open>
      <div class={`modal-box ${wide ? "max-w-3xl" : "max-w-xl"}`}>
        <div class="mb-4 flex items-start justify-between gap-3">
          <h3 class="font-display text-lg font-semibold leading-snug">{title}</h3>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-circle shrink-0"
            aria-label="Fermer"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
        onSubmit={(e) => {
          e.preventDefault();
          onClose();
        }}
      >
        <button type="submit">close</button>
      </form>
    </dialog>,
    document.body,
  );
}

function styleArtistPickFromArtist(artist) {
  if (artist?.styleArtistPick?.id) return artist.styleArtistPick;
  const lock = artist?.styleLock;
  if (lock?.sourceId && lock.source !== "multi") {
    return {
      source: lock.source,
      id: String(lock.sourceId),
      name: artist.styleArtist || lock.matchedName,
      genres: lock.genres || [],
    };
  }
  const ref = lock?.refs?.[0];
  if (ref?.source && ref.sourceId) {
    return {
      source: ref.source,
      id: String(ref.sourceId),
      name: ref.matchedName,
      genres: ref.genres || [],
    };
  }
  return null;
}

export default function TracksStep({
  track,
  versions = [],
  activeId = null,
  lyrics,
  artist,
  featArtist = null,
  catalogArtists = [],
  loading,
  progress = null,
  musicArrange = null,
  projectId,
  distrokid,
  onGenerate,
  onGeneratePreview,
  onCancelGenerate,
  onAttachAudio,
  onAcceptTrackPreview,
  onRejectTrackPreview,
  onOpenSettings,
  onMusicArrangeChange,
  onFeatArtistChange,
  onApplyStyleTrack,
  onDeleteProject,
  onSelectVersion,
  onDeleteVersion,
  onRenameTrack,
}) {
  const [musicProvider, setMusicProvider] = useState("replicate");
  const [songGenUrl, setSongGenUrl] = useState("http://127.0.0.1:7860");
  const [aceStepUrl, setAceStepUrl] = useState("http://127.0.0.1:3001");
  const [hasReplicateToken, setHasReplicateToken] = useState(false);
  const [hasOnce, setHasOnce] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [keysHydrated, setKeysHydrated] = useState(false);
  const [probeStatus, setProbeStatus] = useState("idle"); // idle | checking | ok | error
  const [probeMessage, setProbeMessage] = useState("");
  const [songGenReadyFlag, setSongGenReadyFlag] = useState(null);
  const [songGenModels, setSongGenModels] = useState([]);
  const [pickedModelId, setPickedModelId] = useState(null);
  const [preferredModelId, setPreferredModelId] = useState(null);
  const [songGenGpu, setSongGenGpu] = useState(null);
  const [modelBusyId, setModelBusyId] = useState(null);
  const [modelActionError, setModelActionError] = useState("");
  const [audioUrlInput, setAudioUrlInput] = useState("");
  const [importError, setImportError] = useState("");
  const [onceReleaseId, setOnceReleaseId] = useState("");
  const [onceBusy, setOnceBusy] = useState(false);
  const [onceHint, setOnceHint] = useState("");
  const [importTitle, setImportTitle] = useState("");
  const [draftTitle, setDraftTitle] = useState(track?.title || "");
  const [styleTrackPick, setStyleTrackPick] = useState(() => {
    const st = artist?.styleLock?.seedTrack;
    if (st?.source && st?.sourceId) {
      return {
        source: st.source,
        id: String(st.sourceId),
        name: st.title,
        artistName: st.artistName || "",
        album: st.album || "",
        image: st.image || null,
        url: st.url || null,
        previewUrl: st.previewUrl || null,
      };
    }
    return null;
  });
  const [styleTrackBusy, setStyleTrackBusy] = useState(false);
  const [modal, setModal] = useState(null); // ref | arrange | profile | feat | provider | once | suno
  const onceFileRef = useRef(null);
  const importFileRef = useRef(null);
  const probeSeq = useRef(0);
  const lastArrangeLockKey = useRef("");
  const downloadPollRef = useRef(null);

  function closeModal() {
    setModal(null);
  }

  function existingSongTitle() {
    for (const t of [track?.title, lyrics?.title]) {
      if (!isPlaceholderTitle(t)) return String(t).trim();
    }
    return "";
  }

  function resolvedImportTitle(fileName) {
    const typed = String(importTitle || "").trim();
    if (typed) return typed;
    const existing = existingSongTitle();
    if (existing) return existing;
    return titleFromAudioFileName(fileName);
  }

  function openImportModal() {
    setImportTitle(existingSongTitle());
    setModal("once");
  }

  useEffect(() => {
    setDraftTitle(track?.title || "");
  }, [track?.id, track?.title]);

  function commitDraftTitle() {
    const next = String(draftTitle || "").trim();
    if (!next) {
      setDraftTitle(track?.title || "");
      return;
    }
    if (next === String(track?.title || "").trim()) return;
    onRenameTrack?.(next);
  }

  const hasAceStep = musicProvider === "acestep" && isStudioEnabled(loadKeys(), "acestep");
  const hasSongGen = musicProvider === "songgen" && isStudioEnabled(loadKeys(), "songgen");
  const aceOffered = isStudioEnabled(loadKeys(), "acestep");
  const songOffered = isStudioEnabled(loadKeys(), "songgen");
  const miniOffered = isStudioEnabled(loadKeys(), "replicate");
  const hasReplicate = musicProvider === "replicate" && hasReplicateToken && miniOffered;
  const hasLocalStudio = hasAceStep || hasSongGen;
  const trackLang = String(lyrics?.language || artist?.language || "fr").slice(0, 2);
  const songGenModel = loadKeys().songGenPreferredModel || "songgeneration_large";
  const songGenLangFallback = hasSongGen && !isSongGenNativeLanguage(trackLang, songGenModel);
  const resolvedVoice = resolveArtistGender(artist);
  const voiceLabel = resolvedVoice?.label || null;

  const inferredArrange = artist?.styleLock
    ? musicArrangeFromStyleLock(artist.styleLock)
    : null;

  const styleLockKey = (() => {
    const lock = artist?.styleLock;
    if (!lock) return "";
    const seed = lock.seedTrack;
    return [
      lock.source || "",
      lock.sourceId || "",
      seed?.source || "",
      seed?.sourceId || "",
      seed?.title || "",
      lock.bpm ?? "",
      (lock.instruments || []).join(","),
    ].join("|");
  })();

  // Pré-sélection arrangement depuis artiste / titre de référence (comme les styles)
  useEffect(() => {
    if (!styleLockKey || !inferredArrange || !onMusicArrangeChange) return;
    const current = normalizeMusicArrange(musicArrange);
    const lockChanged = lastArrangeLockKey.current !== styleLockKey;
    const shouldApply =
      !musicArrange ||
      isDefaultMusicArrange(current) ||
      current.source === "ref" ||
      (lockChanged && current.source !== "manual");

    if (!shouldApply) {
      lastArrangeLockKey.current = styleLockKey;
      return;
    }

    const next = normalizeMusicArrange({ ...inferredArrange, source: "ref" });
    const same =
      current.leadInstrument === next.leadInstrument &&
      current.choir === next.choir &&
      current.drums === next.drums &&
      current.density === next.density &&
      current.bpm === next.bpm &&
      current.notes === next.notes &&
      [...current.features].sort().join("|") === [...next.features].sort().join("|") &&
      current.source === "ref";

    lastArrangeLockKey.current = styleLockKey;
    if (!same) onMusicArrangeChange(next);
  }, [styleLockKey]);

  function refreshFromKeys() {
    const keys = loadKeys();
    const provider = normalizeMusicProvider(keys.musicProvider);
    setMusicProvider(provider);
    setSongGenUrl(songGenUrlFromKeys(keys));
    setAceStepUrl(aceStepUrlFromKeys(keys));
    setHasReplicateToken(Boolean(keys.replicateApiToken?.trim()));
    setHasOnce(Boolean(keys.onceApiToken?.trim()));
    return { keys, provider };
  }

  function stopDownloadPoll() {
    if (downloadPollRef.current) {
      clearInterval(downloadPollRef.current);
      downloadPollRef.current = null;
    }
  }

  function applyProbeResult(res) {
    if (res?.base) setSongGenUrl(String(res.base).replace(/\/+$/, ""));
    if (Array.isArray(res?.models)) setSongGenModels(res.models);
    if (res?.pickedModel) setPickedModelId(res.pickedModel);
    else if (res?.defaultModel) setPickedModelId(res.defaultModel);
    if (res?.preferredModel != null) setPreferredModelId(res.preferredModel || null);
    if (res?.gpu) setSongGenGpu(res.gpu);
    if (typeof res?.hasReadyModel === "boolean") setSongGenReadyFlag(res.hasReadyModel);
    if (res?.ok) {
      setProbeStatus("ok");
      setProbeMessage(res.message || "Joignable");
    } else {
      setProbeStatus("error");
      setProbeMessage(res?.message || "Injoignable");
      setSongGenReadyFlag(false);
    }
    return res;
  }

  function anyDownloading(models) {
    return (models || []).some((m) => m?.status === "downloading");
  }

  function maybeStartDownloadPoll(models) {
    stopDownloadPoll();
    if (!anyDownloading(models)) return;
    downloadPollRef.current = setInterval(() => {
      void probeSongGen({ quiet: true });
    }, 4000);
  }

  async function probeAceStep({ quiet = false } = {}) {
    const seq = ++probeSeq.current;
    if (!quiet) {
      setProbeStatus("checking");
      setProbeMessage("Vérification ACE-Step depuis le serveur Astro…");
      setModelActionError("");
    }
    try {
      const res = await api.probeAceStep();
      if (seq !== probeSeq.current) return;
      applyProbeResult(res);
      if (res?.activeModel) setPickedModelId(res.activeModel);
      setModelBusyId(null);
    } catch (e) {
      if (seq !== probeSeq.current) return;
      setProbeStatus("error");
      setProbeMessage(e.message || "Test impossible");
      setSongGenReadyFlag(false);
    }
  }

  async function runAceModelAction(modelId) {
    if (!modelId || modelBusyId || loading) return;
    setModelBusyId(modelId);
    setModelActionError("");
    try {
      await ensureKeysHydrated();
      const keys = loadKeys();
      await saveKeysAsync({ ...keys, aceStepPreferredModel: modelId });
      setPreferredModelId(modelId);
      const res = await api.switchAceStepModel(modelId);
      if (!res?.ok) {
        setModelActionError(res?.message || "Changement de modèle impossible");
        setModelBusyId(null);
        return;
      }
      if (res.probe) applyProbeResult(res.probe);
      else await probeAceStep({ quiet: true });
      setModelBusyId(null);
    } catch (e) {
      setModelActionError(e.message || "Changement de modèle impossible");
      setModelBusyId(null);
    }
  }

  async function probeSongGen({ quiet = false } = {}) {
    const seq = ++probeSeq.current;
    if (!quiet) {
      setProbeStatus("checking");
      setProbeMessage("Vérification depuis le serveur Astro…");
      setModelActionError("");
    }
    try {
      const res = await api.probeSongGen();
      if (seq !== probeSeq.current) return;
      applyProbeResult(res);
      const list = res?.models || [];
      maybeStartDownloadPoll(list);
      if (!anyDownloading(list)) setModelBusyId(null);
    } catch (e) {
      if (seq !== probeSeq.current) return;
      setProbeStatus("error");
      setProbeMessage(e.message || "Test impossible");
      setSongGenReadyFlag(false);
      stopDownloadPoll();
    }
  }

  async function runModelAction(modelId, action) {
    if ((!modelId && action !== "unload") || modelBusyId || loading) return;
    setModelBusyId(modelId || "__unload__");
    setModelActionError("");
    try {
      let res;
      if (action === "download") res = await api.downloadSongGenModel(modelId);
      else if (action === "cancel") res = await api.cancelSongGenDownload(modelId);
      else if (action === "delete") res = await api.deleteSongGenModel(modelId);
      else if (action === "use") {
        await ensureKeysHydrated();
        const keys = loadKeys();
        await saveKeysAsync({ ...keys, songGenPreferredModel: modelId });
        setPreferredModelId(modelId);
        res = await api.loadSongGenModel(modelId);
        if (res?.hotSwapIssue && res?.message) {
          setModelActionError(res.message);
        }
      } else throw new Error("Action inconnue");

      if (!res?.ok) {
        setModelActionError(res?.message || "Action impossible");
        setModelBusyId(null);
        return;
      }
      if (res.probe) applyProbeResult(res.probe);
      else await probeSongGen({ quiet: true });
      maybeStartDownloadPoll(res.probe?.models || songGenModels);
      if (action !== "download" || res.alreadyReady) setModelBusyId(null);
      else if (!anyDownloading(res.probe?.models || [])) setModelBusyId(null);
    } catch (e) {
      setModelActionError(e.message || "Action impossible");
      setModelBusyId(null);
      stopDownloadPoll();
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureKeysHydrated();
      if (cancelled) return;
      const { provider } = refreshFromKeys();
      setKeysHydrated(true);
      if (provider === "songgen") void probeSongGen();
      else if (provider === "acestep") void probeAceStep();
      else {
        setProbeStatus("idle");
        setProbeMessage("");
        setSongGenModels([]);
        setSongGenReadyFlag(null);
        setPickedModelId(null);
      }
    })();
    return () => {
      cancelled = true;
      stopDownloadPoll();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFocus = () => {
      void ensureKeysHydrated().then(() => {
        refreshFromKeys();
        setKeysHydrated(true);
      });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    const id = distrokid?.releaseId || "";
    if (id) setOnceReleaseId(id);
  }, [distrokid?.releaseId]);

  async function switchMusicProvider(next) {
    if (next === musicProvider || providerBusy || loading || !keysHydrated) return;
    if (!isStudioEnabled(loadKeys(), next)) return;
    setProviderBusy(true);
    setImportError("");
    try {
      await ensureKeysHydrated();
      const keys = loadKeys();
      const { keys: saved } = await saveKeysAsync({ ...keys, musicProvider: next });
      setMusicProvider(next);
      setSongGenUrl(songGenUrlFromKeys(saved));
      setAceStepUrl(aceStepUrlFromKeys(saved));
      setHasReplicateToken(Boolean(saved.replicateApiToken?.trim()));
      setSongGenModels([]);
      setPickedModelId(null);
      setPreferredModelId(null);
      setSongGenGpu(null);
      if (next === "songgen") await probeSongGen();
      else if (next === "acestep") await probeAceStep();
      else {
        probeSeq.current += 1;
        setProbeStatus("idle");
        setProbeMessage("");
        setSongGenReadyFlag(null);
      }
    } catch (e) {
      setImportError(e.message || "Impossible d’enregistrer le provider");
    } finally {
      setProviderBusy(false);
    }
  }

  const liveSunoPrompt =
    lyrics && (artist || track)
      ? buildSunoPrompt({
          lyrics,
          artist,
          styleLock: artist?.styleLock,
          bpmGuess: track?.bpm,
          musicArrange,
        })
      : track?.sunoPrompt || "";

  async function copyPrompt() {
    const text = liveSunoPrompt;
    if (!text) return;
    await navigator.clipboard.writeText(text);
  }

  async function attachUrl() {
    setImportError("");
    const url = audioUrlInput.trim();
    if (!url) {
      setImportError("Colle une URL audio (mp3/wav) ou un lien Suno.");
      return;
    }
    if (!/^https?:\/\//i.test(url) && !url.startsWith("blob:") && !url.startsWith("data:")) {
      setImportError("URL invalide — doit commencer par https://");
      return;
    }
    try {
      const saved = await persistAudioRemote(url, projectId || "anon");
      onAttachAudio?.(saved.audioUrl || url, {
        provider: "import-url",
        s3Key: saved.s3Key,
        persisted: Boolean(saved.persisted || saved.reused),
        title: resolvedImportTitle(),
      });
    } catch (e) {
      onAttachAudio?.(url, {
        provider: "import-url",
        warning: e.message,
        title: resolvedImportTitle(),
      });
      setImportError(
        `${e.message} — audio attaché en temporaire ; configure S3 pour le garder.`,
      );
    }
  }

  function isAudioFile(file) {
    const type = String(file?.type || "").toLowerCase();
    if (type.startsWith("audio/")) return true;
    return /\.(mp3|wav|flac|m4a|aac|ogg|opus|webm)$/i.test(file?.name || "");
  }

  async function importLocalFile(file) {
    if (!file) return;
    if (!isAudioFile(file)) {
      setImportError("Choisis un fichier audio (mp3, wav, flac, m4a…).");
      return;
    }
    setImportError("");
    setOnceHint("");
    setOnceBusy(true);
    try {
      const form = new FormData();
      form.append("audio", file, file.name);
      form.append("projectId", projectId || "anon");
      form.append("mimeType", file.type || "");
      form.append("fileName", file.name);
      const res = await fetch("/api/audio/persist", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload audio impossible");
      onAttachAudio?.(data.audioUrl, {
        provider: "import-file",
        fileName: file.name,
        s3Key: data.s3Key,
        persisted: true,
        title: resolvedImportTitle(file.name),
        note: `Audio importé · ${file.name}`,
      });
      setOnceHint(`Morceau importé (${file.name}).`);
      closeModal();
    } catch (err) {
      const reader = new FileReader();
      reader.onload = () => {
        onAttachAudio?.(String(reader.result), {
          provider: "import-file",
          fileName: file.name,
          warning: err.message,
          title: resolvedImportTitle(file.name),
        });
      };
      reader.onerror = () => setImportError("Lecture du fichier impossible");
      reader.readAsDataURL(file);
      setImportError(`${err.message} — import local temporaire.`);
    } finally {
      setOnceBusy(false);
    }
  }

  async function onFileChange(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    await importLocalFile(file);
  }

  function applyOnceRestore(data) {
    onAttachAudio?.(data.audioUrl, {
      provider: "once-original",
      s3Key: data.s3Key,
      persisted: true,
      releaseId: data.releaseId,
      title: resolvedImportTitle() || data.title,
      note: `Audio ORIGINAL ONCE (${data.releaseId}) · ${data.via}`,
    });
    setOnceHint(
      "Original ONCE restauré sur S3 — c’est le master publié, pas une régénération MiniMax.",
    );
    setImportError("");
  }

  async function tryOnceApiRestore() {
    setOnceBusy(true);
    setOnceHint("");
    setImportError("");
    try {
      const keys = loadKeys();
      if (!keys.onceApiToken?.trim()) {
        setImportError("Token ONCE manquant — Paramètres.");
        return;
      }
      const releaseId = onceReleaseId.trim();
      if (!releaseId) {
        setImportError("Indique l’ID de release ONCE.");
        return;
      }
      if (!projectId) {
        setImportError("Projet non sauvegardé — recharge depuis Historique.");
        return;
      }
      const res = await fetch("/api/audio/from-once", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys, releaseId, projectId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.code === "ONCE_FILE_AUTH" || res.status === 409) {
        setOnceHint(
          data.hint ||
            "ONCE bloque le téléchargement API. Télécharge le WAV sur la page release (connecté), puis importe-le ci-dessous.",
        );
        onceFileRef.current?.click();
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || "Restore ONCE impossible");
      applyOnceRestore(data);
    } catch (e) {
      setImportError(e.message || "Restore ONCE échoué");
    } finally {
      setOnceBusy(false);
    }
  }

  async function onOnceFileChange(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    const releaseId = onceReleaseId.trim();
    if (!releaseId) {
      await importLocalFile(file);
      return;
    }
    setOnceBusy(true);
    setImportError("");
    setOnceHint("");
    try {
      if (!projectId) throw new Error("Projet non sauvegardé.");
      const keys = loadKeys();
      const form = new FormData();
      form.append("audio", file, file.name);
      form.append("releaseId", releaseId);
      form.append("projectId", projectId);
      form.append("mimeType", file.type || "");
      form.append("fileName", file.name);
      form.append("keys", JSON.stringify(keys));
      const res = await fetch("/api/audio/from-once", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Import audio impossible");
      applyOnceRestore(data);
    } catch (err) {
      setImportError(err.message || "Import audio échoué");
    } finally {
      setOnceBusy(false);
    }
  }

  async function resaveAudio() {
    if (!track?.audioUrl) return;
    setImportError("");
    setOnceHint("");
    setOnceBusy(true);
    try {
      const saved = await persistAudioRemote(track.audioUrl, projectId || "anon", {
        force: true,
      });
      if (saved?.audioUrl || saved?.s3Key) {
        let s3Key = saved.s3Key || track.audioS3Key;
        if (!s3Key) {
          try {
            const path = decodeURIComponent(
              new URL(saved.audioUrl || track.audioUrl).pathname.replace(/^\//, ""),
            );
            if (/^(audio|clips)\//i.test(path)) s3Key = path;
          } catch {
            /* ignore */
          }
        }
        onAttachAudio?.(saved.audioUrl || track.audioUrl, {
          provider: track.provider || "songgeneration-studio",
          s3Key,
          persisted: true,
          note: saved.reused
            ? "Audio déjà sur S3 — lecture via clé."
            : `Audio re-persisté (${saved.mimeType || "audio"}).`,
        });
        setOnceHint("Audio OK — le lecteur devrait afficher la durée.");
      }
    } catch (e) {
      setImportError(e.message || "Re-persistance impossible");
    } finally {
      setOnceBusy(false);
    }
  }

  const hasAudio = Boolean(track?.audioUrl);
  const previewReady =
    track?.status === "preview-ready" || Boolean(track?.isPreview && track?.audioUrl);
  const audioReady = isTrackAudioFinal(track);
  const isOnceOriginal = track?.provider === "once-original";
  const canGenerateAudio = hasAceStep || hasSongGen || hasReplicate;
  const artistSlug = artist?.slug;
  const songGenHasReady =
    songGenReadyFlag === true || songGenModels.some((m) => m.status === "ready");
  const hasLyricsText = Boolean(String(lyrics?.text || "").trim());
  const modelsNotReady =
    hasSongGen && probeStatus === "ok" && songGenReadyFlag === false && !songGenHasReady;
  const genDisabled =
    loading ||
    !hasLyricsText ||
    (hasLocalStudio && probeStatus === "error") ||
    modelsNotReady ||
    (hasSongGen && !voiceLabel) ||
    (songGenLangFallback && !hasReplicateToken);
  const onceDashboard =
    distrokid?.dashboardUrl ||
    (onceReleaseId.trim()
      ? `https://beta.once.app/releases/${onceReleaseId.trim()}`
      : "https://beta.once.app/");

  const providerLabel = hasAceStep ? "ACE-Step" : hasSongGen ? "SongGeneration" : "MiniMax";

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Créer les morceaux</h2>
        {versions.length > 0 && (
          <p class="max-w-xl text-sm text-base-content/60">
            Chaque génération ou import ajoute une version — l’active est utilisée pour jaquette, ONCE et clips.
          </p>
        )}
      </header>

      {versions.length > 0 && (
        <div class="space-y-2">
          <p class="text-xs uppercase tracking-wider text-base-content/45">
            Versions ({versions.length})
          </p>
          <VersionPicker
            versions={versions}
            activeId={activeId}
            onSelect={onSelectVersion}
            onDelete={onDeleteVersion}
            labelFor={(v, i) => {
              const kind =
                v.isPreview || v.status === "preview-ready"
                  ? "Extrait"
                  : v.audioUrl
                    ? "Complet"
                    : "Brief";
              const title = v.title || lyrics?.title || `Morceau ${i + 1}`;
              return `${title} · ${kind}${v.provider ? ` · ${v.provider}` : ""}`;
            }}
          />
        </div>
      )}

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-outline btn-sm gap-1.5"
          onClick={() => setModal("ref")}
        >
          <Music2 size={14} />
          Titre de référence
        </button>
        {(hasAceStep || hasSongGen || hasReplicate) && (
          <button
            type="button"
            class="btn btn-outline btn-sm gap-1.5"
            onClick={() => setModal("arrange")}
          >
            <SlidersHorizontal size={14} />
            Arrangement
          </button>
        )}
        {artist && (
          <button
            type="button"
            class="btn btn-outline btn-sm gap-1.5"
            onClick={() => setModal("profile")}
          >
            <User size={14} />
            Profil utilisé
            {!voiceLabel ? <span class="badge badge-warning badge-xs">voix</span> : null}
          </button>
        )}
        {artist && (
          <button
            type="button"
            class={`btn btn-sm gap-1.5 ${featArtist?.name ? "btn-primary" : "btn-outline"}`}
            onClick={() => setModal("feat")}
          >
            <Users size={14} />
            Duo / Feat.
            {featArtist?.name ? (
              <span class="badge badge-ghost badge-xs max-w-[7rem] truncate">
                {featArtist.name}
              </span>
            ) : null}
          </button>
        )}
        <button
          type="button"
          class={`btn btn-sm gap-1.5 ${
            !canGenerateAudio && keysHydrated ? "btn-warning" : "btn-outline"
          }`}
          onClick={() => setModal("provider")}
        >
          <Radio size={14} />
          Provider audio
          <span class="opacity-70">· {providerLabel}</span>
        </button>
        <button
          type="button"
          class="btn btn-outline btn-sm gap-1.5"
          onClick={() => setModal("suno")}
        >
          <ScrollText size={14} />
          Prompt Suno
        </button>
        <button
          type="button"
          class="btn btn-outline btn-sm gap-1.5"
          onClick={openImportModal}
        >
          <FileAudio size={14} />
          Importer un morceau
          {isOnceOriginal ? <span class="badge badge-success badge-xs">ONCE</span> : null}
        </button>
        {track?.audioUrl && (
          <button
            type="button"
            class="btn btn-outline btn-sm gap-1.5"
            disabled={loading || onceBusy}
            onClick={() => void resaveAudio()}
          >
            {onceBusy ? (
              <span class="loading loading-spinner loading-xs" />
            ) : (
              <Save size={14} />
            )}
            Re-sauver
          </button>
        )}
      </div>

      {!canGenerateAudio && !hasLocalStudio && keysHydrated && (
        <div class="border border-warning/40 bg-warning/10 p-4">
          <p class="font-medium text-warning">Aucun provider audio prêt</p>
          <p class="mt-1 text-sm text-base-content/70">
            Ouvre Provider audio pour choisir ACE-Step, SongGeneration ou un token Replicate, sinon
            importe un fichier audio (mp3, wav, flac).
          </p>
        </div>
      )}

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-secondary gap-2"
          disabled={genDisabled || !canGenerateAudio}
          onClick={() => onGeneratePreview?.()}
          title={
            !hasLyricsText
              ? "Génère d’abord les paroles (étape 3) — le profil artiste ne suffit pas"
              : hasSongGen && !voiceLabel
                ? "Voix / sexe manquant sur ce projet — ouvre Profil utilisé"
                : modelsNotReady
                  ? "Aucun modèle SongGen prêt — ouvre Provider audio"
                  : hasAceStep
                    ? "Brouillon court ACE-Step (~30 s)"
                    : hasSongGen
                      ? "Brouillon court (intro + couplet + refrain) — moins de GPU"
                      : "Brouillon avec paroles tronquées — MiniMax reste cloud"
          }
        >
          {loading ? <span class="loading loading-spinner loading-sm" /> : <AudioLines size={18} />}
          {loading
            ? typeof progress?.percent === "number"
              ? `${progress.percent}% — ${progress.message || "Extrait…"}`
              : "Génération extrait…"
            : "Écouter un extrait"}
        </button>
        <button
          type="button"
          class="btn btn-primary gap-2"
          disabled={genDisabled}
          onClick={onGenerate}
          title={
            !hasLyricsText
              ? "Génère d’abord les paroles (étape 3) — le profil artiste ne suffit pas"
              : hasSongGen && !voiceLabel
                ? "Voix / sexe manquant sur ce projet — ouvre Profil utilisé"
                : modelsNotReady
                  ? "Aucun modèle SongGen prêt — ouvre Provider audio et télécharge Large"
                  : hasAceStep && probeStatus === "error"
                    ? "ACE-Step injoignable — corrige l’URL ou Retester"
                    : hasSongGen && probeStatus === "error"
                      ? "SongGeneration injoignable — corrige l’URL ou Retester"
                      : hasAceStep
                        ? `Morceau complet via ACE-Step @ ${aceStepUrl}`
                        : hasSongGen
                          ? `Morceau complet via SongGeneration @ ${songGenUrl}`
                          : !hasReplicate
                            ? "Sans provider → brief Suno uniquement"
                            : "Morceau complet via MiniMax Music 2.6"
          }
        >
          {loading ? <span class="loading loading-spinner loading-sm" /> : <Disc3 size={18} />}
          {loading
            ? "Génération en cours…"
            : canGenerateAudio
              ? versions.length
                ? "Nouvelle version complète"
                : "Générer le morceau complet"
              : "Générer le brief (sans audio)"}
        </button>
        {loading && onCancelGenerate ? (
          <button
            type="button"
            class="btn btn-outline btn-error gap-2"
            onClick={() => onCancelGenerate()}
          >
            <XCircle size={18} />
            Annuler
          </button>
        ) : null}
      </div>

      {loading ? (
        <p class="text-xs text-base-content/50">
          Tu peux changer de page : la génération continue dans Tâches.
        </p>
      ) : null}

      {loading && typeof progress?.percent === "number" && (
        <div class="space-y-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5" aria-live="polite">
          <div class="h-2 overflow-hidden rounded-full bg-base-300">
            <div
              class="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${Math.max(4, Math.min(100, progress.percent))}%` }}
            />
          </div>
          <p class="text-xs text-base-content/70">
            {[progress.modelLabel || progress.model, progress.message]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <StudioGpuMeter gpu={progress.gpu} />
        </div>
      )}
      {!hasLyricsText && (
        <p class="text-sm text-warning">
          Génère d’abord les paroles à l’étape 3. Le profil artiste (style, voix, références) est
          déjà persisté — il ne débloque pas l’audio tant qu’il n’y a pas de texte.
        </p>
      )}
      {hasSongGen && !voiceLabel && hasLyricsText && (
        <p class="text-sm text-warning">
          Voix SongGen introuvable sur ce projet. Ouvre « Profil utilisé », ou retourne à l’étape
          Artiste pour choisir Homme / Femme.
        </p>
      )}
      {songGenLangFallback && (
        <p class="text-sm text-warning">
          {languageLabel(trackLang)} : SongGen Large ne chante que l’anglais et le chinois.
          {hasReplicateToken
            ? " L’audio passera automatiquement par MiniMax."
            : " Ajoute un token Replicate (Provider audio) pour MiniMax, ou passe les paroles en anglais."}
        </p>
      )}
      {modelsNotReady && (
        <p class="text-sm text-warning">
          Studio joignable, mais aucun modèle n’est prêt. Ouvre Provider audio et télécharge Large
          (~20 Go), puis clique Utiliser.
        </p>
      )}
      {hasLocalStudio && probeStatus === "error" && (
        <p class="text-sm text-error">
          {probeMessage ||
            "Studio injoignable depuis Astro — lance Pinokio / vérifie l’URL (Provider audio)."}
        </p>
      )}
      {onceHint && <p class="text-xs text-success">{onceHint}</p>}
      {importError && <p class="text-xs text-error">{importError}</p>}

      {track && (
        <div class="animate-rise space-y-4 border-t border-base-content/10 pt-5">
          <div class="flex flex-wrap items-center gap-3">
            <Disc3 size={22} class={`text-primary ${hasAudio ? "animate-pulse-soft" : ""}`} />
            <div class="min-w-0 flex-1">
              <label class="flex max-w-md items-center gap-2">
                <span class="sr-only">Titre du morceau</span>
                <Pencil size={14} class="shrink-0 text-base-content/40" />
                <input
                  class="input input-ghost h-auto min-h-0 w-full px-0 font-display text-xl font-semibold"
                  value={draftTitle}
                  placeholder="Titre du morceau"
                  onInput={(e) => setDraftTitle(e.currentTarget.value)}
                  onBlur={commitDraftTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                />
              </label>
              {isPlaceholderTitle(track.title) ? (
                <p class="text-xs text-warning">Donne un titre à ce morceau — il s’appelle encore Untitled.</p>
              ) : null}
              <p class="text-sm text-base-content/60">
                {track.artist} · {track.style} · {track.key} · {track.bpm} BPM · {track.duration} ·{" "}
                {track.provider}
              </p>
              <p
                class={`text-xs ${
                  previewReady ? "text-warning" : audioReady ? "text-success" : "text-warning"
                }`}
              >
                {previewReady
                  ? "Extrait prêt — brouillon à valider avant le complet"
                  : audioReady
                    ? "Audio prêt ✓"
                    : "Pas d’audio — importe un fichier ou génère un extrait / le complet"}
              </p>
            </div>
          </div>

          {audioReady && artistSlug && (
            <p class="text-sm text-base-content/60">
              Album : créer et gérer sur la{" "}
              <a
                class="link link-primary"
                href={`${artistHubHref(artistSlug)}#album`}
              >
                fiche artiste
              </a>
            </p>
          )}

          {projectId && onDeleteProject && (
            <button
              type="button"
              class="btn btn-ghost btn-sm gap-2 text-error"
              disabled={loading}
              onClick={() => {
                const label = track?.title || lyrics?.title || "ce morceau";
                if (
                  !confirmDeleteProject(label, {
                    status: distrokid?.status,
                    onceStatus: distrokid?.status,
                    provider: distrokid?.provider,
                    releaseId: distrokid?.releaseId,
                    distributed:
                      distrokid?.status === "submitted" || distrokid?.provider === "once",
                  })
                ) {
                  return;
                }
                onDeleteProject();
              }}
            >
              <Trash2 size={14} />
              Supprimer ce morceau
            </button>
          )}

          {previewReady && hasAudio ? (
            <div class="space-y-4 border border-warning/40 bg-warning/10 p-4">
              <div class="space-y-1">
                <h4 class="font-display text-lg font-semibold text-warning">
                  Extrait — brouillon indicatif
                </h4>
                <p class="text-sm text-base-content/75">
                  Vérifie le style / la voix / le groove. Si ça te convient, lance le{" "}
                  <strong>morceau complet</strong>.
                </p>
              </div>
              {(track.audioEphemeral || track.warning) && (
                <div class="border border-warning/40 bg-base-100/40 p-3 text-sm text-warning">
                  {track.warning || "Lien audio temporaire — valide vite ou réimporte."}
                </div>
              )}
              <audio
                key={`draft-${track.audioS3Key || track.audioUrl}`}
                controls
                class="w-full"
                src={playableAudioSrc(track.audioUrl, track.audioS3Key)}
                preload="auto"
                onError={() => {
                  setImportError("Lecture impossible — réessaie ou régénère l’extrait.");
                }}
              />
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="btn btn-primary gap-2"
                  disabled={loading}
                  onClick={() => onAcceptTrackPreview?.()}
                >
                  <CheckCircle2 size={16} />
                  Valider → générer le complet
                </button>
                <button
                  type="button"
                  class="btn btn-ghost gap-2 text-error"
                  disabled={loading}
                  onClick={() => {
                    if (
                      !confirm(
                        "Rejeter cet extrait ? Tu pourras en générer un autre ou passer au complet.",
                      )
                    ) {
                      return;
                    }
                    onRejectTrackPreview?.();
                  }}
                >
                  <XCircle size={16} />
                  Rejeter l’extrait
                </button>
              </div>
            </div>
          ) : audioReady ? (
            <>
              {(track.audioEphemeral || track.warning) && (
                <div class="border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                  {track.warning ||
                    "Ce lien audio est temporaire (Replicate ~1 h). Réimporte un mp3 ou vérifie S3."}
                </div>
              )}
              <div class="flex h-16 items-end gap-0.5">
                {(track.waveform || []).map((h, i) => (
                  <span
                    key={i}
                    class="flex-1 rounded-sm bg-primary/80"
                    style={{ height: `${h}%`, opacity: 0.45 + (i % 5) * 0.1 }}
                  />
                ))}
              </div>
              <audio
                key={track.audioS3Key || track.audioUrl}
                controls
                class="w-full"
                src={playableAudioSrc(track.audioUrl, track.audioS3Key)}
                preload="auto"
                onError={() => {
                  setImportError(
                    "Lecture impossible — clique « Re-sauver » puis réessaie (souvent URL SongGen expirée ou FLAC).",
                  );
                }}
              />
            </>
          ) : (
            <div class="space-y-3 border border-base-content/10 bg-base-200/50 p-4">
              <p class="text-sm font-medium">
                {track.assetMissingReason
                  ? "Audio perdu (lien expiré ou non sauvegardé) — réimporte un mp3"
                  : "Importer l’audio (fichier local, Suno, FLAC…)"}
              </p>
              <label class="form-control w-full">
                <span class="label-text mb-1 text-xs text-base-content/60">Titre du morceau</span>
                <input
                  class="input input-bordered input-sm w-full bg-base-100"
                  type="text"
                  placeholder="Ex. Dernier train"
                  value={importTitle}
                  onInput={(e) => setImportTitle(e.currentTarget.value)}
                />
              </label>
              <ol class="list-decimal space-y-1 pl-5 text-xs text-base-content/60">
                <li>
                  Ouvre{" "}
                  <button
                    type="button"
                    class="link link-primary"
                    onClick={() => setModal("suno")}
                  >
                    Prompt Suno
                  </button>{" "}
                  et copie-le
                </li>
                <li>
                  Génère sur{" "}
                  <a
                    class="link link-primary"
                    href="https://suno.com"
                    target="_blank"
                    rel="noreferrer"
                  >
                    suno.com
                  </a>
                </li>
                <li>Télécharge le fichier (mp3, wav, flac…), puis importe-le ici</li>
              </ol>

              <label class="btn btn-secondary btn-sm gap-2 cursor-pointer">
                <Upload size={14} />
                Importer un fichier audio
                <input
                  type="file"
                  accept={AUDIO_FILE_ACCEPT}
                  class="hidden"
                  onChange={onFileChange}
                />
              </label>

              <div class="flex flex-wrap gap-2">
                <input
                  class="input input-bordered input-sm min-w-[220px] flex-1 bg-base-100"
                  placeholder="https://… lien mp3 / wav / flac"
                  value={audioUrlInput}
                  onInput={(e) => setAudioUrlInput(e.currentTarget.value)}
                />
                <button type="button" class="btn btn-outline btn-sm gap-1" onClick={attachUrl}>
                  <Link2 size={14} /> Attacher URL
                </button>
              </div>
            </div>
          )}

          <p class="text-xs text-base-content/50">{track.note}</p>
          {track.warning && (
            <div class="border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              {track.warning}
            </div>
          )}
        </div>
      )}

      <StepModal
        open={modal === "ref"}
        title="Titre de référence pour ce morceau"
        onClose={closeModal}
        wide
      >
        <div class="space-y-3">
          <StyleTrackPicker
            pick={styleTrackPick}
            artistPick={styleArtistPickFromArtist(artist)}
            disabled={loading || styleTrackBusy}
            label="Titre de référence"
            hint="Optionnel — recale le style de CE titre (preview) avant de générer."
            onPickChange={(p) => setStyleTrackPick(p)}
          />
          {styleTrackPick?.id && onApplyStyleTrack && (
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled={loading || styleTrackBusy}
              onClick={async () => {
                setStyleTrackBusy(true);
                setImportError("");
                try {
                  await onApplyStyleTrack(styleTrackPick);
                } catch (e) {
                  setImportError(e.message || "Impossible d’appliquer ce titre");
                } finally {
                  setStyleTrackBusy(false);
                }
              }}
            >
              {styleTrackBusy ? <span class="loading loading-spinner loading-xs" /> : null}
              Appliquer ce titre au style
            </button>
          )}
          {artist?.styleLock?.seedTrack?.title && (
            <p class="text-xs text-success">
              Style calé sur « {artist.styleLock.seedTrack.title} »
              {artist.styleLock.seedTrack.artistName
                ? ` — ${artist.styleLock.seedTrack.artistName}`
                : ""}
              {artist.styleLock.audioListened ? " · preview écouté" : ""}
              {artist.styleLock.seedTrack?.previewUrl || artist.styleLock.previewUrl
                ? " · ACE recevra l’extrait en mode cover (son + groove)"
                : ""}
            </p>
          )}
        </div>
      </StepModal>

      <StepModal
        open={modal === "arrange"}
        title="Arrangement du morceau"
        onClose={closeModal}
        wide
      >
        <MusicArrangePanel
          embedded
          value={normalizeMusicArrange(musicArrange)}
          inferred={inferredArrange}
          disabled={loading}
          onChange={(next) => onMusicArrangeChange?.(next)}
          onApplyInferred={() => {
            if (!inferredArrange) return;
            onMusicArrangeChange?.(
              normalizeMusicArrange({ ...inferredArrange, source: "ref" }),
            );
          }}
        />
      </StepModal>

      <StepModal open={modal === "profile"} title="Profil utilisé" onClose={closeModal}>
        {artist ? (
          <div class="space-y-3 text-sm">
            <p>
              <span class="text-base-content/60">Artiste :</span>{" "}
              <span class="font-medium">{artist.name || "—"}</span>
            </p>
            <p>
              <span class="text-base-content/60">Style :</span>{" "}
              <span class="font-medium">
                {artist.genre || artist.genres?.join(" × ") || "—"}
              </span>
            </p>
            <p>
              <span class="text-base-content/60">Voix SongGen :</span>{" "}
              {voiceLabel ? (
                <span class="font-medium text-primary">{voiceLabel}</span>
              ) : (
                <span class="font-medium text-warning">non défini</span>
              )}
            </p>
            {featArtist?.name ? (
              <p>
                <span class="text-base-content/60">Feat. :</span>{" "}
                <span class="font-medium">{featArtist.name}</span>
                {featArtist.genre ? (
                  <span class="text-base-content/55"> · {featArtist.genre}</span>
                ) : null}
              </p>
            ) : null}
            {artist.voiceSample?.s3Key || artist.voiceSample?.url ? (
              <p class="text-success">Extrait vocal perso · indice de timbre uniquement</p>
            ) : null}
            {!voiceLabel && (
              <p class="text-xs text-warning">
                Ouvre{" "}
                <a class="link" href={artistEditHref(artist?.slug)}>
                  Modifier le profil
                </a>
                , choisis Homme/Femme, régénère, puis relance le morceau.
              </p>
            )}
          </div>
        ) : (
          <p class="text-sm text-base-content/60">Aucun profil artiste.</p>
        )}
      </StepModal>

      <StepModal open={modal === "feat"} title="Duo / Feat." onClose={closeModal}>
        <FeatArtistPicker
          embedded
          leadArtist={artist}
          featArtist={featArtist}
          catalogArtists={catalogArtists}
          disabled={loading}
          onChange={(next) => onFeatArtistChange?.(next)}
        />
      </StepModal>

      <StepModal
        open={modal === "provider"}
        title="Provider audio"
        onClose={closeModal}
        wide
      >
        <div class="space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <div class="join">
              {aceOffered && (
              <button
                type="button"
                class={`btn join-item btn-sm ${hasAceStep ? "btn-primary" : "btn-ghost"}`}
                disabled={providerBusy || loading || !keysHydrated}
                onClick={() => switchMusicProvider("acestep")}
              >
                ACE-Step
              </button>
              )}
              {songOffered && (
              <button
                type="button"
                class={`btn join-item btn-sm ${hasSongGen ? "btn-primary" : "btn-ghost"}`}
                disabled={providerBusy || loading || !keysHydrated}
                onClick={() => switchMusicProvider("songgen")}
              >
                SongGeneration
              </button>
              )}
              {miniOffered && (
              <button
                type="button"
                class={`btn join-item btn-sm ${musicProvider === "replicate" ? "btn-primary" : "btn-ghost"}`}
                disabled={providerBusy || loading || !keysHydrated}
                onClick={() => switchMusicProvider("replicate")}
              >
                MiniMax
              </button>
              )}
            </div>
            {(providerBusy || !keysHydrated) && (
              <span class="loading loading-spinner loading-xs" />
            )}
          </div>
          {!aceOffered && !songOffered && !miniOffered && (
            <p class="text-xs text-warning">
              Tous les moteurs sont désactivés. Active-en un dans Paramètres → Morceaux.
            </p>
          )}
          {!keysHydrated && (
            <p class="text-xs text-base-content/50">Chargement des clés depuis Turso…</p>
          )}

          {hasAceStep ? (
            <div class="space-y-2 text-sm">
              <p class="text-base-content/70">
                URL :{" "}
                <code class="break-all rounded bg-base-300/60 px-1.5 py-0.5 text-xs">
                  {aceStepUrl}
                </code>
              </p>
              <div class="flex flex-wrap items-center gap-2">
                {probeStatus === "checking" && (
                  <span class="inline-flex items-center gap-1.5 text-base-content/60">
                    <span class="loading loading-spinner loading-xs" />
                    Test en cours…
                  </span>
                )}
                {probeStatus === "ok" && (
                  <span class="inline-flex items-center gap-1.5 text-success">
                    <CheckCircle2 size={14} />
                    {probeMessage}
                  </span>
                )}
                {probeStatus === "error" && (
                  <span class="inline-flex max-w-full items-start gap-1.5 text-error">
                    <XCircle size={14} class="mt-0.5 shrink-0" />
                    <span class="break-words">{probeMessage}</span>
                  </span>
                )}
                <button
                  type="button"
                  class="btn btn-ghost btn-xs gap-1"
                  disabled={probeStatus === "checking" || loading}
                  onClick={() => void probeAceStep()}
                >
                  <RefreshCw size={12} /> Retester
                </button>
                <button type="button" class="btn btn-ghost btn-xs" onClick={onOpenSettings}>
                  Ajuster l’URL
                </button>
              </div>
              {probeStatus === "ok" && (
                <AceStepModelsPanel
                  models={songGenModels}
                  activeModelId={pickedModelId}
                  preferredModelId={preferredModelId}
                  gpu={songGenGpu}
                  busyId={modelBusyId}
                  disabled={loading || probeStatus === "checking"}
                  error={modelActionError}
                  onUse={(id) => void runAceModelAction(id)}
                />
              )}
            </div>
          ) : hasSongGen ? (
            <div class="space-y-2 text-sm">
              <p class="text-base-content/70">
                URL :{" "}
                <code class="break-all rounded bg-base-300/60 px-1.5 py-0.5 text-xs">
                  {songGenUrl}
                </code>
              </p>
              <div class="flex flex-wrap items-center gap-2">
                {probeStatus === "checking" && (
                  <span class="inline-flex items-center gap-1.5 text-base-content/60">
                    <span class="loading loading-spinner loading-xs" />
                    Test en cours…
                  </span>
                )}
                {probeStatus === "ok" && (
                  <span class="inline-flex items-center gap-1.5 text-success">
                    <CheckCircle2 size={14} />
                    {probeMessage}
                  </span>
                )}
                {probeStatus === "error" && (
                  <span class="inline-flex max-w-full items-start gap-1.5 text-error">
                    <XCircle size={14} class="mt-0.5 shrink-0" />
                    <span class="break-words">{probeMessage}</span>
                  </span>
                )}
                <button
                  type="button"
                  class="btn btn-ghost btn-xs gap-1"
                  disabled={probeStatus === "checking" || loading}
                  onClick={() => void probeSongGen()}
                >
                  <RefreshCw size={12} /> Retester
                </button>
                <button type="button" class="btn btn-ghost btn-xs" onClick={onOpenSettings}>
                  Ajuster l’URL
                </button>
              </div>
              {probeStatus === "ok" && (
                <SongGenModelsPanel
                  models={songGenModels}
                  pickedModelId={pickedModelId}
                  preferredModelId={preferredModelId}
                  gpu={songGenGpu}
                  busyId={modelBusyId}
                  disabled={loading || probeStatus === "checking"}
                  error={modelActionError}
                  onDownload={(id) => void runModelAction(id, "download")}
                  onCancelDownload={(id) => void runModelAction(id, "cancel")}
                  onDelete={(id) => void runModelAction(id, "delete")}
                  onUse={(id) => void runModelAction(id, "use")}
                />
              )}
            </div>
          ) : hasReplicateToken ? (
            <p class="text-sm text-base-content/70">
              Token Replicate détecté. MiniMax est facturé à l’usage
              <a
                class="link link-primary ml-1"
                href="https://replicate.com/account/billing#billing"
                target="_blank"
                rel="noreferrer"
              >
                (billing)
              </a>
              .
            </p>
          ) : keysHydrated ? (
            <div class="space-y-2">
              <p class="text-sm text-warning">
                Token Replicate manquant — ajoute-le dans Paramètres, ou passe sur ACE-Step / SongGeneration.
              </p>
              <button type="button" class="btn btn-warning btn-sm gap-1" onClick={onOpenSettings}>
                <KeyRound size={14} /> Paramètres audio
              </button>
            </div>
          ) : null}
        </div>
      </StepModal>

      <StepModal
        open={modal === "once"}
        title="Importer un morceau"
        onClose={closeModal}
        wide
      >
        <div class="space-y-4">
          <p class="text-xs text-base-content/60">
            Importe n’importe quel fichier audio (FLAC, WAV, MP3, M4A…). Ce n’est pas forcément un
            master ONCE.
          </p>
          <label class="form-control w-full">
            <span class="label-text mb-1 text-sm text-base-content/60">Titre du morceau</span>
            <input
              class="input input-bordered w-full bg-base-100"
              type="text"
              placeholder="Ex. Dernier train"
              value={importTitle}
              disabled={onceBusy}
              onInput={(e) => setImportTitle(e.currentTarget.value)}
            />
          </label>
          <label class={`btn btn-secondary btn-sm gap-1 cursor-pointer ${onceBusy ? "btn-disabled" : ""}`}>
            {onceBusy ? (
              <span class="loading loading-spinner loading-xs" />
            ) : (
              <Upload size={14} />
            )}
            Choisir un fichier
            <input
              ref={importFileRef}
              type="file"
              accept={AUDIO_FILE_ACCEPT}
              class="hidden"
              disabled={onceBusy}
              onChange={onFileChange}
            />
          </label>

          <div class="divider my-1 text-xs text-base-content/40">optionnel · master ONCE</div>
          <p class="text-xs text-base-content/60">
            Si tu colles au master déjà publié, une régénération MiniMax n’est jamais le même
            fichier. Restaure alors le WAV de la release ONCE.
          </p>
          {isOnceOriginal ? (
            <span class="badge badge-success badge-sm">Master ONCE ✓</span>
          ) : null}
          {!hasOnce ? (
            <button type="button" class="btn btn-ghost btn-sm gap-1" onClick={onOpenSettings}>
              <KeyRound size={14} /> Ajouter le token ONCE
            </button>
          ) : (
            <div class="flex flex-wrap items-center gap-2">
              <input
                class="input input-bordered input-sm min-w-[240px] flex-1 bg-base-100 font-mono text-xs"
                placeholder="UUID release ONCE (optionnel)"
                value={onceReleaseId}
                onInput={(e) => setOnceReleaseId(e.currentTarget.value)}
              />
              <button
                type="button"
                class="btn btn-outline btn-sm gap-1"
                disabled={onceBusy || !onceReleaseId.trim()}
                onClick={tryOnceApiRestore}
              >
                {onceBusy ? (
                  <span class="loading loading-spinner loading-xs" />
                ) : (
                  <RotateCcw size={14} />
                )}
                Récupérer depuis ONCE
              </button>
              <label class="btn btn-ghost btn-sm gap-1 cursor-pointer">
                <Upload size={14} />
                Fichier + UUID ONCE
                <input
                  ref={onceFileRef}
                  type="file"
                  accept={AUDIO_FILE_ACCEPT}
                  class="hidden"
                  onChange={onOnceFileChange}
                />
              </label>
              <a
                class="btn btn-ghost btn-sm gap-1"
                href={onceDashboard}
                target="_blank"
                rel="noreferrer"
              >
                Ouvrir ONCE <ExternalLink size={12} />
              </a>
            </div>
          )}
          {onceHint && <p class="text-xs text-warning">{onceHint}</p>}
          {importError && <p class="text-xs text-error">{importError}</p>}
        </div>
      </StepModal>

      <StepModal open={modal === "suno"} title="Prompt Suno" onClose={closeModal} wide>
        <div class="space-y-2">
          <div class="flex justify-end">
            <button type="button" class="btn btn-ghost btn-xs gap-1" onClick={copyPrompt}>
              <Copy size={12} /> Copier
            </button>
          </div>
          <textarea
            class="textarea textarea-bordered min-h-40 w-full bg-base-200 font-mono text-xs"
            value={liveSunoPrompt || track?.sunoPrompt || ""}
            readOnly
          />
        </div>
      </StepModal>
    </section>
  );
}
