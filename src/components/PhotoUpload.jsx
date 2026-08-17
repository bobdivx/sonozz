import { useRef, useState } from "preact/hooks";
import { Camera, Plus, X } from "lucide-preact";
import { filesToJpegDataUrls } from "../lib/photoUpload.js";

/**
 * Upload multi-photos → data URLs JPEG compressées.
 * @param {{
 *   photos?: string[],
 *   max?: number,
 *   disabled?: boolean,
 *   onPhotosChange?: (photos: string[]) => void,
 * }} props
 */
export default function PhotoUpload({
  photos = [],
  max = 4,
  disabled = false,
  onPhotosChange,
}) {
  const inputRef = useRef(null);
  const pickingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onFiles(fileList) {
    if (!fileList?.length || disabled || pickingRef.current) return;
    const room = Math.max(0, max - photos.length);
    if (!room) {
      setError(`Maximum ${max} photos.`);
      return;
    }
    pickingRef.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await filesToJpegDataUrls(Array.from(fileList).slice(0, room));
      onPhotosChange?.([...photos, ...next].slice(0, max));
    } catch (e) {
      setError(e.message || "Import photo impossible");
    } finally {
      pickingRef.current = false;
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeAt(index) {
    onPhotosChange?.(photos.filter((_, i) => i !== index));
  }

  return (
    <div class="space-y-2">
      <span class="label-text mb-1 flex items-center gap-2 text-sm text-base-content/60">
        <Camera size={14} class="text-primary" />
        Tes photos
      </span>
      <p class="text-xs text-base-content/45">
        1 à {max} photos — portrait net de préférence. La première sert de visuel artiste.
      </p>

      <div class="flex flex-wrap gap-2">
        {photos.map((src, i) => (
          <div key={`photo-${i}-${src.length}-${src.slice(-16)}`} class="relative">
            <img
              src={src}
              alt={`Photo ${i + 1}`}
              class="h-24 w-24 object-cover border border-base-content/15"
            />
            {i === 0 && (
              <span class="absolute bottom-1 left-1 bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-content">
                Principale
              </span>
            )}
            <button
              type="button"
              class="btn btn-ghost btn-xs absolute right-0.5 top-0.5 bg-base-300/90"
              disabled={disabled || busy}
              onClick={() => removeAt(i)}
              title="Retirer"
            >
              <X size={12} />
            </button>
          </div>
        ))}

        {photos.length < max && (
          <button
            type="button"
            class="flex h-24 w-24 flex-col items-center justify-center gap-1 border border-dashed border-base-content/25 text-base-content/50 transition hover:border-primary/50 hover:text-primary"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <span class="loading loading-spinner loading-sm" />
            ) : (
              <>
                <Plus size={18} />
                <span class="text-[10px]">Ajouter</span>
              </>
            )}
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        multiple
        class="hidden"
        disabled={disabled || busy}
        onInput={(e) => onFiles(e.currentTarget.files)}
        onChange={(e) => onFiles(e.currentTarget.files)}
      />

      {error && <p class="text-xs text-warning">{error}</p>}
    </div>
  );
}
