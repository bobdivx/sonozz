/**
 * Jauge VRAM compacte (ACE-Step / SongGen).
 * Affiche uniquement l’état GPU — le message parent porte phase / modèle.
 * @param {{ gpu?: { freeGb?: number|null, totalGb?: number|null, name?: string|null }|null, className?: string }} props
 */
export default function StudioGpuMeter({ gpu = null, className = "" }) {
  const freeGb = Number(gpu?.freeGb);
  const totalGb = Number(gpu?.totalGb);
  const hasGpu = Number.isFinite(freeGb) && Number.isFinite(totalGb) && totalGb > 0;
  if (!hasGpu) return null;

  const usedGb = Math.max(0, Math.round((totalGb - freeGb) * 10) / 10);
  const usedPct = Math.min(100, Math.max(0, (usedGb / totalGb) * 100));
  const tight = freeGb < 2.5;

  return (
    <div class={`space-y-1 ${className}`.trim()}>
      <p class={`text-[10px] leading-snug ${tight ? "text-warning" : "text-base-content/60"}`}>
        <span class="font-medium text-base-content/75">
          {usedGb} Go utilisés
        </span>
        <span class="opacity-80">
          {" "}
          · {freeGb} libres / {totalGb} Go
        </span>
        {gpu?.name ? <span class="opacity-50"> · {gpu.name}</span> : null}
      </p>
      <div
        class="h-1.5 overflow-hidden rounded-full bg-base-300"
        title={`${usedGb} Go utilisés · ${freeGb} libres / ${totalGb} Go`}
      >
        <div
          class={`h-full transition-[width] duration-500 ${
            tight ? "bg-warning" : "bg-primary/80"
          }`}
          style={{ width: `${Math.max(4, usedPct)}%` }}
        />
      </div>
    </div>
  );
}
