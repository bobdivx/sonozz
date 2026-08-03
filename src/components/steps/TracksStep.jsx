import { useEffect, useState } from "preact/hooks";
import { AudioLines, Disc3, Copy, KeyRound, Link2, Upload, ExternalLink } from "lucide-preact";
import { loadKeys } from "../../lib/keys.js";

export default function TracksStep({
  track,
  lyrics,
  loading,
  onGenerate,
  onAttachAudio,
  onOpenSettings,
}) {
  const [hasReplicate, setHasReplicate] = useState(false);
  const [audioUrlInput, setAudioUrlInput] = useState("");
  const [importError, setImportError] = useState("");

  useEffect(() => {
    setHasReplicate(Boolean(loadKeys().replicateApiToken?.trim()));
  }, [track, loading]);

  async function copyPrompt() {
    if (!track?.sunoPrompt) return;
    await navigator.clipboard.writeText(track.sunoPrompt);
  }

  function attachUrl() {
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
    onAttachAudio?.(url, { provider: "import-url" });
  }

  async function onFileChange(e) {
    setImportError("");
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setImportError("Choisis un fichier audio (mp3, wav, m4a…).");
      return;
    }
    // data URL pour persister dans le state projet
    const reader = new FileReader();
    reader.onload = () => {
      onAttachAudio?.(String(reader.result), {
        provider: "import-file",
        fileName: file.name,
      });
    };
    reader.onerror = () => setImportError("Lecture du fichier impossible");
    reader.readAsDataURL(file);
  }

  const audioReady = Boolean(track?.audioUrl);

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Créer les morceaux</h2>
        <p class="max-w-xl text-base-content/70">
          Replicate → MiniMax Music 2.6 uniquement (voix + paroles, ~2–4 min). Compte 2–5 min par génération.
        </p>
      </header>

      {!hasReplicate ? (
        <div class="border border-warning/40 bg-warning/10 p-4">
          <p class="font-medium text-warning">Token Replicate manquant</p>
          <p class="mt-1 text-sm text-base-content/70">
            C’est pour ça que le lecteur reste à 0:00. Ajoute un token Replicate, ou génère sur Suno puis importe l’audio ici.
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="btn btn-warning btn-sm gap-1" onClick={onOpenSettings}>
              <KeyRound size={14} /> Ajouter le token Replicate
            </button>
            <a
              class="btn btn-ghost btn-sm gap-1"
              href="https://replicate.com/account/api-tokens"
              target="_blank"
              rel="noreferrer"
            >
              Obtenir un token <ExternalLink size={12} />
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
          {" "}(MiniMax facturé à l’usage sur Replicate).
        </div>
      )}

      <button
        class="btn btn-primary gap-2"
        disabled={loading || !lyrics}
        onClick={onGenerate}
        title={!hasReplicate ? "Sans Replicate → brief Suno uniquement" : "Génère via MiniMax Music 2.6"}
      >
        {loading ? <span class="loading loading-spinner loading-sm" /> : <AudioLines size={18} />}
        {loading
          ? "Composition MiniMax (2–5 min)…"
          : hasReplicate
            ? "Générer la chanson (MiniMax + paroles)"
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
                {audioReady ? "Audio prêt ✓" : "Pas d’audio — importe un fichier ou configure Replicate"}
              </p>
            </div>
          </div>

          {audioReady ? (
            <>
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
              <p class="text-sm font-medium">Importer l’audio (Suno / fichier local)</p>
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
