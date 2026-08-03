import { useState } from "preact/hooks";
import { UserRound, MapPin, Mic2, Palette, Camera, Shirt } from "lucide-preact";

export default function ArtistStep({ artist, trends, loading, onGenerate }) {
  const [name, setName] = useState(artist?.name || "");
  const [bioHint, setBioHint] = useState("");

  const vi = artist?.visualIdentity;

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Créer un artiste complet</h2>
        <p class="max-w-xl text-base-content/70">
          Profil + identité visuelle + portrait IA — base pour jaquettes et shorts.
        </p>
      </header>

      <div class="flex flex-col gap-3">
        <label class="form-control w-full">
          <span class="label-text mb-1 text-sm text-base-content/60">Nom de l'artiste</span>
          <input
            class="input input-bordered w-full bg-base-200"
            type="text"
            placeholder="Laisser vide pour générer"
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <label class="form-control w-full">
          <span class="label-text mb-1 text-sm text-base-content/60">Biographie / style (optionnel)</span>
          <textarea
            class="textarea textarea-bordered w-full bg-base-200"
            rows={4}
            placeholder="Indices de personnalité, origines, univers…"
            value={bioHint}
            onInput={(e) => setBioHint(e.currentTarget.value)}
          />
        </label>
        <button
          class="btn btn-primary gap-2 self-start"
          disabled={loading}
          onClick={() => onGenerate({ name, bioHint, trends })}
        >
          {loading ? <span class="loading loading-spinner loading-sm" /> : <UserRound size={18} />}
          {loading ? "Profil + portrait…" : "Générer le profil & le visuel"}
        </button>
      </div>

      {artist && (
        <article class="animate-rise space-y-5 border-t border-base-content/10 pt-5">
          <div class="grid gap-6 md:grid-cols-[240px_1fr] md:items-start">
            <figure class="space-y-2">
              {artist.imageUrl && !/^data:image\/svg/i.test(artist.imageUrl) ? (
                <img
                  src={artist.imageUrl}
                  alt={`Portrait de ${artist.name}`}
                  class="aspect-square w-full object-cover shadow-2xl shadow-black/40"
                />
              ) : (
                <div class="flex aspect-square w-full items-center justify-center border border-warning/30 bg-warning/10 p-3 text-center text-sm text-warning">
                  Portrait photo manquant. Clique « Générer le profil » (Replicate Flux requis).
                </div>
              )}
              <figcaption class="text-xs text-base-content/45">
                Identité visuelle · portrait artiste (photo, pas SVG)
              </figcaption>
              {artist.imageProvider && (
                <p class="text-xs text-base-content/45">Source : {artist.imageProvider}</p>
              )}
              {artist.imageWarning && (
                <p class="text-xs text-warning">{artist.imageWarning}</p>
              )}
              {(!artist.imageUrl || /^data:image\/svg/i.test(artist.imageUrl)) && (
                <p class="text-xs text-warning">
                  Sans photo réelle, la jaquette et ONCE resteront bloqués. Billing Replicate :
                  {" "}
                  <a class="link" href="https://replicate.com/account/billing#billing" target="_blank" rel="noreferrer">
                    replicate.com/billing
                  </a>
                </p>
              )}
            </figure>

            <div class="space-y-4">
              <div class="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p class="text-xs uppercase tracking-[0.2em] text-primary">{artist.aka}</p>
                  <h3 class="font-display text-3xl font-bold">{artist.name}</h3>
                  {artist.slug && (
                    <a class="link link-primary text-sm" href={`/artiste/${artist.slug}`}>
                      Page artiste /{artist.slug}
                    </a>
                  )}
                </div>
                <div class="flex gap-2">
                  {(artist.palette || []).map((c) => (
                    <span
                      key={c}
                      class="h-6 w-6 rounded-full border border-base-content/20"
                      style={{ background: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>

              <p class="leading-relaxed text-base-content/80">{artist.bio}</p>

              <div class="flex flex-wrap gap-4 text-sm text-base-content/70">
                <span class="inline-flex items-center gap-2">
                  <MapPin size={16} class="text-secondary" /> {artist.city}
                </span>
                <span class="inline-flex items-center gap-2">
                  <Mic2 size={16} class="text-accent" /> {artist.voice}
                </span>
                <span>{artist.genre} · {artist.mood}</span>
              </div>

              <p class="text-sm text-base-content/55">
                Influences : {(artist.influences || []).join(" · ")}
              </p>

              {vi && (
                <div class="space-y-3 border-t border-base-content/10 pt-4">
                  <p class="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-primary">
                    <Palette size={14} /> Identité visuelle
                  </p>
                  <ul class="space-y-2 text-sm text-base-content/75">
                    {vi.look && (
                      <li class="flex gap-2">
                        <Camera size={16} class="mt-0.5 shrink-0 text-secondary" />
                        <span>
                          <span class="text-base-content/45">Look — </span>
                          {vi.look}
                        </span>
                      </li>
                    )}
                    {vi.wardrobe && (
                      <li class="flex gap-2">
                        <Shirt size={16} class="mt-0.5 shrink-0 text-accent" />
                        <span>
                          <span class="text-base-content/45">Wardrobe — </span>
                          {vi.wardrobe}
                        </span>
                      </li>
                    )}
                    {vi.photographyStyle && (
                      <li>
                        <span class="text-base-content/45">Photo — </span>
                        {vi.photographyStyle}
                      </li>
                    )}
                    {vi.logoConcept && (
                      <li>
                        <span class="text-base-content/45">Logo — </span>
                        {vi.logoConcept}
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </article>
      )}
    </section>
  );
}
