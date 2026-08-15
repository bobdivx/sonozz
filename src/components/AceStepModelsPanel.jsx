import { Zap } from "lucide-preact";

function shortName(model) {
  return model?.name || String(model?.id || "").replace(/^.*\//, "") || "—";
}

/**
 * Liste / hot-swap des DiT ACE-Step Studio.
 */
export default function AceStepModelsPanel({
  models = [],
  activeModelId = null,
  preferredModelId = null,
  gpu = null,
  busyId = null,
  disabled = false,
  error = "",
  onUse,
}) {
  if (!models.length) {
    return (
      <p class="text-xs text-base-content/50">
        Catalogue modèles indisponible — Retester la connexion ACE-Step.
      </p>
    );
  }

  const freeGb = gpu?.freeGb;
  const totalGb = gpu?.totalGb;

  return (
    <div class="space-y-2">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <p class="text-xs font-medium uppercase tracking-wide text-base-content/55">
          Modèles ACE-Step
        </p>
        <p class="text-xs text-base-content/55">
          {activeModelId && (
            <>
              Chargé :{" "}
              <span class="text-base-content/80">{shortName({ id: activeModelId })}</span>
            </>
          )}
          {freeGb != null && totalGb != null && (
            <span class="ml-2 opacity-80">
              · VRAM {freeGb}/{totalGb} Go
            </span>
          )}
        </p>
      </div>

      <ul class="divide-y divide-base-content/10 rounded border border-base-content/10">
        {models.map((m) => {
          const active = m.id === activeModelId || m.isActive;
          const preferred = m.id === preferredModelId;
          const ready = m.isPreloaded || m.isActive || m.status === "ready";
          const busy = busyId === m.id;
          return (
            <li key={m.id} class="flex flex-wrap items-center gap-2 px-2.5 py-2 text-sm">
              <div class="min-w-0 flex-1">
                <p class="font-medium">
                  {shortName(m)}
                  {active ? (
                    <span class="ml-1.5 text-[10px] uppercase tracking-wide text-success">actif</span>
                  ) : null}
                  {preferred && !active ? (
                    <span class="ml-1.5 text-[10px] uppercase tracking-wide text-primary">préféré</span>
                  ) : null}
                </p>
                <p class="text-xs text-base-content/50">
                  {ready ? "Prêt" : "Absent du disque — le switch peut le télécharger"}
                  {m.steps ? ` · ${m.steps} steps` : ""}
                  {m.vramGb ? ` · ~${m.vramGb} Go` : ""}
                </p>
              </div>
              <button
                type="button"
                class="btn btn-ghost btn-xs gap-1"
                disabled={disabled || busy || active}
                onClick={() => onUse?.(m.id)}
              >
                {busy ? (
                  <span class="loading loading-spinner loading-xs" />
                ) : (
                  <Zap size={12} />
                )}
                Utiliser
              </button>
            </li>
          );
        })}
      </ul>
      {error ? <p class="text-xs text-error">{error}</p> : null}
    </div>
  );
}
