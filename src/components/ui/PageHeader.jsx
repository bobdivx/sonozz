import { ArrowLeft } from "lucide-preact";

/**
 * En-tête de page app (eyebrow + titre + description + actions).
 * Remplace le bandeau AppShell title/subtitle pour un look plus aéré.
 */
export default function PageHeader({
  eyebrow,
  title,
  description,
  backHref,
  backLabel = "Retour",
  actions,
  class: className = "",
}) {
  return (
    <header class={`mb-10 animate-rise space-y-4 md:mb-14 ${className}`}>
      {backHref ? (
        <a
          href={backHref}
          class="inline-flex items-center gap-1.5 text-sm text-base-content/55 transition hover:text-primary"
        >
          <ArrowLeft size={15} />
          {backLabel}
        </a>
      ) : null}
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0 space-y-2">
          {eyebrow ? (
            <p class="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">
              {eyebrow}
            </p>
          ) : null}
          <h1 class="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            {title}
          </h1>
          {description ? (
            <p class="max-w-xl text-sm leading-relaxed text-base-content/60 sm:text-base">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div class="flex flex-wrap items-center gap-2 sm:pt-1">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
