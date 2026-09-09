/**
 * Bandeau d’alerte / confirmation.
 * @param {"error"|"warning"|"success"|"info"} [tone]
 */
export default function AlertBanner({ tone = "info", children, class: className = "" }) {
  const tones = {
    error: "border-error/40 bg-error/10 text-error",
    warning: "border-warning/30 bg-warning/10 text-warning",
    success: "border-success/30 bg-success/10 text-success",
    info: "border-base-content/10 bg-base-200/50 text-base-content/70",
  };

  return (
    <div
      class={`rounded-2xl border px-5 py-4 text-sm leading-relaxed ${tones[tone] || tones.info} ${className}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
