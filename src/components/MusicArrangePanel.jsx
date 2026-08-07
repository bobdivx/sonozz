import {
  LEAD_INSTRUMENTS,
  CHOIR_OPTIONS,
  DRUM_OPTIONS,
  DENSITY_OPTIONS,
  FEATURE_TAGS,
  normalizeMusicArrange,
} from "../lib/musicArrange.js";

function chipClass(active, { fromRef = false } = {}) {
  if (!active) return "btn btn-xs btn-ghost border border-base-content/15";
  if (fromRef) return "btn btn-xs border-0 bg-info/25 text-info hover:bg-info/35";
  return "btn btn-xs btn-primary";
}

/**
 * Panneau arrangement (chœur, lead, densité…) — SongGen + MiniMax.
 * `inferred` = pré-sélection depuis artiste / titre de référence (styleLock).
 * Bleu = valeur alignée sur la réf · Jaune = forçage manuel.
 */
export default function MusicArrangePanel({
  value,
  inferred = null,
  disabled = false,
  onChange,
  onApplyInferred,
}) {
  const arrange = normalizeMusicArrange(value);
  const ref = inferred ? normalizeMusicArrange(inferred) : null;
  const fromRef = arrange.source === "ref" || (!arrange.source && ref && sameArrangeCore(arrange, ref));

  function isRefField(key, optionValue) {
    if (!ref) return false;
    if (key === "features") {
      const a = [...(arrange.features || [])].sort().join("|");
      const b = [...(ref.features || [])].sort().join("|");
      return a === b && a.length > 0;
    }
    if (optionValue !== undefined) {
      return arrange[key] === optionValue && ref[key] === optionValue;
    }
    return arrange[key] === ref[key];
  }

  function patch(partial) {
    onChange?.(
      normalizeMusicArrange({
        ...arrange,
        ...partial,
        source: "manual",
      }),
    );
  }

  function toggleFeature(id) {
    const set = new Set(arrange.features);
    if (set.has(id)) set.delete(id);
    else if (set.size < 6) set.add(id);
    patch({ features: [...set] });
  }

  return (
    <div class="space-y-4 border border-base-content/10 bg-base-200/30 p-4">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 class="text-sm font-medium text-base-content/80">Arrangement du morceau</h3>
          <p class="mt-1 text-xs text-base-content/45">
            Pré-rempli depuis la référence (artiste / titre). Ajuste seulement pour forcer.
          </p>
          {ref ? (
            <p class="mt-1 text-[11px] text-base-content/45">
              <span class="text-info">Bleu = référence</span>
              {" · "}
              <span class="text-primary">Jaune = forçage manuel</span>
            </p>
          ) : null}
        </div>
        {ref && onApplyInferred ? (
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            disabled={disabled}
            onClick={() => onApplyInferred()}
          >
            Réappliquer la réf.
          </button>
        ) : null}
      </div>

      <label class="form-control w-full">
        <span class="label-text mb-1 text-xs text-base-content/55">Instrument principal</span>
        <select
          class={`select select-bordered select-sm w-full ${
            fromRef && isRefField("leadInstrument")
              ? "border-info/40 bg-info/10 text-info"
              : "bg-base-200"
          }`}
          disabled={disabled}
          value={arrange.leadInstrument}
          onChange={(e) => patch({ leadInstrument: e.currentTarget.value })}
        >
          {LEAD_INSTRUMENTS.map((o) => (
            <option key={o.id || "auto"} value={o.id}>
              {o.label}
              {ref && o.id === ref.leadInstrument && o.id ? " · réf." : ""}
            </option>
          ))}
        </select>
      </label>

      <fieldset class="space-y-2">
        <legend class="text-xs text-base-content/55">Chœurs / backing</legend>
        <div class="flex flex-wrap gap-2">
          {CHOIR_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              class={chipClass(arrange.choir === o.id, {
                fromRef: fromRef && isRefField("choir", o.id) && arrange.choir === o.id,
              })}
              disabled={disabled}
              onClick={() => patch({ choir: o.id })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset class="space-y-2">
        <legend class="text-xs text-base-content/55">Batterie / groove</legend>
        <div class="flex flex-wrap gap-2">
          {DRUM_OPTIONS.map((o) => (
            <button
              key={o.id || "auto"}
              type="button"
              class={chipClass(arrange.drums === o.id, {
                fromRef: fromRef && isRefField("drums", o.id) && arrange.drums === o.id,
              })}
              disabled={disabled}
              onClick={() => patch({ drums: o.id })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset class="space-y-2">
        <legend class="text-xs text-base-content/55">Densité de prod</legend>
        <div class="flex flex-wrap gap-2">
          {DENSITY_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              class={chipClass(arrange.density === o.id, {
                fromRef: fromRef && isRefField("density", o.id) && arrange.density === o.id,
              })}
              disabled={disabled}
              onClick={() => patch({ density: o.id })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset class="space-y-2">
        <legend class="text-xs text-base-content/55">Couleurs (multi)</legend>
        <div class="flex flex-wrap gap-2">
          {FEATURE_TAGS.map((f) => {
            const on = arrange.features.includes(f.id);
            const refOn = Boolean(ref?.features?.includes(f.id));
            let cls = "btn btn-xs btn-ghost border border-base-content/15";
            if (on && fromRef && refOn) cls = "btn btn-xs border-0 bg-info/25 text-info hover:bg-info/35";
            else if (on) cls = "btn btn-xs btn-primary";
            else if (refOn) cls = "btn btn-xs border border-info/30 text-info/70";
            return (
              <button
                key={f.id}
                type="button"
                class={cls}
                disabled={disabled}
                onClick={() => toggleFeature(f.id)}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="form-control w-full">
          <span class="label-text mb-1 text-xs text-base-content/55">BPM (optionnel)</span>
          <input
            class={`input input-bordered input-sm w-full ${
              fromRef && arrange.bpm != null && arrange.bpm === ref?.bpm
                ? "border-info/40 bg-info/10 text-info"
                : "bg-base-200"
            }`}
            type="number"
            min={60}
            max={200}
            placeholder={ref?.bpm != null ? `Réf. ${ref.bpm}` : "Auto"}
            disabled={disabled}
            value={arrange.bpm ?? ""}
            onInput={(e) => {
              const v = e.currentTarget.value;
              patch({ bpm: v === "" ? null : Number(v) });
            }}
          />
        </label>
        <label class="form-control w-full">
          <span class="label-text mb-1 text-xs text-base-content/55">Notes libres</span>
          <input
            class={`input input-bordered input-sm w-full ${
              fromRef && arrange.notes && arrange.notes === ref?.notes
                ? "border-info/40 bg-info/10"
                : "bg-base-200"
            }`}
            type="text"
            placeholder="Ex. refrain explosif, bridge intimiste…"
            disabled={disabled}
            value={arrange.notes}
            onInput={(e) => patch({ notes: e.currentTarget.value })}
          />
        </label>
      </div>
    </div>
  );
}

function sameArrangeCore(a, b) {
  return (
    a.leadInstrument === b.leadInstrument &&
    a.choir === b.choir &&
    a.drums === b.drums &&
    a.density === b.density &&
    a.bpm === b.bpm &&
    [...(a.features || [])].sort().join("|") === [...(b.features || [])].sort().join("|")
  );
}
