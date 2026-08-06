import { useEffect, useRef, useState } from "preact/hooks";
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
  Library,
} from "lucide-preact";
import { loadKeys, saveKeysAsync } from "../../lib/keys.js";
import { persistAudioRemote, playableAudioSrc } from "../../lib/audioResolve.js";
import { api } from "../../lib/apiClient.js";
import { ALBUM_SIZES } from "../../lib/studio.js";

function songGenUrlFromKeys(keys) {
  return String(keys?.songGenBaseUrl || "")
    .trim()
    .replace(/\/+$/, "") || "http://127.0.0.1:7860";
}

export default function TracksStep({
  track,
  lyrics,
  loading,
  progress = null,
  album = null,
  projectId,
  distrokid,
  onGenerate,
  onGenerateAlbum,
  onSelectAlbumTrack,
  onAttachAudio,
  onOpenSettings,
}) {
  const [musicProvider, setMusicProvider] = useState("replicate");
  const [songGenUrl, setSongGenUrl] = useState("http://127.0.0.1:7860");
  const [hasReplicateToken, setHasReplicateToken] = useState(false);
  const [hasOnce, setHasOnce] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [probeStatus, setProbeStatus] = useState("idle"); // idle | checking | ok | error
  const [probeMessage, setProbeMessage] = useState("");
  const [audioUrlInput, setAudioUrlInput] = useState("");
  const [importError, setImportError] = useState("");
  const [onceReleaseId, setOnceReleaseId] = useState("");
  const [onceBusy, setOnceBusy] = useState(false);
  const [onceHint, setOnceHint] = useState("");
  const [albumSize, setAlbumSize] = useState(8);
  const onceFileRef = useRef(null);
  const probeSeq = useRef(0);

  const hasSongGen = musicProvider === "songgen";
  const hasReplicate = musicProvider === "replicate" && hasReplicateToken;

  function refreshFromKeys() {
    const keys = loadKeys();
    const provider =
      String(keys.musicProvider || "").trim() === "songgen" ? "songgen" : "replicate";
    setMusicProvider(provider);
    setSongGenUrl(songGenUrlFromKeys(keys));
    setHasReplicateToken(Boolean(keys.replicateApiToken?.trim()));
    setHasOnce(Boolean(keys.onceApiToken?.trim()));
    return { keys, provider };
  }

  async function probeSongGen() {
    const seq = ++probeSeq.current;
    setProbeStatus("checking");
    setProbeMessage("Vérification depuis le serveur Astro…");
    try {
      const res = await api.probeSongGen();
      if (seq !== probeSeq.current) return;
      if (res?.base) setSongGenUrl(String(res.base).replace(/\/+$/, ""));
      if (res?.ok) {
        setProbeStatus("ok");
        setProbeMessage(res.message || "Joignable");
      } else {
        setProbeStatus("error");
        setProbeMessage(res?.message || "Injoignable");
      }
    } catch (e) {
      if (seq !== probeSeq.current) return;
      setProbeStatus("error");
      setProbeMessage(e.message || "Test impossible");
    }
  }

  useEffect(() => {
    const { provider } = refreshFromKeys();
    if (provider === "songgen") void probeSongGen();
    else {
      setProbeStatus("idle");
      setProbeMessage("");
    }
  }, [track, loading]);

  useEffect(() => {
    const id = distrokid?.releaseId || "";
    if (id) setOnceReleaseId(id);
  }, [distrokid?.releaseId]);

  async function switchMusicProvider(next) {
    if (next === musicProvider || providerBusy || loading) return;
    setProviderBusy(true);
    setImportError("");
    try {
      const keys = loadKeys();
      await saveKeysAsync({ ...keys, musicProvider: next });
      setMusicProvider(next);
      setSongGenUrl(songGenUrlFromKeys({ ...keys, musicProvider: next }));
      setHasReplicateToken(Boolean(keys.replicateApiToken?.trim()));
      if (next === "songgen") await probeSongGen();
      else {
        probeSeq.current += 1;
        setProbeStatus("idle");
        setProbeMessage("");
      }
    } catch (e) {
      setImportError(e.message || "Impossible d’enregistrer le provider");
    } finally {
      setProviderBusy(false);
    }
  }

  async function copyPrompt() {
    if (!track?.sunoPrompt) return;
    await navigator.clipboard.writeText(track.sunoPrompt);
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
      });
    } catch (e) {
      onAttachAudio?.(url, { provider: "import-url", warning: e.message });
      setImportError(
        `${e.message} — audio attaché en temporaire ; configure S3 pour le garder.`,
      );
    }
  }

  async function onFileChange(e) {
    setImportError("");
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setImportError("Choisis un fichier audio (mp3, wav, m4a…).");
      return;
    }
    try {
      const form = new FormData();
      form.append("audio", file, file.name);
      form.append("projectId", projectId || "anon");
      form.append("mimeType", file.type || "audio/mpeg");
      const res = await fetch("/api/audio/persist", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload audio impossible");
      onAttachAudio?.(data.audioUrl, {
        provider: "import-file",
        fileName: file.name,
        s3Key: data.s3Key,
        persisted: true,
      });
    } catch (err) {
      const reader = new FileReader();
      reader.onload = () => {
        onAttachAudio?.(String(reader.result), {
          provider: "import-file",
          fileName: file.name,
          warning: err.message,
        });
      };
      reader.onerror = () => setImportError("Lecture du fichier impossible");
      reader.readAsDataURL(file);
      setImportError(`${err.message} — import local temporaire.`);
    }
  }

  function applyOnceRestore(data) {
    onAttachAudio?.(data.audioUrl, {
      provider: "once-original",
      s3Key: data.s3Key,
      persisted: true,
      releaseId: data.releaseId,
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
    setOnceBusy(true);
    setImportError("");
    setOnceHint("");
    try {
      const releaseId = onceReleaseId.trim();
      if (!releaseId) throw new Error("Indique l’ID de release ONCE avant l’import.");
      if (!projectId) throw new Error("Projet non sauvegardé.");
      const keys = loadKeys();
      if (!keys.onceApiToken?.trim()) throw new Error("Token ONCE manquant — Paramètres.");
      const form = new FormData();
      form.append("audio", file, file.name);
      form.append("releaseId", releaseId);
      form.append("projectId", projectId);
      form.append("mimeType", file.type || "audio/wav");
      form.append("keys", JSON.stringify(keys));
      const res = await fetch("/api/audio/from-once", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Import WAV ONCE impossible");
      applyOnceRestore(data);
    } catch (err) {
      setImportError(err.message || "Import WAV ONCE échoué");
    } finally {
      setOnceBusy(false);
    }
  }

  const audioReady = Boolean(track?.audioUrl);
  const isOnceOriginal = track?.provider === "once-original";
  const canGenerateAudio = hasSongGen || hasReplicate;
  const albumRunning = album?.status === "running";
  const albumTracks = Array.isArray(album?.tracks) ? album.tracks : [];
  const albumDoneCount = albumTracks.filter((t) => t.status === "done").length;
  const onceDashboard =
    distrokid?.dashboardUrl ||
    (onceReleaseId.trim()
      ? `https://beta.once.app/releases/${onceReleaseId.trim()}`
      : "https://beta.once.app/");

  function albumStatusLabel(st) {
    if (st === "done") return "OK";
    if (st === "lyrics") return "Paroles…";
    if (st === "audio") return "Audio…";
    if (st === "error") return "Erreur";
    if (st === "pending") return "En attente";
    return st || "—";
  }

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Créer les morceaux</h2>
        <p class="max-w-xl text-base-content/70">
          {hasSongGen
            ? "SongGeneration Studio (LeVo local sur GPU) — voix + paroles, ~3–6 min."
            : "Replicate → MiniMax Music 2.6 (voix + paroles, ~2–4 min)."}
        </p>
      </header>

      <div class="space-y-3 border border-base-content/10 bg-base-200/40 p-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm text-base-content/60">Provider audio :</span>
          <div class="join">
            <button
              type="button"
              class={`btn join-item btn-sm ${hasSongGen ? "btn-primary" : "btn-ghost"}`}
              disabled={providerBusy || loading}
              onClick={() => switchMusicProvider("songgen")}
            >
              SongGeneration
            </button>
            <button
              type="button"
              class={`btn join-item btn-sm ${!hasSongGen ? "btn-primary" : "btn-ghost"}`}
              disabled={providerBusy || loading}
              onClick={() => switchMusicProvider("replicate")}
            >
              MiniMax
            </button>
          </div>
          {providerBusy && <span class="loading loading-spinner loading-xs" />}
        </div>

        {hasSongGen ? (
          <div class="space-y-2 text-sm">
            <p class="text-base-content/70">
              URL configurée :{" "}
              <code class="break-all rounded bg-base-300/60 px-1.5 py-0.5 text-xs">{songGenUrl}</code>
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
            <p class="text-xs text-base-content/50">
              Le ping part du serveur Astro (pas du navigateur) — même chemin que la génération.
            </p>
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
        ) : (
          <div class="space-y-2">
            <p class="text-sm text-warning">
              Token Replicate manquant — ajoute-le dans Paramètres, ou passe sur SongGeneration.
            </p>
            <button type="button" class="btn btn-warning btn-sm gap-1" onClick={onOpenSettings}>
              <KeyRound size={14} /> Paramètres audio
            </button>
          </div>
        )}
      </div>

      {!canGenerateAudio && !hasSongGen && (
        <div class="border border-warning/40 bg-warning/10 p-4">
          <p class="font-medium text-warning">Aucun provider audio prêt</p>
          <p class="mt-1 text-sm text-base-content/70">
            Choisis SongGeneration ou un token Replicate, sinon importe un mp3 (Suno).
          </p>
        </div>
      )}

      <button
        class="btn btn-primary gap-2"
        disabled={loading || !lyrics || (hasSongGen && probeStatus === "error") || albumRunning}
        onClick={onGenerate}
        title={
          hasSongGen && probeStatus === "error"
            ? "SongGeneration injoignable — corrige l’URL ou Retester"
            : hasSongGen
              ? `Génère via SongGeneration @ ${songGenUrl}`
              : !hasReplicate
                ? "Sans provider → brief Suno uniquement"
                : "Génère via MiniMax Music 2.6"
        }
      >
        {loading ? <span class="loading loading-spinner loading-sm" /> : <AudioLines size={18} />}
        {loading
          ? typeof progress?.percent === "number"
            ? `${progress.percent}% — ${progress.message || "Composition…"}`
            : hasSongGen
              ? "Composition SongGen (3–6 min)…"
              : "Composition MiniMax (2–5 min)…"
          : canGenerateAudio
            ? hasSongGen
              ? "Générer la chanson (SongGen local)"
              : "Générer la chanson (MiniMax + paroles)"
            : "Générer le brief (sans audio)"}
      </button>
      {loading && typeof progress?.percent === "number" && (
        <div class="space-y-1.5" aria-live="polite">
          <div class="h-2 overflow-hidden rounded-full bg-base-300">
            <div
              class="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${Math.max(4, Math.min(100, progress.percent))}%` }}
            />
          </div>
          <p class="text-xs text-base-content/60">{progress.message}</p>
        </div>
      )}
      {!lyrics && <p class="text-sm text-warning">Générez d'abord les paroles (étape 3).</p>}
      {hasSongGen && probeStatus === "error" && (
        <p class="text-sm text-error">
          Studio injoignable depuis Astro — lance Pinokio / vérifie l’URL avant de générer.
        </p>
      )}

      {track && (
        <div class="animate-rise space-y-4 border-t border-base-content/10 pt-5">
          <div class="flex flex-wrap items-center gap-3">
            <Disc3 size={22} class={`text-primary ${audioReady ? "animate-pulse-soft" : ""}`} />
            <div>
              <h3 class="font-display text-xl font-semibold">{track.title}</h3>
              <p class="text-sm text-base-content/60">
                {track.artist} · {track.style} · {track.key} · {track.bpm} BPM · {track.duration} ·{" "}
                {track.provider}
              </p>
              <p class={`text-xs ${audioReady ? "text-success" : "text-warning"}`}>
                {audioReady
                  ? "Audio prêt ✓"
                  : "Pas d’audio — importe un fichier ou configure SongGen / Replicate"}
              </p>
            </div>
          </div>

          {audioReady && (
            <div class="space-y-3 border border-primary/25 bg-primary/5 p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <p class="flex items-center gap-2 text-sm font-medium">
                    <Library size={16} class="text-primary" />
                    Album autonome
                  </p>
                  <p class="mt-1 text-xs text-base-content/60">
                    Le single lead est validé. Génère le reste de l’album (paroles + audio) sans
                    intervention — même style / même provider.
                  </p>
                </div>
                <select
                  class="select select-bordered select-sm bg-base-100"
                  value={albumSize}
                  disabled={loading || album?.status === "running"}
                  onChange={(e) => setAlbumSize(Number(e.currentTarget.value) || 8)}
                >
                  {ALBUM_SIZES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                class="btn btn-outline btn-sm gap-2"
                disabled={loading || !canGenerateAudio || (hasSongGen && probeStatus === "error")}
                onClick={() => onGenerateAlbum?.(albumSize)}
              >
                {albumRunning ? (
                  <span class="loading loading-spinner loading-xs" />
                ) : (
                  <Library size={14} />
                )}
                {albumRunning
                  ? `Album en cours (${albumDoneCount}/${album.targetCount || albumSize})…`
                  : album?.status === "done"
                    ? `Relancer un album (${albumSize} titres)`
                    : `Créer l’album (${albumSize} titres)`}
              </button>
              {album?.title && (
                <p class="text-xs text-base-content/55">
                  <span class="font-medium text-base-content/80">{album.title}</span>
                  {album.concept ? ` — ${album.concept}` : ""}
                </p>
              )}
              {albumTracks.length > 0 && (
                <ul class="divide-y divide-base-content/10 border border-base-content/10 bg-base-100/60">
                  {albumTracks.map((entry) => (
                    <li
                      key={entry.id}
                      class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <div class="min-w-0 flex-1">
                        <p class="truncate font-medium">
                          {entry.index}.{" "}
                          {entry.lyrics?.title || entry.workingTitle || entry.theme || "Sans titre"}
                          {entry.role === "lead" ? (
                            <span class="badge badge-primary badge-xs ml-2">Lead</span>
                          ) : null}
                        </p>
                        <p class="truncate text-xs text-base-content/50">{entry.theme}</p>
                        {entry.error && <p class="text-xs text-error">{entry.error}</p>}
                      </div>
                      <div class="flex items-center gap-2">
                        <span
                          class={`badge badge-sm ${
                            entry.status === "done"
                              ? "badge-success"
                              : entry.status === "error"
                                ? "badge-error"
                                : entry.status === "pending"
                                  ? "badge-ghost"
                                  : "badge-warning"
                          }`}
                        >
                          {albumStatusLabel(entry.status)}
                        </span>
                        {(entry.track?.audioUrl || entry.lyrics) && (
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs"
                            disabled={loading}
                            onClick={() => onSelectAlbumTrack?.(entry)}
                          >
                            Ouvrir
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {albumRunning && (
                <p class="text-xs text-base-content/50">
                  Laisse l’onglet ouvert — chaque titre prend ~3–6 min (SongGen) ou ~2–4 min
                  (MiniMax).
                </p>
              )}
            </div>
          )}

          {audioReady ? (
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
              <audio controls class="w-full" src={playableAudioSrc(track.audioUrl)} preload="metadata" />
              {/\/api\/audio\//i.test(String(track.audioUrl || "")) && (
                <p class="text-xs text-base-content/50">
                  Lecture via proxy Astro (SongGen FLAC / LAN). Si 0:00, clique « Re-sauver audio »
                  ci-dessous.
                </p>
              )}
              {track.audioUrl && (
                <button
                  type="button"
                  class="btn btn-ghost btn-xs gap-1"
                  disabled={loading}
                  onClick={async () => {
                    setImportError("");
                    try {
                      const saved = await persistAudioRemote(track.audioUrl, projectId || "anon");
                      if (saved?.audioUrl) {
                        onAttachAudio?.(saved.audioUrl, {
                          provider: track.provider || "songgeneration-studio",
                          s3Key: saved.s3Key,
                          persisted: true,
                          note: "Audio re-persisté (mime corrigé).",
                        });
                      }
                    } catch (e) {
                      setImportError(e.message || "Re-persistance impossible");
                    }
                  }}
                >
                  Re-sauver audio (S3)
                </button>
              )}
            </>
          ) : (
            <div class="space-y-3 border border-base-content/10 bg-base-200/50 p-4">
              <p class="text-sm font-medium">
                {track.assetMissingReason
                  ? "Audio perdu (lien expiré ou non sauvegardé) — réimporte un mp3"
                  : "Importer l’audio (Suno / fichier local)"}
              </p>
              <ol class="list-decimal space-y-1 pl-5 text-xs text-base-content/60">
                <li>Copie le prompt Suno ci-dessous</li>
                <li>
                  Génère sur{" "}
                  <a class="link link-primary" href="https://suno.com" target="_blank" rel="noreferrer">
                    suno.com
                  </a>
                </li>
                <li>Télécharge le mp3, puis importe-le ici</li>
              </ol>

              <label class="btn btn-secondary btn-sm gap-2 cursor-pointer">
                <Upload size={14} />
                Importer un fichier audio
                <input type="file" accept="audio/*" class="hidden" onChange={onFileChange} />
              </label>

              <div class="flex flex-wrap gap-2">
                <input
                  class="input input-bordered input-sm min-w-[220px] flex-1 bg-base-100"
                  placeholder="https://… lien mp3 / wav"
                  value={audioUrlInput}
                  onInput={(e) => setAudioUrlInput(e.currentTarget.value)}
                />
                <button type="button" class="btn btn-outline btn-sm gap-1" onClick={attachUrl}>
                  <Link2 size={14} /> Attacher URL
                </button>
              </div>
              {importError && <p class="text-xs text-error">{importError}</p>}
            </div>
          )}

          <p class="text-xs text-base-content/50">{track.note}</p>
          {track.warning && (
            <div class="border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              {track.warning}
            </div>
          )}

          <div class="space-y-3 border border-base-content/10 bg-base-200/40 p-4">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p class="text-sm font-medium">Audio original ONCE (publié)</p>
                <p class="mt-1 text-xs text-base-content/60">
                  Une régénération MiniMax n’est jamais le même fichier que celui livré sur ONCE.
                  Pour coller au master publié, restaure le WAV de la release.
                </p>
              </div>
              {isOnceOriginal ? (
                <span class="badge badge-success badge-sm">Master ONCE ✓</span>
              ) : null}
            </div>
            {!hasOnce ? (
              <button type="button" class="btn btn-ghost btn-sm gap-1" onClick={onOpenSettings}>
                <KeyRound size={14} /> Ajouter le token ONCE
              </button>
            ) : (
              <div class="flex flex-wrap items-center gap-2">
                <input
                  class="input input-bordered input-sm min-w-[240px] flex-1 bg-base-100 font-mono text-xs"
                  placeholder="UUID release ONCE"
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
                <label class="btn btn-secondary btn-sm gap-1 cursor-pointer">
                  <Upload size={14} />
                  Importer le WAV release
                  <input
                    ref={onceFileRef}
                    type="file"
                    accept="audio/*,.wav,.mp3,.m4a"
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

          {track.sunoPrompt && (
            <div class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs uppercase tracking-wider text-base-content/45">Prompt Suno</span>
                <button type="button" class="btn btn-ghost btn-xs gap-1" onClick={copyPrompt}>
                  <Copy size={12} /> Copier
                </button>
              </div>
              <textarea
                class="textarea textarea-bordered min-h-28 w-full bg-base-200 font-mono text-xs"
                value={track.sunoPrompt}
                readOnly
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
