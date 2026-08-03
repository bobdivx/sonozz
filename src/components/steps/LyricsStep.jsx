import { useState } from "preact/hooks";
import { PenLine } from "lucide-preact";

export default function LyricsStep({ lyrics, artist, loading, onGenerate }) {
  const [theme, setTheme] = useState(lyrics?.theme || "");

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Écrire les paroles</h2>
        <p class="max-w-xl text-base-content/70">
          Couplets, refrain et pont calibrés pour le style de {artist?.name || "l'artiste"}.
        </p>
      </header>

      <div class="flex flex-col gap-3">
        <label class="form-control w-full">
          <span class="label-text mb-1 text-sm text-base-content/60">Thème / titre</span>
          <input
            class="input input-bordered w-full bg-base-200"
            type="text"
            placeholder="Ex. dernier train, néon, orage doux…"
            value={theme}
            onInput={(e) => setTheme(e.currentTarget.value)}
          />
        </label>
        <button
          class="btn btn-primary gap-2 self-start"
          disabled={loading || !artist}
          onClick={() => onGenerate({ theme, artist })}
        >
          {loading ? <span class="loading loading-spinner loading-sm" /> : <PenLine size={18} />}
          {loading ? "Écriture…" : "Générer les paroles"}
        </button>
        {!artist && <p class="text-sm text-warning">Créez d'abord un artiste (étape 2).</p>}
      </div>

      {lyrics && (
        <div class="animate-rise space-y-3">
          <div class="flex flex-wrap items-baseline gap-3">
            <h3 class="font-display text-xl font-semibold">{lyrics.title}</h3>
            <span class="text-xs uppercase tracking-wider text-base-content/45">
              {lyrics.structure.join(" → ")}
            </span>
          </div>
          <textarea
            class="textarea textarea-bordered min-h-72 w-full bg-base-200 font-mono text-sm leading-relaxed"
            value={lyrics.text}
            readOnly
          />
        </div>
      )}
    </section>
  );
}
