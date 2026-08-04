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
} from "lucide-preact";
import { loadKeys } from "../../lib/keys.js";
import { persistAudioRemote } from "../../lib/audioResolve.js";

export default function TracksStep({
  track,
  lyrics,
  loading,
  projectId,
  distrokid,
  onGenerate,
  onAttachAudio,
  onOpenSettings,
}) {
  const [hasReplicate, setHasReplicate] = useState(false);
  const [hasSongGen, setHasSongGen] = useState(false);
  const [hasOnce, setHasOnce] = useState(false);
  const [audioUrlInput, setAudioUrlInput] = useState("");
  const [importError, setImportError] = useState("");
  const [onceReleaseId, setOnceReleaseId] = useState("");
  const [onceBusy, setOnceBusy] = useState(false);
  const [onceHint, setOnceHint] = useState("");
  const onceFileRef = useRef(null);

  useEffect(() => {
    const keys = loadKeys();
    const songgen = String(keys.musicProvider || "").trim() === "songgen";
    setHasSongGen(songgen);
    setHasReplicate(Boolean(keys.replicateApiToken?.trim()) && !songgen);
    setHasOnce(Boolean(keys.onceApiToken?.trim()));
  }, [track, loading]);

  useEffect(() => {
    const id = distrokid?.releaseId || "";
    if (id) setOnceReleaseId(id);
  }, [distrokid?.releaseId]);

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
      // Persiste tout de suite sur S3 (sinon Replicate / data: disparaissent)
      const saved = await persistAudioRemote(url, projectId || "anon");
      onAttachAudio?.(saved.audioUrl || url, {
        provider: "import-url",
        s3Key: saved.s3Key,
        persisted: Boolean(saved.persisted || saved.reused),
      });
    } catch (e) {
      // Fallback : attache quand même l’URL (session)
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
      // Secours data URL (sera persisté à la sauvegarde projet si S3 OK)
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
  const onceDashboard =
    distrokid?.dashboardUrl ||
    (onceReleaseId.trim()
      ? `https://beta.once.app/releases/${onceReleaseId.trim()}`
      : "https://beta.once.app/");

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Créer les morceaux</h2>
        <p class="max-w-xl text-base-content/70">
          {hasSongGen
            ? "SongGeneration Studio (LeVo local sur GPU) — voix + paroles, ~3–6 min. Pinokio doit être démarré."
            : "Replicate → MiniMax Music 2.6 (voix + paroles, ~2–4 min). Ou passe en SongGeneration local dans Paramètres."}
        </p>
      </header>

      {hasSongGen ? (
        <div class="border border-base-content/10 bg-base-200/40 p-4 text-sm text-base-content/70">
          Provider local actif. URL joignable depuis le serveur Astro (souvent{" "}
          <code class="text-xs">http://127.0.0.1:7860</code> sur Demeter, ou l’IP LAN).
          <button type="button" class="btn btn-ghost btn-xs ml-2" onClick={onOpenSettings}>
            Ajuster l’URL
          </button>
        </div>
      ) : !hasReplicate ? (
        <div class="border border-warning/40 bg-warning/10 p-4">
          <p class="font-medium text-warning">Aucun provider audio configuré</p>
          <p class="mt-1 text-sm text-base-content/70">
            Choisis SongGeneration Studio (local) ou un token Replicate, sinon importe un mp3 (Suno).
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="btn btn-warning btn-sm gap-1" onClick={onOpenSettings}>
              <KeyRound size={14} /> Paramètres audio
            </button>
            <a
              class="btn btn-ghost btn-sm gap-1"
              href="https://replicate.com/account/api-tokens"
              target="_blank"
              rel="noreferrer"
            >
              Token Replicate <ExternalLink size={12} />
            </a>
          </div>
        </div>
      ) : (
        <div class="border border-base-content/10 bg-base-200/40 p-4 text-sm text-base-content/70">
          Token Replicate détecté. Sans carte bancaire, Replicate limite à ~1 requête/min.
          <a
            class="link link-primary ml-1"
            href="https://replicate.com/account/billing#billing"
            target="_blank"
            rel="noreferrer"
          >
            Ajouter un moyen de paiement
          </a>
          {" "}(MiniMax facturé à l’usage). Pour du local GPU : Paramètres → SongGeneration Studio.
        </div>
      )}

      <button
        class="btn btn-primary gap-2"
        disabled={loading || !lyrics}
        onClick={onGenerate}
        title={
          hasSongGen
            ? "Génère via SongGeneration Studio (local)"
            : !hasReplicate
              ? "Sans provider → brief Suno uniquement"
              : "Génère via MiniMax Music 2.6"
        }
      >
        {loading ? <span class="loading loading-spinner loading-sm" /> : <AudioLines size={18} />}
        {loading
          ? hasSongGen
            ? "Composition SongGen (3–6 min)…"
            : "Composition MiniMax (2–5 min)…"
          : canGenerateAudio
            ? hasSongGen
              ? "Générer la chanson (SongGen local)"
              : "Générer la chanson (MiniMax + paroles)"
            : "Générer le brief (sans audio)"}
      </button>
      {!lyrics && <p class="text-sm text-warning">Générez d'abord les paroles (étape 3).</p>}

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
              <audio controls class="w-full" src={track.audioUrl} />
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
