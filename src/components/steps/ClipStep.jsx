import { useEffect, useState } from "preact/hooks";
import {
  Clapperboard,
  Download,
  Film,
  AudioLines,
  Sparkles,
  ChevronRight,
} from "lucide-preact";
import { renderShortVideo, downloadBlob } from "../../lib/renderShort.js";
import { api } from "../../lib/apiClient.js";

function hasAudio(track) {
  return Boolean(track?.audioUrl);
}

function isEphemeralHttp(url = "") {
  return (
    /^https?:\/\//i.test(url) &&
    /replicate\.delivery|pb\.replicate\.com|fal\.media|oaidalleapiprodscus/i.test(url)
  );
}

function isDurableRaster(url = "") {
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(url);
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = String(dataUrl).split(",");
  const mime = meta.match(/data:([^;]+)/)?.[1] || "video/mp4";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function blobToObjectUrl(blob) {
  return URL.createObjectURL(blob);
}

export default function ClipStep({
  social,
  clip,
  artist,
  track,
  cover,
  lyrics,
  loading,
  onGeneratePack,
  onClipReady,
  onGoToTracks,
  onGoToArtist,
  onGoToCover,
  onGoToSocial,
}) {
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoBlob, setVideoBlob] = useState(null);
  const [videoMeta, setVideoMeta] = useState(null);
  const [error, setError] = useState("");

  const hasPortrait = Boolean(artist?.imageUrl && !/^data:image\/svg/i.test(artist.imageUrl));
  const hasCover = Boolean(cover?.imageUrl && !/^data:image\/svg/i.test(cover.imageUrl));
  const portraitExpired = isEphemeralHttp(artist?.imageUrl);
  const coverExpired = isEphemeralHttp(cover?.imageUrl);
  const portraitDurable = isDurableRaster(artist?.imageUrl);
  const trackReady = Boolean(track);
  const audioReady = hasAudio(track);

  useEffect(() => {
    const src = clip?.videoBase64 || clip?.videoUrl;
    if (!src) return undefined;
    try {
      const blob = dataUrlToBlob(src);
      const url = blobToObjectUrl(blob);
      setVideoBlob(blob);
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setVideoMeta({
        provider: clip.provider,
        usedPortrait: clip.usedPortrait,
        usedCover: clip.usedCover,
        warning: clip.warning,
      });
    } catch {
      /* ignore corrupt clip */
    }
    return undefined;
  }, [clip?.videoBase64, clip?.videoUrl, clip?.provider]);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  async function renderWithVeo(safePrompt = false) {
    setError("");
    setRendering(true);
    setProgress(5);
    try {
      const started = await api.veoShortStart({
        artist,
        track,
        cover,
        social,
        lyrics,
        safePrompt,
      });
      if (!started?.operationName) {
        throw new Error("Veo n’a pas renvoyé d’opération");
      }

      setProgress(12);
      const maxPolls = 60;
      let finished = null;
      for (let i = 0; i < maxPolls; i++) {
        await new Promise((r) => setTimeout(r, 10_000));
        setProgress(Math.min(92, 12 + Math.round(((i + 1) / maxPolls) * 80)));
        try {
          const poll = await api.veoShortPoll(started.operationName);
          if (poll?.done) {
            finished = poll;
            break;
          }
        } catch (pollErr) {
          const msg = String(pollErr?.message || pollErr);
          // Filtre celebrity → un seul retry avec prompt sans noms
          if (!safePrompt && /VEO_CELEBRITY_FILTER|celebrity|likeness|real people/i.test(msg)) {
            setError("Filtre Veo (noms/ressemblance) — nouvel essai sans noms…");
            setRendering(false);
            return renderWithVeo(true);
          }
          throw pollErr;
        }
      }
      if (!finished?.videoBase64 && !finished?.videoUrl) {
        throw new Error("Timeout Veo (~10 min) — réessaie.");
      }

      setProgress(100);
      const provider =
        started.mode === "i2v" || started.mode === "refs"
          ? started.model
          : `${started.model}-${started.mode || "gen"}`;
      const videoBase64 = finished.videoBase64 || finished.videoUrl;
      const blob = dataUrlToBlob(videoBase64);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = blobToObjectUrl(blob);
      setVideoUrl(url);
      setVideoBlob(blob);
      const meta = {
        provider,
        usedPortrait: started.usedPortrait,
        usedCover: started.usedCover,
        warning: started.warning,
        isVeo: true,
      };
      setVideoMeta(meta);
      onClipReady?.({
        videoBase64,
        videoUrl: videoBase64,
        mimeType: "video/mp4",
        ...meta,
        prompt: started.prompt,
        mode: started.mode,
        at: new Date().toISOString(),
      });
      return blob;
    } catch (e) {
      const msg = String(e?.message || e);
      if (!safePrompt && /VEO_CELEBRITY_FILTER|celebrity|likeness|real people/i.test(msg)) {
        setError("Filtre Veo (noms/ressemblance) — nouvel essai sans noms…");
        setRendering(false);
        return renderWithVeo(true);
      }
      if (/VEO_CELEBRITY_FILTER|celebrity|likeness/i.test(msg)) {
        setError(
          "Veo refuse les noms / ressemblances « célébrité ». Le prompt a déjà été allégé — régénère un portrait plus original (moins « star ») à l’étape Artiste, puis réessaie.",
        );
      } else {
        setError(msg || "Génération Veo impossible");
      }
      return null;
    } finally {
      setRendering(false);
    }
  }

  async function renderWithCanvas() {
    setError("");
    setRendering(true);
    setProgress(0);
    try {
      const blob = await renderShortVideo({
        artist,
        track,
        coverUrl: cover?.imageUrl || artist?.imageUrl,
        social,
        onProgress: setProgress,
      });
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = blobToObjectUrl(blob);
      setVideoUrl(url);
      setVideoBlob(blob);
      const meta = {
        provider: "canvas-fallback",
        isVeo: false,
        warning: "Maquette locale uniquement — ce n’est pas un clip Veo.",
      };

      const videoBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Lecture vidéo impossible"));
        reader.readAsDataURL(blob);
      });

      setVideoMeta(meta);
      onClipReady?.({
        videoBase64,
        videoUrl: videoBase64,
        mimeType: blob.type || "video/webm",
        ...meta,
        at: new Date().toISOString(),
      });
      return blob;
    } catch (e) {
      setError(e.message || "Maquette locale impossible");
      return null;
    } finally {
      setRendering(false);
    }
  }

  async function generateVeoClip() {
    if (!audioReady) {
      setError("Crée d'abord le morceau audio (étape 4).");
      return null;
    }
    if (!social) {
      setError("Génère d’abord le pack scènes (bouton 1).");
      return null;
    }
    if (!hasPortrait) {
      setError("Portrait artiste photo requis pour Veo 3 — régénère l’étape Artiste.");
      return null;
    }
    if (portraitExpired) {
      setError(
        "Portrait expiré (URL Replicate morte). Va à l’étape Artiste, régénère le portrait, puis relance Veo.",
      );
      return null;
    }
    return renderWithVeo();
  }

  async function exportOnly() {
    if (!videoBlob) {
      setError("Génère d’abord un clip Veo (bouton 2).");
      return;
    }
    const ext = videoBlob.type.includes("mp4") ? "mp4" : "webm";
    const safe = (track?.title || "short").replace(/[^\w\-]+/g, "_").slice(0, 40);
    downloadBlob(videoBlob, `${safe}-9x16.${ext}`);
  }

  const isCanvasMock = videoMeta?.provider === "canvas-fallback" || clip?.provider === "canvas-fallback";
  const hasRealVeo = Boolean(videoBlob && !isCanvasMock);

  if (!trackReady || !audioReady) {
    return (
      <section class="animate-rise space-y-6">
        <header class="space-y-2">
          <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Clip vidéo</h2>
          <p class="max-w-xl text-base-content/70">
            Audio + portrait + jaquette → short Veo 3 (9:16).
          </p>
        </header>
        <div class="border border-warning/40 bg-warning/10 p-5">
          <p class="font-display text-lg font-semibold text-warning">
            {!trackReady ? "Aucun morceau créé" : "Morceau sans fichier audio"}
          </p>
          <button type="button" class="btn btn-primary mt-4 gap-2" onClick={onGoToTracks}>
            <AudioLines size={18} />
            Aller créer le morceau
          </button>
        </div>
      </section>
    );
  }

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Clip vidéo</h2>
        <p class="max-w-xl text-base-content/70">
          Génère le short 9:16 avec Veo 3.1 — portrait, jaquette et thème du titre.
        </p>
      </header>

      <div class="grid gap-2 border border-base-content/10 bg-base-200/40 p-3 text-sm sm:grid-cols-2">
        <p
          class={
            portraitDurable
              ? "text-success"
              : portraitExpired || !hasPortrait
                ? "text-warning"
                : "text-success"
          }
        >
          Portrait{" "}
          {portraitDurable
            ? "✓ durable"
            : portraitExpired
              ? "✗ URL expirée — régénère Artiste"
              : hasPortrait
                ? "✓"
                : "✗ requis"}
        </p>
        <p
          class={
            coverExpired ? "text-warning" : hasCover ? "text-success" : "text-base-content/50"
          }
        >
          Jaquette{" "}
          {coverExpired ? "✗ URL expirée" : hasCover ? "✓" : "· optionnelle"}
        </p>
      </div>

      {(portraitExpired || (!portraitDurable && hasPortrait && /^https?:/i.test(artist?.imageUrl || ""))) && (
        <div class="border border-warning/40 bg-warning/10 p-4 text-sm space-y-2">
          <p class="font-medium text-warning">
            Portrait non durable (URL temporaire type Replicate).
          </p>
          <p class="text-base-content/70">
            Ces liens meurent en ~1 h → erreur 404 sur Veo. Régénère le portrait à l’étape Artiste
            (il sera sauvé en JPEG local).
          </p>
          <button type="button" class="btn btn-warning btn-sm" onClick={onGoToArtist}>
            Régénérer le portrait
          </button>
        </div>
      )}

      {coverExpired && !portraitExpired && (
        <div class="border border-warning/40 bg-warning/10 p-3 text-sm space-y-2">
          <p class="text-warning font-medium">Jaquette : lien temporaire expiré</p>
          <p class="text-base-content/70">
            La jaquette a bien été générée, mais Replicate ne garde le fichier qu’environ 1 h.
            Le lien est mort — ce n’est pas une perte de création, juste le fichier distant.
            Régénère la jaquette (elle sera sauvée en JPEG local).
          </p>
          <button type="button" class="btn btn-ghost btn-sm" onClick={onGoToCover}>
            Régénérer la jaquette
          </button>
        </div>
      )}

      <div class="flex flex-wrap gap-3">
        <button class="btn btn-outline gap-2" disabled={loading || rendering} onClick={onGeneratePack}>
          {loading ? <span class="loading loading-spinner loading-sm" /> : <Clapperboard size={18} />}
          {loading ? "Script…" : "1. Pack scènes"}
        </button>
        <button
          class="btn btn-primary gap-2"
          disabled={!social || rendering || !hasPortrait || portraitExpired}
          onClick={generateVeoClip}
          title={portraitExpired ? "Régénère d’abord le portrait (URL expirée)" : undefined}
        >
          {rendering && !isCanvasMock ? (
            <span class="loading loading-spinner loading-sm" />
          ) : (
            <Sparkles size={18} />
          )}
          {rendering ? `Veo ${progress}%…` : "2. Générer clip Veo 3"}
        </button>
        <button class="btn btn-ghost gap-2" disabled={!videoBlob || rendering} onClick={exportOnly}>
          <Film size={18} /> Export fichier
        </button>
        {hasRealVeo && (
          <button type="button" class="btn btn-secondary gap-2" onClick={onGoToSocial}>
            Diffuser sur les réseaux <ChevronRight size={16} />
          </button>
        )}
      </div>

      {isCanvasMock && (
        <div class="border border-warning/40 bg-warning/10 p-4 text-sm">
          <p class="font-medium text-warning">Ceci est une maquette locale, pas un clip Veo.</p>
          <p class="mt-1 text-base-content/70">
            Relance « Générer clip Veo 3 ». Il faut une clé Gemini avec facturation vidéo (paid preview).
          </p>
          <button
            type="button"
            class="btn btn-primary btn-sm mt-3 gap-2"
            disabled={rendering || !social || !hasPortrait}
            onClick={generateVeoClip}
          >
            <Sparkles size={16} /> Relancer Veo 3
          </button>
        </div>
      )}

      {error && (
        <div class="border border-error/40 bg-error/10 p-4 text-sm text-error space-y-2">
          <p>{error}</p>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            disabled={rendering || !social}
            onClick={renderWithCanvas}
          >
            Utiliser maquette locale (secours)
          </button>
        </div>
      )}
      {rendering && (
        <div class="space-y-1">
          <p class="text-xs text-base-content/50">Veo génère un vrai clip cinéma (~1–3 min)…</p>
          <div class="h-1.5 overflow-hidden rounded-full bg-base-300">
            <div class="h-full bg-primary transition-all" style={{ width: `${Math.max(progress, 8)}%` }} />
          </div>
        </div>
      )}

      <audio controls class="w-full max-w-md" src={track.audioUrl} />

      {videoMeta && (
        <p class="text-xs text-base-content/55">
          Source : {videoMeta.provider}
          {videoMeta.usedPortrait ? " · portrait" : ""}
          {videoMeta.usedCover ? " · jaquette" : ""}
          {videoMeta.warning ? ` — ${videoMeta.warning}` : ""}
        </p>
      )}

      <div class="animate-rise grid gap-6 border-t border-base-content/10 pt-5 md:grid-cols-[220px_1fr]">
        <div class="space-y-3">
          {videoUrl ? (
            <video
              class="mx-auto aspect-[9/16] w-full max-w-[220px] rounded-xl bg-base-200 object-cover shadow-xl"
              src={videoUrl}
              controls
              playsInline
            />
          ) : (
            <div class="relative mx-auto aspect-[9/16] w-full max-w-[220px] overflow-hidden rounded-xl bg-gradient-to-b from-secondary/40 via-primary/30 to-base-200 shadow-xl">
              {(cover?.imageUrl || artist?.imageUrl) && (
                <img
                  src={cover?.imageUrl || artist?.imageUrl}
                  alt=""
                  class="absolute inset-0 h-full w-full object-cover opacity-50"
                />
              )}
              <div class="absolute inset-x-3 top-1/3 space-y-2 text-center">
                <p class="font-display text-sm font-bold">{track?.title}</p>
                <p class="text-[10px] text-base-content/70">{artist?.name}</p>
                {social?.hook && <p class="text-[10px] text-primary">{social.hook}</p>}
              </div>
            </div>
          )}
          {videoUrl && (
            <a class="btn btn-secondary btn-sm w-full gap-1" href={videoUrl} download>
              <Download size={14} /> Télécharger
            </a>
          )}
        </div>

        <div class="space-y-3">
          {social ? (
            <>
              <p class="text-sm font-medium">Scènes du clip</p>
              <ol class="list-decimal space-y-1 pl-5 text-sm text-base-content/75">
                {(social.scenes || []).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {social.hook && (
                <p class="text-sm text-primary">Hook : {social.hook}</p>
              )}
            </>
          ) : (
            <p class="text-sm text-base-content/55">
              Commence par le pack scènes, puis lance Veo.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
