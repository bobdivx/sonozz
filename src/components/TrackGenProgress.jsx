import { Check } from "lucide-preact";
import StudioGpuMeter from "./StudioGpuMeter.jsx";
import { resolveTrackGenStepState } from "../lib/trackGenSteps.js";

/**
 * Barre de progression + stepper d’étapes pour la génération audio.
 */
export default function TrackGenProgress({ progress, compact = false }) {
  if (!progress || typeof progress.percent !== "number") return null;

  const { steps, activeIndex, done } = resolveTrackGenStepState(progress);
  const pct = Math.max(4, Math.min(100, progress.percent));
  const detail = [progress.modelLabel || progress.model, progress.message]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      class={`space-y-2.5 rounded-lg border border-primary/25 bg-primary/5 ${
        compact ? "px-2.5 py-2" : "px-3 py-3"
      }`}
      aria-live="polite"
      aria-busy={!done}
    >
      <ol
        class={`flex w-full ${compact ? "gap-0.5" : "gap-1"}`}
        aria-label="Étapes de génération"
      >
        {steps.map((step, i) => {
          const isDone = done || i < activeIndex;
          const isActive = !done && i === activeIndex;
          return (
            <li key={step.id} class="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div class="flex w-full items-center">
                {i > 0 ? (
                  <span
                    class={`h-px flex-1 transition-colors duration-500 ${
                      isDone || isActive ? "bg-primary/70" : "bg-base-content/15"
                    }`}
                    aria-hidden="true"
                  />
                ) : (
                  <span class="flex-1" aria-hidden="true" />
                )}
                <span
                  class={`relative flex shrink-0 items-center justify-center rounded-full border transition-all duration-400 ${
                    compact ? "h-5 w-5" : "h-6 w-6"
                  } ${
                    isDone
                      ? "border-success bg-success text-success-content"
                      : isActive
                        ? "border-primary bg-primary text-primary-content track-gen-step-active"
                        : "border-base-content/20 bg-base-300 text-base-content/40"
                  }`}
                  title={step.label}
                >
                  {isDone ? (
                    <Check size={compact ? 10 : 12} strokeWidth={3} />
                  ) : (
                    <span class={`${compact ? "text-[8px]" : "text-[9px]"} font-semibold`}>
                      {i + 1}
                    </span>
                  )}
                </span>
                {i < steps.length - 1 ? (
                  <span
                    class={`h-px flex-1 transition-colors duration-500 ${
                      isDone ? "bg-primary/70" : "bg-base-content/15"
                    }`}
                    aria-hidden="true"
                  />
                ) : (
                  <span class="flex-1" aria-hidden="true" />
                )}
              </div>
              <span
                class={`max-w-full truncate text-center leading-tight ${
                  compact ? "text-[8px]" : "text-[10px]"
                } ${
                  isActive
                    ? "font-medium text-primary"
                    : isDone
                      ? "text-success/80"
                      : "text-base-content/40"
                }`}
              >
                {compact ? step.short : step.label}
              </span>
            </li>
          );
        })}
      </ol>

      <div class="h-2 overflow-hidden rounded-full bg-base-300">
        <div
          class={`h-full rounded-full bg-primary transition-[width] duration-500 ${
            !done && pct < 95 ? "pipeline-progress-glow" : ""
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {detail ? (
        <p
          class={`text-base-content/70 ${compact ? "text-[10px] leading-snug" : "text-xs"}`}
        >
          <span class="tabular-nums text-base-content/50">{Math.round(pct)}%</span>
          {" — "}
          {detail}
        </p>
      ) : null}

      {!compact && progress.gpu ? <StudioGpuMeter gpu={progress.gpu} /> : null}
      {compact && progress.gpu ? (
        <StudioGpuMeter className="mt-0.5" gpu={progress.gpu} />
      ) : null}
    </div>
  );
}
