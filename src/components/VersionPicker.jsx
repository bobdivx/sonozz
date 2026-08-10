import { Check, Trash2 } from "lucide-preact";

/**
 * Liste de versions créatives (paroles / audio / jaquettes).
 * @param {"list"|"grid"} layout
 */
export default function VersionPicker({
  versions = [],
  activeId = null,
  onSelect,
  onDelete,
  layout = "list",
  labelFor,
  thumbFor,
  emptyLabel = "Aucune version",
}) {
  if (!versions.length) {
    return <p class="text-sm text-base-content/50">{emptyLabel}</p>;
  }

  if (layout === "grid") {
    return (
      <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {versions.map((v, i) => {
          const active = v.id === activeId;
          const thumb = thumbFor?.(v, i);
          return (
            <li key={v.id} class="relative">
              <button
                type="button"
                class={`group relative block w-full overflow-hidden border text-left transition ${
                  active
                    ? "border-primary ring-1 ring-primary"
                    : "border-base-content/15 hover:border-base-content/35"
                }`}
                onClick={() => onSelect?.(v.id)}
                aria-pressed={active}
              >
                {thumb ? (
                  <img src={thumb} alt="" class="aspect-square w-full object-cover" />
                ) : (
                  <div class="flex aspect-square w-full items-center justify-center bg-base-200 text-xs text-base-content/45">
                    #{i + 1}
                  </div>
                )}
                {active && (
                  <span class="absolute left-1.5 top-1.5 inline-flex items-center gap-1 bg-primary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary-content">
                    <Check size={10} /> Active
                  </span>
                )}
              </button>
              {onDelete && (
                <button
                  type="button"
                  class="btn btn-ghost btn-xs absolute right-1 top-1 bg-base-100/80"
                  aria-label="Supprimer cette version"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Supprimer cette version ?")) onDelete(v.id);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul class="divide-y divide-base-content/10 border border-base-content/10">
      {versions.map((v, i) => {
        const active = v.id === activeId;
        const label = labelFor?.(v, i) || `Version ${i + 1}`;
        return (
          <li
            key={v.id}
            class={`flex items-center gap-2 px-3 py-2 ${
              active ? "bg-primary/10" : "hover:bg-base-200/50"
            }`}
          >
            <button
              type="button"
              class="min-w-0 flex-1 text-left text-sm"
              onClick={() => onSelect?.(v.id)}
              aria-pressed={active}
            >
              <span class="flex items-center gap-2">
                {active && <Check size={14} class="shrink-0 text-primary" />}
                <span class="truncate font-medium">{label}</span>
              </span>
              {v.createdAt && (
                <span class="mt-0.5 block text-[11px] text-base-content/45">
                  {formatVersionDate(v.createdAt)}
                </span>
              )}
            </button>
            {onDelete && (
              <button
                type="button"
                class="btn btn-ghost btn-xs shrink-0 text-error"
                aria-label="Supprimer"
                onClick={() => {
                  if (confirm("Supprimer cette version ?")) onDelete(v.id);
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function formatVersionDate(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
