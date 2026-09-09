/**
 * État vide avec bordure en pointillés + CTA optionnel.
 */
export default function EmptyState({
  title,
  description,
  action,
  class: className = "",
}) {
  return (
    <div
      class={`flex flex-col items-center gap-3 rounded-3xl border border-dashed border-base-content/15 bg-base-300/20 px-6 py-14 text-center ${className}`}
    >
      {title ? (
        <p class="font-display text-lg font-semibold tracking-tight">{title}</p>
      ) : null}
      {description ? (
        <p class="max-w-md text-sm leading-relaxed text-base-content/55">{description}</p>
      ) : null}
      {action ? <div class="mt-2">{action}</div> : null}
    </div>
  );
}
