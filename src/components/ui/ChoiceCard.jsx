/**
 * Carte de choix (lien ou bouton) — type de profil, options, etc.
 */
export default function ChoiceCard({
  href,
  onClick,
  icon,
  title,
  description,
  active = false,
  disabled = false,
  class: className = "",
}) {
  const Tag = href ? "a" : "button";
  const props = href
    ? { href }
    : {
        type: "button",
        disabled,
        onClick,
      };

  return (
    <Tag
      {...props}
      class={`flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
        active
          ? "border-primary/50 bg-primary/10 shadow-md shadow-primary/10"
          : "border-base-content/10 bg-base-100/40 hover:border-base-content/20"
      } ${disabled ? "pointer-events-none opacity-50" : ""} ${className}`}
    >
      {icon ? (
        <span class="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          {icon}
        </span>
      ) : null}
      <span class="min-w-0">
        <span class="font-display block text-base font-semibold">{title}</span>
        {description ? (
          <span class="mt-1 block text-xs leading-relaxed text-base-content/55">
            {description}
          </span>
        ) : null}
      </span>
    </Tag>
  );
}
