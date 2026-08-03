import { useEffect, useState } from "preact/hooks";
import {
  Share2,
  Download,
  Copy,
  Film,
  Rocket,
  Clapperboard,
  Settings2,
} from "lucide-preact";
import { downloadBlob } from "../../lib/renderShort.js";
import { api } from "../../lib/apiClient.js";
import { loadKeys, saveKeys } from "../../lib/keys.js";

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
  clip,
  artist,
  track,
  cover,
  loading,
  onGenerate,
  onPublish,
  published,
  onGoToClip,
  onConfigure,
  onSocialUpdate,
}) {
  const [publishing, setPublishing] = useState(false);
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoBlob, setVideoBlob] = useState(null);
  const [error, setError] = useState("");
  const [publishResult, setPublishResult] = useState(null);

  const keys = loadKeys();
  const hasTikTok = Boolean(
    keys.tiktokAccessToken?.trim() ||
      (keys.tiktokClientKey?.trim() && keys.tiktokRefreshToken?.trim()),
  );
  const hasWebhook = Boolean(keys.socialWebhookUrl?.trim());
  const canAutoPublish = hasTikTok || hasWebhook;
  const hasClip = Boolean(clip?.videoBase64 || clip?.videoUrl);

  useEffect(() => {
    const src = clip?.videoBase64 || clip?.videoUrl;
    if (!src) {
      setVideoBlob(null);
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return undefined;
    }
    try {
      const blob = dataUrlToBlob(src);
      const url = URL.createObjectURL(blob);
      setVideoBlob(blob);
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch {
      setError("Clip vidéo illisible — régénère-le à l’étape Clip.");
    }
    return undefined;
  }, [clip?.videoBase64, clip?.videoUrl]);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  async function copyCaption() {
    if (!social?.caption) return;
    const tags = (social.hashtags || [])
      .map((h) => (h.startsWith("#") ? h : `#${h}`))
      .join(" ");
    await navigator.clipboard.writeText(`${social.caption}\n\n${tags}`.trim());
  }

  function exportFile() {
    if (!videoBlob) {
      setError("Aucun clip — génère-le d’abord à l’étape Clip.");
      return;
    }
    const ext = videoBlob.type.includes("mp4") ? "mp4" : "webm";
    const safe = (track?.title || "short").replace(/[^\w\-]+/g, "_").slice(0, 40);
    downloadBlob(videoBlob, `${safe}-9x16.${ext}`);
  }

  async function publishNetworks() {
    if (!canAutoPublish) {
      setError("Configure TikTok et/ou un webhook dans Paramètres.");
      return;
    }
    if (!videoBlob && !clip?.videoBase64) {
      setError("Aucun clip — génère-le d’abord à l’étape Clip.");
      return;
    }
    if (!social) {
      setError("Génère d’abord le pack caption.");
      return;
    }

    setPublishing(true);
    setError("");
    try {
      const videoBase64 =
        clip?.videoBase64 || clip?.videoUrl || (await blobToBase64(videoBlob));
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

  if (!hasClip) {
    return (
      <section class="animate-rise space-y-6">
        <header class="space-y-2">
          <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Réseaux</h2>
          <p class="max-w-xl text-base-content/70">
            Diffuse le clip vers TikTok ou un webhook (Activepieces / Make).
          </p>
        </header>
        <div class="border border-warning/40 bg-warning/10 p-5">
          <p class="font-display text-lg font-semibold text-warning">Aucun clip prêt</p>
          <p class="mt-1 text-sm text-base-content/70">
            Génère d’abord le short à l’étape Clip (Veo 3).
          </p>
          <button type="button" class="btn btn-primary mt-4 gap-2" onClick={onGoToClip}>
            <Film size={18} />
            Aller à l’étape Clip
          </button>
        </div>
      </section>
    );
  }

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Réseaux</h2>
        <p class="max-w-xl text-base-content/70">
          Caption + hashtags, puis diffusion auto TikTok / webhook.
        </p>
      </header>

      <div class="grid gap-2 border border-base-content/10 bg-base-200/40 p-3 text-sm sm:grid-cols-3">
        <p class="text-success">Clip prêt ✓</p>
        <p class={social?.caption ? "text-success" : "text-warning"}>
          Caption {social?.caption ? "✓" : "✗ à générer"}
        </p>
        <p class={canAutoPublish ? "text-success" : "text-warning"}>
          Diffusion {canAutoPublish ? "✓" : "✗ (TikTok/webhook)"}
        </p>
      </div>

      <div class="flex flex-wrap gap-3">
        <button class="btn btn-outline gap-2" disabled={loading || publishing} onClick={onGenerate}>
          {loading ? <span class="loading loading-spinner loading-sm" /> : <Clapperboard size={18} />}
          {loading ? "Caption…" : social ? "Regénérer caption" : "1. Pack caption"}
        </button>
        <button
          class="btn btn-primary gap-2"
          disabled={!social || publishing || !canAutoPublish}
          onClick={publishNetworks}
        >
          {publishing ? <span class="loading loading-spinner loading-sm" /> : <Rocket size={18} />}
          {publishing ? "Diffusion…" : "2. Diffuser auto"}
        </button>
        <button class="btn btn-ghost gap-2" disabled={!videoBlob} onClick={exportFile}>
          <Download size={18} /> Export fichier
        </button>
        <button class="btn btn-ghost gap-2" disabled={!social} onClick={copyCaption}>
          <Copy size={18} /> Copier caption
        </button>
        {!canAutoPublish && (
          <button type="button" class="btn btn-ghost gap-2" onClick={onConfigure}>
            <Settings2 size={18} /> Configurer TikTok
          </button>
        )}
      </div>

      {error && <p class="text-sm text-error">{error}</p>}

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
            </div>
          )}
          {clip?.provider && (
            <p class="text-center text-[10px] text-base-content/50">{clip.provider}</p>
          )}
          <button type="button" class="btn btn-ghost btn-sm w-full gap-1" onClick={onGoToClip}>
            <Film size={14} /> Modifier le clip
          </button>
        </div>

        <div class="space-y-3">
          <p class="text-sm text-base-content/55">{(social?.platforms || []).join(" · ")}</p>
          {social?.hook && <p class="text-sm text-primary">{social.hook}</p>}
          <textarea
            class="textarea textarea-bordered min-h-28 w-full bg-base-200 text-sm"
            value={social?.caption || ""}
            readOnly
            placeholder="Génère le pack caption…"
          />
          {(social?.hashtags || []).length > 0 && (
            <p class="text-xs text-base-content/55">
              {(social.hashtags || []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}
            </p>
          )}
          {published && (
            <p class="inline-flex items-center gap-2 text-xs text-success">
              <Share2 size={12} /> Diffusion marquée
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
