import { useEffect, useState } from "preact/hooks";
import { Check, Plus, Trash2, Film } from "lucide-preact";
import { resolveClipBlob } from "../lib/clipStore.js";
import { CLIP_KIND_FULL, isClipReady } from "../lib/clipsModel.js";

function clipLabel(clip, index) {
  if (clip?.fileName) return clip.fileName;
  if (clip?.provider === "user-upload") return `Import ${index + 1}`;
  if (clip?.provider === "canvas-fallback") return `Maquette ${index + 1}`;
  if (clip?.provider) return `${clip.provider} ${index + 1}`;
  return `Clip ${index + 1}`;
}

/** Cache session : posters JPEG (évite de recharger les MP4 à chaque clic). */
const posterCache = new Map();

function cacheKey(clip) {
  return `${clip.id}:${clip.at || ""}:${clip.s3Key || clip.videoUrl || ""}`;
}

function revokePoster(key) {
  const prev = posterCache.get(key);
  if (prev?.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(prev);
    } catch {
      /* ignore */
    }
  }
  posterCache.delete(key);
}

export function forgetClipPoster(clipId) {
  for (const key of [...posterCache.keys()]) {
    if (key.startsWith(`${clipId}:`)) revokePoster(key);
  }
}

function mediaToPosterUrl(src, { revokeSrc = false } = {}) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    let settled = false;

    const cleanupSrc = () => {
      if (revokeSrc) {
        try {
          URL.revokeObjectURL(src);
        } catch {
          /* ignore */
        }
      }
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      cleanupSrc();
      resolve(null);
    };

    const capture = () => {
      if (settled) return;
      try {
        const w = video.videoWidth || 0;
        const h = video.videoHeight || 0;
        if (!w || !h) {
          fail();
          return;
        }
        const maxW = 320;
        const cw = Math.min(w, maxW);
        const ch = Math.round((cw * h) / w);
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        canvas.getContext("2d").drawImage(video, 0, 0, cw, ch);
        canvas.toBlob(
          (out) => {
            cleanupSrc();
            if (!out) {
              settled = true;
              resolve(null);
              return;
            }
            settled = true;
            resolve(URL.createObjectURL(out));
          },
          "image/jpeg",
          0.72,
        );
      } catch {
        fail();
      }
    };

    video.onerror = fail;
    video.onloadeddata = () => {
      try {
        if (video.seekable?.length) {
          video.currentTime = Math.min(0.15, (video.duration || 1) * 0.05);
        } else {
          capture();
        }
      } catch {
        capture();
      }
    };
    video.onseeked = capture;
    video.src = src;
  });
}

function blobToPosterUrl(blob) {
  return mediaToPosterUrl(URL.createObjectURL(blob), { revokeSrc: true });
}

/**
 * Galerie multi-clips : miniatures image (légères), sélection différée, suppression.
 */
export default function ClipGallery({
  clips = [],
  activeClipId = null,
  projectId,
  disabled = false,
  showNew = false,
  newLabel = "Nouveau",
  selectLabel = "À diffuser",
  emptyLabel = "Aucune vidéo",
  onSelect,
  onRemove,
  onNew,
}) {
  const [posters, setPosters] = useState(() => {
    const init = {};
    for (const clip of clips) {
      const key = cacheKey(clip);
      if (posterCache.has(key)) init[clip.id] = posterCache.get(key);
    }
    return init;
  });
  const [localActive, setLocalActive] = useState(activeClipId);

  useEffect(() => {
    setLocalActive(activeClipId);
  }, [activeClipId]);

  const signature = clips.map((c) => cacheKey(c)).join("|");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const next = {};
      for (const clip of clips) {
        const key = cacheKey(clip);
        if (posterCache.has(key)) next[clip.id] = posterCache.get(key);
      }
      if (!cancelled) setPosters(next);

      for (const clip of clips) {
        if (!clip?.id || cancelled) continue;
        const key = cacheKey(clip);
        if (posterCache.has(key)) continue;

        let poster = null;
        try {
          if (typeof clip.videoUrl === "string" && /^https?:\/\//i.test(clip.videoUrl)) {
            // Range/metadata navigateur — pas de téléchargement blob complet
            poster = await mediaToPosterUrl(clip.videoUrl);
          } else {
            const blob = await resolveClipBlob(projectId, clip);
            if (blob) poster = await blobToPosterUrl(blob);
          }
        } catch {
          poster = null;
        }

        if (cancelled) return;
        if (poster) {
          posterCache.set(key, poster);
          next[clip.id] = poster;
          setPosters({ ...next });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, signature]);

  function handleSelect(clipId) {
    if (disabled || clipId === localActive) return;
    // Feedback immédiat (ne bloque pas le handler click sur le gros setState parent)
    setLocalActive(clipId);
    requestAnimationFrame(() => {
      onSelect?.(clipId);
    });
  }

  async function handleRemove(e, clipId) {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || !onRemove) return;
    if (!confirm("Supprimer cette vidéo ?")) return;
    forgetClipPoster(clipId);
    setLocalActive((prev) => (prev === clipId ? null : prev));
    setPosters((prev) => {
      const next = { ...prev };
      delete next[clipId];
      return next;
    });
    // Différé : confirm + IDB + setState ne doivent pas bloquer le handler click
    requestAnimationFrame(() => {
      onRemove(clipId);
    });
  }

  if (!clips.length && !showNew) {
    return (
      <p class="rounded-xl border border-dashed border-base-content/20 bg-base-200/30 px-4 py-8 text-center text-sm text-base-content/55">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {clips.map((clip, i) => {
        const selected = clip.id === localActive;
        const poster = posters[clip.id];
        const ready = isClipReady(clip);
        const isFull = clip.kind === CLIP_KIND_FULL;
        const aspect = isFull ? "aspect-video" : "aspect-[9/16]";

        return (
          <div
            key={clip.id}
            class={`group relative overflow-hidden rounded-xl border transition ${
              selected
                ? "border-primary ring-2 ring-primary/40"
                : "border-base-content/12 hover:border-base-content/30"
            }`}
          >
            <button
              type="button"
              class={`relative block w-full ${aspect} bg-base-300 text-left`}
              disabled={disabled}
              onClick={() => handleSelect(clip.id)}
              title={selected ? selectLabel : "Sélectionner pour diffuser"}
            >
              {poster ? (
                <img
                  class="absolute inset-0 h-full w-full object-cover"
                  src={poster}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span class="absolute inset-0 flex flex-col items-center justify-center gap-1 text-base-content/40">
                  <Film size={28} />
                  <span class="text-[10px] uppercase tracking-wide">
                    {ready ? "…" : "Indispo"}
                  </span>
                </span>
              )}

              <span class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pb-2 pt-6">
                <span class="block truncate text-xs font-medium text-white">
                  {clipLabel(clip, i)}
                </span>
                <span class="text-[10px] text-white/70">
                  {isFull ? "Full" : "Short"}
                  {clip.durationSec ? ` · ${clip.durationSec}s` : ""}
                </span>
              </span>

              {selected && (
                <span class="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-content">
                  <Check size={10} /> {selectLabel}
                </span>
              )}

              {clip.provider === "canvas-fallback" && (
                <span class="absolute right-2 top-2 rounded-md bg-warning/90 px-1.5 py-0.5 text-[10px] font-medium text-warning-content">
                  Maquette
                </span>
              )}
            </button>

            {onRemove && (
              <button
                type="button"
                class="btn btn-circle btn-error btn-xs absolute bottom-2 right-2 z-10 shadow-md"
                disabled={disabled}
                onClick={(e) => handleRemove(e, clip.id)}
                title="Supprimer"
                aria-label="Supprimer la vidéo"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        );
      })}

      {showNew && (
        <button
          type="button"
          class="flex aspect-[9/16] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-base-content/25 bg-base-200/40 text-base-content/60 transition hover:border-primary/50 hover:text-primary"
          disabled={disabled}
          onClick={onNew}
        >
          <Plus size={28} />
          <span class="text-xs font-medium">{newLabel}</span>
        </button>
      )}
    </div>
  );
}

export { clipLabel };
