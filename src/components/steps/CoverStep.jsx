import { useState } from "preact/hooks";
import { ImagePlus } from "lucide-preact";

export default function CoverStep({ cover, artist, track, loading, onGenerate }) {
  const [prompt, setPrompt] = useState(cover?.prompt || "");
  const portraitUrl = artist?.imageUrl || "";
  const hasPortrait =
    Boolean(portraitUrl) &&
    !/^data:image\/svg/i.test(portraitUrl) &&
    (/^https?:\/\//i.test(portraitUrl) || /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(portraitUrl));

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Créer les jaquettes</h2>
        <p class="max-w-xl text-base-content/70">
          Gemini transforme le <strong>portrait de l’artiste</strong> en jaquette album (même visage).
        </p>
      </header>

      {artist && (
        <div class="flex flex-wrap items-center gap-4 border border-base-content/10 bg-base-200/40 p-3">
          {hasPortrait ? (
            <img
              src={artist.imageUrl}
              alt={`Référence ${artist.name}`}
              class="h-20 w-20 object-cover"
            />
          ) : (
            <div class="flex h-20 w-20 items-center justify-center bg-warning/15 text-center text-[10px] text-warning">
              Pas de photo
            </div>
          )}
          <div class="min-w-0 text-sm">
            <p class="font-medium">Référence obligatoire : {artist.name}</p>
            <p class="text-base-content/60">
              {hasPortrait
                ? "La jaquette partira de ce portrait (Gemini image-à-image)."
                : "Régénère l’étape Artiste pour obtenir une vraie photo avant la jaquette."}
            </p>
          </div>
        </div>
      )}

      <div class="flex flex-col gap-3">
        <label class="form-control w-full">
          <span class="label-text mb-1 text-sm text-base-content/60">Style / ambiance (optionnel)</span>
          <input
            class="input input-bordered w-full bg-base-200"
            type="text"
            placeholder="Grain film, lumière laiton, nuit urbaine…"
            value={prompt}
            onInput={(e) => setPrompt(e.currentTarget.value)}
          />
        </label>
        <button
          class="btn btn-primary gap-2 self-start"
          disabled={loading || !artist || !hasPortrait}
          onClick={() => onGenerate({ prompt, artist, track })}
        >
          {loading ? <span class="loading loading-spinner loading-sm" /> : <ImagePlus size={18} />}
          {loading ? "Gemini compose la jaquette…" : "Générer depuis le portrait"}
        </button>
        {!artist && <p class="text-sm text-warning">Un profil artiste est requis.</p>}
        {artist && !hasPortrait && (
          <p class="text-sm text-warning">
            Portrait manquant — retourne à l’étape Artiste et régénère le profil (photo Flux/Gemini).
          </p>
        )}
      </div>

      {cover && (
        <figure class="animate-rise grid gap-4 md:grid-cols-[minmax(0,280px)_1fr] md:items-end">
          {cover.imageUrl ? (
            <img
              src={cover.imageUrl}
              alt={`Jaquette ${track?.title || artist?.name || ""}`}
              class="aspect-square w-full max-w-xs object-cover shadow-2xl shadow-black/40"
            />
          ) : (
            <div class="flex aspect-square w-full max-w-xs items-center justify-center border border-warning/40 bg-warning/10 p-4 text-center text-sm text-warning">
              Image absente — régénère la jaquette.
            </div>
          )}
          <figcaption class="space-y-2 text-sm text-base-content/70">
            <p class="font-display text-lg text-base-content">
              {cover.format} · {cover.style}
              {cover.basedOnArtist ? " · basé portrait" : ""}
            </p>
            <p class="text-xs text-base-content/45">Provider : {cover.provider || "—"}</p>
            <p>{cover.prompt}</p>
            {cover.warning && <p class="text-warning">{cover.warning}</p>}
          </figcaption>
        </figure>
      )}
    </section>
  );
}
