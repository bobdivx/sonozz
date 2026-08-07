import {
  LEAD_INSTRUMENTS,
  CHOIR_OPTIONS,
  DRUM_OPTIONS,
  DENSITY_OPTIONS,
  FEATURE_TAGS,
  normalizeMusicArrange,
} from "../lib/musicArrange.js";

/**
 * Panneau arrangement (chœur, lead, densité…) — SongGen + MiniMax.
 * @param {{
 *   value?: object,
 *   disabled?: boolean,
 *   onChange?: (next: object) => void,
 * }} props
 */
export default function MusicArrangePanel({ value, disabled = false, onChange }) {
  const arrange = normalizeMusicArrange(value);

  function patch(partial) {
    onChange?.(normalizeMusicArrange({ ...arrange, ...partial }));
  }

  function toggleFeature(id) {
    const set = new Set(arrange.features);
    if (set.has(id)) set.delete(id);
    else if (set.size < 6) set.add(id);
    patch({ features: [...set] });
  }

  return (
    <div class="space-y-4 border border-base-content/10 bg-base-200/30 p-4">
      <div>
        <h3 class="text-sm font-medium text-base-content/80">Arrangement du morceau</h3>
        <p class="mt-1 text-xs text-base-content/45">
          Guide SongGen (voix + instruments). Le style artiste reste la base — ces réglages
          précisent la prod.
        </p>
      </div>

      <label class="form-control w-full">
        <span class="label-text mb-1 text-xs text-base-content/55">Instrument principal</span>
        <select
          class="select select-bordered select-sm w-full bg-base-200"
          disabled={disabled}
          value={arrange.leadInstrument}
          onChange={(e) => patch({ leadInstrument: e.currentTarget.value })}
        >
          {LEAD_INSTRUMENTS.map((o) => (
            <option key={o.id || "auto"} value={o.id}>
              {o.label}
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
              class={`btn btn-xs ${arrange.choir === o.id ? "btn-primary" : "btn-ghost border border-base-content/15"}`}
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
              class={`btn btn-xs ${arrange.drums === o.id ? "btn-primary" : "btn-ghost border border-base-content/15"}`}
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
              class={`btn btn-xs ${arrange.density === o.id ? "btn-primary" : "btn-ghost border border-base-content/15"}`}
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
            return (
              <button
                key={f.id}
                type="button"
                class={`btn btn-xs ${on ? "btn-secondary" : "btn-ghost border border-base-content/15"}`}
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
            class="input input-bordered input-sm w-full bg-base-200"
            type="number"
            min={60}
            max={200}
            placeholder="Auto"
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
            class="input input-bordered input-sm w-full bg-base-200"
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
