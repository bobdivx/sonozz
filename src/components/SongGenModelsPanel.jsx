import { Download, Trash2, XCircle, Zap } from "lucide-preact";

function statusLabel(status) {
  switch (status) {
    case "ready":
      return "Prêt";
    case "downloading":
      return "Téléchargement…";
    case "not_downloaded":
      return "Absent";
    case "error":
      return "Erreur";
    default:
      return status || "—";
  }
}

function shortName(model) {
  const id = String(model?.id || "");
  if (id.includes("large")) return "Large";
  if (id.includes("base_full")) return "Base Full";
  if (id.includes("base_new")) return "Base New";
  if (id.includes("base")) return "Base";
  return model?.qualityLabel || model?.name || id;
}

/**
 * Liste / actions modèles SongGeneration Studio.
 */
export default function SongGenModelsPanel({
  models = [],
  pickedModelId = null,
  preferredModelId = null,
  gpu = null,
  busyId = null,
  disabled = false,
  error = "",
  onDownload,
  onCancelDownload,
  onDelete,
  onUse,
}) {
  if (!models.length) {
    return (
      <p class="text-xs text-base-content/50">
        Catalogue modèles indisponible — Retester la connexion Studio.
      </p>
    );
  }

  const freeGb = gpu?.freeGb;
  const totalGb = gpu?.totalGb;

  return (
    <div class="space-y-2">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <p class="text-xs font-medium uppercase tracking-wide text-base-content/55">
          Modèles Studio
        </p>
        <p class="text-xs text-base-content/55">
          {pickedModelId && (
            <>
              Utilisé :{" "}
              <span class="text-base-content/80">{shortName({ id: pickedModelId })}</span>
            </>
          )}
          {freeGb != null && totalGb != null && (
            <span class="ml-2 opacity-80">
              · VRAM {freeGb}/{totalGb} Go
            </span>
          )}
        </p>
      </div>

      {pickedModelId !== "songgeneration_large" &&
        models.some((m) => m.id === "songgeneration_large" && m.status === "ready") && (
          <p class="rounded bg-warning/15 px-2.5 py-1.5 text-xs text-warning-content/90">
            Large est prêt mais Studio le refuse sous 22 Go libres (tu as ~
            {freeGb ?? "?"} Go). SONOZZ peut le forcer — bouton{" "}
            <strong>Utiliser</strong> sur Large.
          </p>
        )}

      <ul class="divide-y divide-base-content/10 overflow-hidden rounded border border-base-content/10 bg-base-300/20">
        {models.map((m) => {
          const isBusy = busyId === m.id;
          const isPicked = m.isPicked || m.id === pickedModelId;
          const isPreferred = preferredModelId === m.id;
          const canDownload =
            m.status === "not_downloaded" || m.status === "error" || m.status === "unknown";
          const canCancel = m.status === "downloading";
          const canDelete = m.status === "ready";
          const canUse = m.status === "ready" && !isPicked;

          return (
            <li key={m.id} class="space-y-1.5 px-3 py-2.5">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0 space-y-0.5">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="font-medium text-sm">{shortName(m)}</span>
                    {isPicked && (
                      <span class="badge badge-primary badge-xs">utilisé</span>
                    )}
                    {isPreferred && !isPicked && (
                      <span class="badge badge-secondary badge-xs">préféré</span>
                    )}
                    {m.isLoaded && (
                      <span class="badge badge-accent badge-xs">en VRAM</span>
                    )}
                    {m.id.includes("large") && m.status === "ready" && !isPicked && (
                      <span class="badge badge-ghost badge-xs">meilleure qualité</span>
                    )}
                  </div>
                  <p class="text-xs text-base-content/55">
                    {statusLabel(m.status)}
                    {m.vramRequired ? ` · ≥${m.vramRequired} Go VRAM` : ""}
                    {m.sizeGb ? ` · ~${m.sizeGb} Go disque` : ""}
                    {m.qualityLabel ? ` · ${m.qualityLabel}` : ""}
                  </p>
                </div>

                <div class="flex flex-wrap items-center gap-1">
                  {canUse && (
                    <button
                      type="button"
                      class="btn btn-primary btn-xs gap-1"
                      disabled={disabled || isBusy}
                      title="Forcer ce modèle pour les prochaines générations"
                      onClick={() => onUse?.(m.id)}
                    >
                      {isBusy ? (
                        <span class="loading loading-spinner loading-xs" />
                      ) : (
                        <Zap size={12} />
                      )}
                      Utiliser
                    </button>
                  )}
                  {canDownload && (
                    <button
                      type="button"
                      class="btn btn-primary btn-xs gap-1"
                      disabled={disabled || isBusy}
                      onClick={() => onDownload?.(m.id)}
                    >
                      {isBusy ? (
                        <span class="loading loading-spinner loading-xs" />
                      ) : (
                        <Download size={12} />
                      )}
                      Télécharger
                    </button>
                  )}
                  {canCancel && (
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs gap-1"
                      disabled={disabled || isBusy}
                      onClick={() => onCancelDownload?.(m.id)}
                    >
                      {isBusy ? (
                        <span class="loading loading-spinner loading-xs" />
                      ) : (
                        <XCircle size={12} />
                      )}
                      Annuler
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs gap-1 text-error"
                      disabled={disabled || isBusy}
                      title="Supprimer du disque Studio"
                      onClick={() => {
                        const label = shortName(m);
                        if (
                          typeof window !== "undefined" &&
                          !window.confirm(
                            `Supprimer ${label} du disque Studio ? (~${m.sizeGb || "?"} Go).`,
                          )
                        ) {
                          return;
                        }
                        onDelete?.(m.id);
                      }}
                    >
                      {isBusy ? (
                        <span class="loading loading-spinner loading-xs" />
                      ) : (
                        <Trash2 size={12} />
                      )}
                      Supprimer
                    </button>
                  )}
                </div>
              </div>

              {m.status === "downloading" && (
                <div class="space-y-1">
                  <div class="flex justify-between gap-2 text-[11px] text-base-content/55">
                    <span>
                      {typeof m.progress === "number" ? `${Math.round(m.progress)}%` : "…"}
                      {typeof m.downloadedGb === "number" && typeof m.totalGb === "number"
                        ? ` · ${m.downloadedGb.toFixed(1)}/${m.totalGb.toFixed(1)} Go`
                        : ""}
                      {typeof m.speedMbps === "number" ? ` · ${Math.round(m.speedMbps)} Mo/s` : ""}
                    </span>
                    {typeof m.etaSeconds === "number" && m.etaSeconds > 0 && (
                      <span>~{Math.ceil(m.etaSeconds / 60)} min</span>
                    )}
                  </div>
                  <progress
                    class="progress progress-primary h-1.5 w-full"
                    value={typeof m.progress === "number" ? m.progress : 0}
                    max="100"
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && <p class="text-xs text-error">{error}</p>}
      <p class="text-xs text-base-content/45">
        Studio refuse Large sous 22 Go libres. Sur 3090 (~20 Go libres typiques), SONOZZ force
        Large automatiquement ou via Utiliser.
      </p>
    </div>
  );
}
