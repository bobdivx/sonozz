import { useState } from "preact/hooks";
import { Clapperboard, Share2, Download, Copy, Film, AudioLines, Rocket, Sparkles } from "lucide-preact";
import { renderShortVideo, downloadBlob } from "../../lib/renderShort.js";
import { api } from "../../lib/apiClient.js";
import { loadKeys, saveKeys } from "../../lib/keys.js";

function hasAudio(track) {
  return Boolean(track?.audioUrl);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Lecture vidéo impossible"));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = String(dataUrl).split(",");
  const mime = meta.match(/data:([^;]+)/)?.[1] || "video/mp4";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export default function SocialStep({
  social,
  artist,
  track,
  cover,
  lyrics,
  loading,
  onGenerate,
  onPublish,
  published,
  onGoToTracks,
  onSocialUpdate,
}) {
  const [rendering, setRendering] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoBlob, setVideoBlob] = useState(null);
  const [videoMeta, setVideoMeta] = useState(null);
  const [error, setError] = useState("");
  const [publishResult, setPublishResult] = useState(null);

  const keys = loadKeys();
  const hasTikTok = Boolean(
    keys.tiktokAccessToken?.trim() ||
      (keys.tiktokClientKey?.trim() && keys.tiktokRefreshToken?.trim()),
  );
  const hasWebhook = Boolean(keys.socialWebhookUrl?.trim());
  const canAutoPublish = hasTikTok || hasWebhook;
  const hasPortrait = Boolean(artist?.imageUrl && !/^data:image\/svg/i.test(artist.imageUrl));
  const hasCover = Boolean(cover?.imageUrl && !/^data:image\/svg/i.test(cover.imageUrl));

  const trackReady = Boolean(track);
  const audioReady = hasAudio(track);

  async function copyCaption() {
    if (!social?.caption) return;
    const tags = (social.hashtags || [])
      .map((h) => (h.startsWith("#") ? h : `#${h}`))
      .join(" ");
    await navigator.clipboard.writeText(`${social.caption}\n\n${tags}`.trim());
  }

  async function renderWithVeo() {
    setError("");
    setPublishResult(null);
    setRendering(true);
    setProgress(5);
    try {
      const data = await api.veoShort({
        artist,
        track,
        cover,
        social,
        lyrics,
      });
      setProgress(100);
      const blob = dataUrlToBlob(data.videoBase64 || data.videoUrl);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      setVideoBlob(blob);
      setVideoMeta({
        provider: data.provider,
        usedPortrait: data.usedPortrait,
        usedCover: data.usedCover,
        warning: data.warning,
      });
      onSocialUpdate?.({
        ...social,
        veo: {
          provider: data.provider,
          prompt: data.prompt,
          at: new Date().toISOString(),
        },
      });
      return blob;
    } catch (e) {
      throw e;
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
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      setVideoBlob(blob);
      setVideoMeta({ provider: "canvas-fallback" });
      return blob;
    } finally {
      setRendering(false);
    }
  }

  async function renderVideo({ preferVeo = true } = {}) {
    if (!audioReady) {
      setError("Crée d'abord le morceau audio (étape 4).");
      return null;
    }
    if (!social) {
      setError("Génère d’abord le pack short (bouton 1).");
      return null;
    }
    if (preferVeo && !hasPortrait) {
      setError("Portrait artiste photo requis pour Veo 3 — régénère l’étape Artiste.");
      return null;
    }

    try {
      if (preferVeo) return await renderWithVeo();
      return await renderWithCanvas();
    } catch (e) {
      if (preferVeo) {
        setError(`Veo: ${e.message} — bascule sur rendu local…`);
        try {
          return await renderWithCanvas();
        } catch (e2) {
          setError(`Veo KO · Canvas KO: ${e2.message}`);
          return null;
        }
      }
      setError(e.message || "Rendu vidéo impossible");
      return null;
    }
  }

  async function exportOnly() {
    const blob = videoBlob || (await renderVideo({ preferVeo: true }));
    if (!blob) return;
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    const safe = (track?.title || "short").replace(/[^\w\-]+/g, "_").slice(0, 40);
    downloadBlob(blob, `${safe}-9x16.${ext}`);
    onPublish?.();
  }

  async function publishNetworks(blob) {
    setPublishing(true);
    setError("");
    try {
      const videoBase64 = await blobToBase64(blob);
      const result = await api.publishShort({
        videoBase64,
        social,
        artist,
        track,
        targets: { tiktok: true, webhook: true },
      });
      if (result.tiktokTokens) {
        saveKeys({ ...loadKeys(), ...result.tiktokTokens });
      }
      setPublishResult(result);
      onSocialUpdate?.({
        ...social,
        publish: result,
        publishedAt: new Date().toISOString(),
      });
      onPublish?.();
    } catch (e) {
      setError(e.message || "Publication impossible");
    } finally {
      setPublishing(false);
    }
  }

  async function renderAndPublish() {
    if (!canAutoPublish) {
      setError("Configure TikTok (Client Key + Secret, puis Connecter) et/ou un webhook dans Paramètres.");
      return;
    }
    const blob = videoBlob || (await renderVideo({ preferVeo: true }));
    if (!blob) return;
    await publishNetworks(blob);
  }

  if (!trackReady || !audioReady) {
    return (
      <section class="animate-rise space-y-6">
        <header class="space-y-2">
          <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Shorts Veo & diffusion</h2>
          <p class="max-w-xl text-base-content/70">
            Audio + portrait + jaquette → clip Veo 3 (9:16) fidèle à l’artiste.
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
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Shorts Veo & diffusion</h2>
        <p class="max-w-xl text-base-content/70">
          Veo 3.1 génère le clip en respectant le <strong>portrait</strong>, la <strong>jaquette</strong> et le thème du titre.
        </p>
      </header>

      <div class="grid gap-2 border border-base-content/10 bg-base-200/40 p-3 text-sm sm:grid-cols-3">
        <p class={hasPortrait ? "text-success" : "text-warning"}>
          Portrait artiste {hasPortrait ? "✓" : "✗ requis"}
        </p>
        <p class={hasCover ? "text-success" : "text-base-content/50"}>
          Jaquette {hasCover ? "✓" : "· optionnelle"}
        </p>
        <p class={canAutoPublish ? "text-success" : "text-warning"}>
          Diffusion {canAutoPublish ? "✓" : "✗ (TikTok/webhook)"}
        </p>
      </div>

      <div class="flex flex-wrap gap-3">
        <button class="btn btn-outline gap-2" disabled={loading} onClick={onGenerate}>
          {loading ? <span class="loading loading-spinner loading-sm" /> : <Clapperboard size={18} />}
          {loading ? "Script…" : "1. Pack caption / scènes"}
        </button>
        <button
          class="btn btn-secondary gap-2"
          disabled={!social || rendering || publishing || !hasPortrait}
          onClick={() => renderVideo({ preferVeo: true })}
        >
          {rendering ? <span class="loading loading-spinner loading-sm" /> : <Sparkles size={18} />}
          {rendering ? `Veo ${progress}%…` : "2. Générer clip Veo 3"}
        </button>
        <button
          class="btn btn-primary gap-2"
          disabled={!social || rendering || publishing || !canAutoPublish || !hasPortrait}
          onClick={renderAndPublish}
        >
          {rendering || publishing ? (
            <span class="loading loading-spinner loading-sm" />
          ) : (
            <Rocket size={18} />
          )}
          {publishing ? "Diffusion…" : rendering ? `Veo ${progress}%…` : "3. Veo + diffuser auto"}
        </button>
        <button class="btn btn-ghost gap-2" disabled={!social || rendering} onClick={exportOnly}>
          <Film size={18} /> Export fichier
        </button>
        <button class="btn btn-ghost gap-2" disabled={!social} onClick={copyCaption}>
          <Copy size={18} /> Caption
        </button>
      </div>

      {error && <p class="text-sm text-error">{error}</p>}
      {rendering && (
        <div class="space-y-1">
          <p class="text-xs text-base-content/50">Veo peut prendre 1–3 min…</p>
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

      {publishResult && (
        <div class="border border-base-content/10 bg-base-200/50 p-4 space-y-2">
          <p class="font-medium">Diffusion : {publishResult.status}</p>
          {(publishResult.results || []).map((r) => (
            <p
              key={r.platform}
              class={`text-sm ${r.ok ? "text-success" : r.skipped ? "text-base-content/50" : "text-error"}`}
            >
              {r.platform} — {r.message}
            </p>
          ))}
        </div>
      )}

      {social && (
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
                  {social.hook && <p class="text-[10px] text-primary">{social.hook}</p>}
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
            <p class="text-sm text-base-content/55">{(social.platforms || []).join(" · ")}</p>
            <ol class="list-decimal space-y-1 pl-5 text-sm text-base-content/75">
              {(social.scenes || []).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <textarea
              class="textarea textarea-bordered min-h-28 w-full bg-base-200 text-sm"
              value={social.caption}
              readOnly
            />
            {published && (
              <p class="inline-flex items-center gap-2 text-xs text-success">
                <Share2 size={12} /> Export / diffusion marqué
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
