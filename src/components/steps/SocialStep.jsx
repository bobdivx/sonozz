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
import {
  ensureClipStorageKey,
  resolveClipBlob,
  deleteClipBlob,
} from "../../lib/clipStore.js";
import {
  CLIP_KIND_FULL,
  CLIP_KIND_SHORT,
  clipBlobKey,
  isClipReady,
  normalizeProjectClips,
} from "../../lib/clipsModel.js";
import {
  formatQuotaReset,
  getTikTokQuota,
  recordTikTokAttempt,
  TIKTOK_PENDING_LIMIT,
} from "../../lib/tiktokQuota.js";
import ClipGallery from "../ClipGallery.jsx";

export default function SocialStep({
  social,
  clip,
  clips = [],
  activeClipId = null,
  projectId,
  artist,
  track,
  cover,
  loading,
  onGenerate,
  onPublish,
  published,
  onGoToClip,
  onConfigure,
  onSelectClip,
  onRemoveClip,
  onSocialUpdate,
}) {
  const [publishing, setPublishing] = useState(false);
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoBlob, setVideoBlob] = useState(null);
  const [error, setError] = useState("");
  const [publishResult, setPublishResult] = useState(null);
  const [loadingClip, setLoadingClip] = useState(false);
  const [tiktokQuota, setTiktokQuota] = useState(() => getTikTokQuota());

  const normalized = normalizeProjectClips({ clip, clips, activeClipId });
  const allClips = normalized.clips.filter(
    (c) => isClipReady(c) || c.provider === "canvas-fallback",
  );
  const active = allClips.find((c) => c.id === normalized.activeClipId) || clip || null;

  const keys = loadKeys();
  const hasTikTok = Boolean(
    keys.tiktokAccessToken?.trim() ||
      (keys.tiktokClientKey?.trim() && keys.tiktokRefreshToken?.trim()),
  );
  const hasWebhook = Boolean(keys.socialWebhookUrl?.trim());
  const canAutoPublish = hasTikTok || hasWebhook;
  const tiktokHasPublishScope = /video\.publish/i.test(keys.tiktokScope || "");
  const hasClip = Boolean(
    allClips.length ||
      active?.storedRemote ||
      active?.storedLocally ||
      active?.videoUrl ||
      active?.s3Key ||
      active?.videoBase64 ||
      active?.provider,
  );
  const clipLooksPromo =
    /promo|canvas-fallback/i.test(String(active?.provider || "")) ||
    /webm/i.test(String(videoBlob?.type || active?.mimeType || ""));
  const clipIsMp4 =
    /mp4/i.test(String(videoBlob?.type || "")) ||
    /mp4/i.test(String(active?.publishMimeType || active?.mimeType || "")) ||
    /\+direct/i.test(String(active?.provider || "")) ||
    (active?.provider === "user-upload" &&
      /mp4|quicktime/i.test(
        String(videoBlob?.type || active?.mimeType || active?.publishMimeType || ""),
      ));

  useEffect(() => {
    if (!hasClip || !active) {
      setVideoBlob(null);
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return undefined;
    }
    let cancelled = false;
    setLoadingClip(true);
    setError("");
    (async () => {
      try {
        const blob = await resolveClipBlob(projectId, active);
        if (cancelled) return;
        if (!blob) {
          setError(
            active?.s3Key || active?.videoUrl
              ? "Clip distant inaccessible — vérifie S3 sur le serveur ou régénère."
              : "Clip introuvable — régénère-le à l’étape Clip (stockage navigateur vide).",
          );
          setVideoBlob(null);
          return;
        }
        const typed =
          blob.type?.startsWith("video/")
            ? blob
            : new Blob([blob], {
                type: active?.mimeType || active?.publishMimeType || "video/mp4",
              });
        const url = URL.createObjectURL(typed);
        setVideoBlob(typed);
        setVideoUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch {
        if (!cancelled) {
          setError("Clip vidéo illisible — régénère-le à l’étape Clip.");
        }
      } finally {
        if (!cancelled) setLoadingClip(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    active?.id,
    active?.storedLocally,
    active?.storedRemote,
    active?.provider,
    active?.at,
    active?.videoUrl,
    active?.s3Key,
    hasClip,
  ]);

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
    const kind = active?.kind === CLIP_KIND_FULL ? "full" : "short";
    downloadBlob(videoBlob, `${safe}-${kind}-9x16.${ext}`);
  }

  async function publishNetworks() {
    if (!canAutoPublish) {
      setError("Configure TikTok et/ou un webhook dans Paramètres.");
      return;
    }
    if (!videoBlob) {
      setError("Aucun clip — génère-le d’abord à l’étape Clip.");
      return;
    }
    if (!social) {
      setError("Génère d’abord le pack caption.");
      return;
    }
    if (clipLooksPromo && !clipIsMp4) {
      setError(
        "Ce clip est un montage WebM (+promo) : TikTok Inbox n’affiche souvent que la 1ère image. " +
          "Va à Clip → Générer short Veo (MP4), puis republie.",
      );
      return;
    }

    const quota = getTikTokQuota();
    setTiktokQuota(quota);
    const mode = (keys.tiktokPostMode || "direct").toLowerCase();
    // Inbox / Auto brûlent le quota pending ; Direct aussi côté TikTok si non finalisé
    if (hasTikTok && quota.blocked) {
      setError(
        `Quota TikTok local atteint (${quota.used}/${TIKTOK_PENDING_LIMIT} en 24 h). ` +
          `Prochain créneau ${formatQuotaReset(quota.resetsAt)}. ` +
          `Attends, ou finalise les brouillons Inbox dans l’app TikTok.`,
      );
      return;
    }

    setPublishing(true);
    setError("");
    try {
      const useRemoteOnly =
        Boolean(active?.s3Key || /^https?:\/\//i.test(active?.videoUrl || "")) &&
        /mp4/i.test(String(active?.mimeType || active?.publishMimeType || "video/mp4"));

      const result = await api.publishShort({
        videoBlob: useRemoteOnly ? null : videoBlob,
        videoUrl: active?.videoUrl,
        s3Key: active?.s3Key,
        mimeType: videoBlob.type || active?.publishMimeType || active?.mimeType || "video/mp4",
        social,
        artist,
        track,
        targets: { tiktok: true, webhook: true },
      });
      if (result.tiktokTokens) {
        saveKeys({ ...loadKeys(), ...result.tiktokTokens });
      }

      const tiktok = (result.results || []).find((r) => r.platform === "tiktok");
      if (tiktok && !tiktok.skipped) {
        // Compte tout appel TikTok non skip (ok ou erreur après init)
        const nextQuota = recordTikTokAttempt({
          mode: tiktok.mode || mode,
          ok: Boolean(tiktok.ok),
          status: tiktok.status || result.status,
          publishId: tiktok.publishId || "",
          message: tiktok.message || "",
        });
        setTiktokQuota(nextQuota);
      }

      setPublishResult(result);
      onSocialUpdate?.({
        ...social,
        publish: result,
        publishedAt: new Date().toISOString(),
        publishedClipId: active?.id || null,
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
            Génère ou importe d’abord un short à l’étape Clip.
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

      {allClips.length > 0 && (
        <div class="space-y-2">
          <div class="flex items-baseline justify-between gap-3">
            <p class="text-sm font-medium">Choisir la vidéo à diffuser</p>
            <p class="text-xs text-base-content/55">
              {allClips.length} vidéo{allClips.length > 1 ? "s" : ""} disponible
              {allClips.length > 1 ? "s" : ""}
            </p>
          </div>
          <ClipGallery
            clips={allClips}
            activeClipId={active?.id}
            projectId={projectId}
            disabled={publishing || loadingClip}
            selectLabel="À diffuser"
            emptyLabel="Aucune vidéo prête"
            onSelect={(id) => onSelectClip?.(id)}
            onRemove={async (clipId) => {
              const key =
                clipBlobKey(projectId, clipId) || ensureClipStorageKey(projectId, clipId);
              try {
                await deleteClipBlob(key);
              } catch {
                /* ignore */
              }
              onRemoveClip?.(clipId);
            }}
          />
          {active?.kind === CLIP_KIND_FULL && (
            <p class="text-xs text-warning">
              Full sélectionné — TikTok préfère un short 9:16.
            </p>
          )}
        </div>
      )}

      <div class="grid gap-2 border border-base-content/10 bg-base-200/40 p-3 text-sm sm:grid-cols-4">
        <p class={videoBlob ? "text-success" : "text-warning"}>
          Clip {videoBlob ? "prêt ✓" : loadingClip ? "chargement…" : "✗ introuvable"}
          {active?.kind === CLIP_KIND_FULL
            ? " · full"
            : active?.kind === CLIP_KIND_SHORT
              ? " · short"
              : ""}
        </p>
        <p class={social?.caption ? "text-success" : "text-warning"}>
          Caption {social?.caption ? "✓" : "✗ à générer"}
        </p>
        <p
          class={
            hasTikTok && tiktokHasPublishScope
              ? "text-success"
              : hasTikTok
                ? "text-warning"
                : "text-warning"
          }
        >
          TikTok{" "}
          {hasTikTok && tiktokHasPublishScope
            ? "✓ Direct Post"
            : hasTikTok
              ? "✗ reconnecte (video.publish)"
              : "✗ non connecté"}
        </p>
        <p class={tiktokQuota.blocked ? "text-error" : tiktokQuota.remaining <= 2 ? "text-warning" : "text-success"}>
          Quota API {tiktokQuota.used}/{tiktokQuota.limit}
          {tiktokQuota.blocked
            ? ` · reset ${formatQuotaReset(tiktokQuota.resetsAt)}`
            : ` · ${tiktokQuota.remaining} restant(s)`}
        </p>
      </div>

      {tiktokQuota.blocked && (
        <div class="border border-error/40 bg-error/10 p-4 text-sm space-y-1">
          <p class="font-medium text-error">
            Compteur local : {TIKTOK_PENDING_LIMIT} envois TikTok sur 24 h atteints.
          </p>
          <p class="text-base-content/70">
            TikTok refuse souvent au-delà (même si tu as supprimé un brouillon). Prochain essai{" "}
            {formatQuotaReset(tiktokQuota.resetsAt)}.
          </p>
        </div>
      )}

      {clipLooksPromo && (
        <div class="border border-warning/40 bg-warning/10 p-4 text-sm space-y-2">
          <p class="font-medium text-warning">
            Clip type montage (+promo / WebM) — TikTok Inbox montre souvent uniquement la 1ʳᵉ image.
          </p>
          <p class="text-base-content/70">
            Régénère un vrai MP4 Veo à l’étape Clip, puis republie.
          </p>
          <button type="button" class="btn btn-warning btn-sm gap-2" onClick={onGoToClip}>
            <Film size={16} /> Régénérer le short Veo
          </button>
        </div>
      )}

      {hasTikTok && !tiktokHasPublishScope && (
        <div class="border border-warning/40 bg-warning/10 p-4 text-sm space-y-2">
          <p class="font-medium text-warning">
            Token TikTok sans <code>video.publish</code> — Direct Post impossible.
          </p>
          <p class="text-base-content/70">
            Va dans Paramètres → Réseaux → <strong>Reconnecter</strong>. Sur TikTok Developers,
            ajoute le scope <code>video.publish</code> (Content Posting → Direct Post).
          </p>
          <a class="btn btn-warning btn-sm" href="/parametres?section=reseaux">
            Ouvrir Paramètres
          </a>
        </div>
      )}

      <div class="flex flex-wrap gap-3">
        <button class="btn btn-outline gap-2" disabled={loading || publishing} onClick={onGenerate}>
          {loading ? <span class="loading loading-spinner loading-sm" /> : <Clapperboard size={18} />}
          {loading ? "Caption…" : social ? "Regénérer caption" : "1. Pack caption"}
        </button>
        <button
          class="btn btn-primary gap-2"
          disabled={
            !social ||
            publishing ||
            !canAutoPublish ||
            !videoBlob ||
            (hasTikTok && tiktokQuota.blocked)
          }
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
              {r.status ? ` [${r.status}]` : ""}
            </p>
          ))}
          {(publishResult.results || []).some((r) => r.platform === "tiktok" && r.ok) && (
            <p class="text-xs text-base-content/60 pt-1">
              Mode Direct Post : regarde ton <strong>Profil</strong> TikTok (pas l’Inbox). Si
              privacy = SELF_ONLY (app non auditée), la vidéo est privée — visible seulement par toi.
            </p>
          )}
        </div>
      )}

      <div class="animate-rise grid gap-6 border-t border-base-content/10 pt-5 md:grid-cols-[220px_1fr]">
        <div class="space-y-3">
          {videoUrl ? (
            <video
              key={videoUrl}
              class={`mx-auto w-full max-w-[220px] rounded-xl bg-base-200 object-cover shadow-xl ${
                active?.kind === CLIP_KIND_FULL ? "aspect-video" : "aspect-[9/16]"
              }`}
              src={videoUrl}
              controls
              playsInline
              autoPlay={false}
              preload="metadata"
            />
          ) : (
            <div class="relative mx-auto flex aspect-[9/16] w-full max-w-[220px] items-center justify-center overflow-hidden rounded-xl bg-base-300 shadow-xl">
              <p class="px-4 text-center text-xs text-base-content/55">
                {loadingClip ? "Chargement du clip…" : "Aucune vidéo — génère-la à l’étape Clip"}
              </p>
            </div>
          )}
          {active?.provider && (
            <p class="text-center text-[10px] text-base-content/50">
              {active.kind === CLIP_KIND_FULL ? "full" : "short"} · {active.provider}
            </p>
          )}
          <button type="button" class="btn btn-ghost btn-sm w-full gap-1" onClick={onGoToClip}>
            <Film size={14} /> Modifier les clips
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
