/**
 * Panneau de contenu arrondi (fiche, réglages, zone dangereuse…).
 * @param {"default"|"solid"|"primary"|"danger"|"dashed"} [tone]
 */
export default function SectionCard({
  children,
  eyebrow,
  title,
  description,
  actions,
  tone = "default",
  class: className = "",
  bodyClass = "",
}) {
  const tones = {
    default:
      "border-base-content/10 bg-gradient-to-br from-base-200/80 via-base-100/50 to-primary/5",
    solid: "border-base-content/10 bg-base-200/40",
    primary:
      "border-primary/25 bg-gradient-to-br from-primary/20 via-accent/10 to-secondary/15",
    danger: "border-error/20 bg-error/5",
    dashed: "border-dashed border-base-content/15 bg-base-300/20",
  };

  const hasHead = Boolean(eyebrow || title || description || actions);

  return (
    <section
      class={`overflow-hidden rounded-3xl border ${tones[tone] || tones.default} ${className}`}
    >
      {hasHead ? (
        <div
          class={`flex flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-8 sm:py-6 ${
            children ? "border-b border-base-content/10" : ""
          }`}
        >
          <div class="min-w-0 space-y-1.5">
            {eyebrow ? (
              <p class="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h2
                class={`font-display text-lg font-semibold sm:text-xl ${
                  tone === "danger" ? "text-error" : ""
                }`}
              >
                {title}
              </h2>
            ) : null}
            {description ? (
              <p class="max-w-xl text-sm leading-relaxed text-base-content/60">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div class="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children ? (
        <div class={`p-5 sm:p-8 ${bodyClass}`}>{children}</div>
      ) : null}
    </section>
  );
}
