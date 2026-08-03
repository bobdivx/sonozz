import { useEffect, useState } from "preact/hooks";
import { UserRound, MapPin, Mic2, Palette, Camera, Shirt, Music2, Languages } from "lucide-preact";
import {
  MUSIC_LANGUAGES,
  MUSIC_STYLES,
  formatGenres,
  languageLabel,
  parseGenres,
} from "../../lib/studio.js";
import StyleArtistPicker from "../StyleArtistPicker.jsx";

export default function ArtistStep({ artist, trends, loading, onGenerate }) {
  const [name, setName] = useState(artist?.name || "");
  const [genres, setGenres] = useState(() => parseGenres(artist?.genres || artist?.genre));
  const [customGenre, setCustomGenre] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [language, setLanguage] = useState(artist?.language || "fr");
  const [bioHint, setBioHint] = useState("");
  const [styleArtist, setStyleArtist] = useState(artist?.styleArtist || "");
  const [styleArtistPick, setStyleArtistPick] = useState(() =>
    artist?.styleLock?.sourceId
      ? {
          source: artist.styleLock.source,
          id: artist.styleLock.sourceId,
          name: artist.styleArtist || artist.styleLock.matchedName,
          image: artist.styleLock.image || null,
        }
      : null,
  );
  const [pickError, setPickError] = useState("");

  useEffect(() => {
    if (!artist) return;
    setName(artist.name || "");
    const parsed = parseGenres(artist.genres || artist.genre);
    const presetValues = new Set(MUSIC_STYLES.map((s) => s.value).filter(Boolean));
    const known = parsed.filter((g) => presetValues.has(g));
    const unknown = parsed.filter((g) => !presetValues.has(g));
    setGenres(known);
    if (unknown.length) {
      setShowCustom(true);
      setCustomGenre(unknown.join(" × "));
    } else {
      setShowCustom(false);
      setCustomGenre("");
    }
    if (artist.language) setLanguage(artist.language);
    setStyleArtist(artist.styleArtist || "");
    if (artist.styleLock?.sourceId) {
      setStyleArtistPick({
        source: artist.styleLock.source,
        id: artist.styleLock.sourceId,
        name: artist.styleArtist || artist.styleLock.matchedName,
        image: artist.styleLock.image || null,
      });
    }
  }, [artist?.name, artist?.genre, artist?.genres, artist?.language, artist?.styleArtist]);

  function toggleStyle(value) {
    if (!value) {
      // « Au choix de l'IA » : vide la sélection
      setGenres([]);
      setShowCustom(false);
      setCustomGenre("");
      return;
    }
    setGenres((prev) =>
      prev.includes(value) ? prev.filter((g) => g !== value) : [...prev, value],
    );
  }

  const resolvedGenres = [
    ...genres,
    ...(showCustom && customGenre.trim() ? [customGenre.trim()] : []),
  ];
  const resolvedGenre = formatGenres(resolvedGenres);

  function handleGenerate() {
    if (styleArtist.trim() && !styleArtistPick?.id) {
      setPickError("Choisis et valide un artiste dans la liste avant de générer.");
      return;
    }
    setPickError("");
    onGenerate({
      name: name.trim(),
      genre: resolvedGenre || undefined,
      genres: resolvedGenres.length ? resolvedGenres : undefined,
      language,
      bioHint: bioHint.trim(),
      styleArtist: styleArtistPick?.name || styleArtist.trim() || undefined,
      styleArtistPick: styleArtistPick || undefined,
      trends,
    });
  }

  const vi = artist?.visualIdentity;
  const displayGenres = parseGenres(artist?.genres || artist?.genre);

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Créer un artiste complet</h2>
        <p class="max-w-xl text-base-content/70">
          Choisis un ou plusieurs styles musicaux et la langue — puis génère profil + portrait.
        </p>
      </header>

      <div class="flex flex-col gap-5">
        <label class="form-control w-full">
          <span class="label-text mb-1 text-sm text-base-content/60">
            Nom de scène (ton artiste fictionnel)
          </span>
          <input
            class="input input-bordered w-full bg-base-200"
            type="text"
            placeholder="Laisser vide pour générer un nom"
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </label>

        <fieldset class="space-y-2">
          <legend class="mb-1 flex items-center gap-2 text-sm text-base-content/60">
            <Music2 size={14} class="text-primary" />
            Styles musicaux
          </legend>
          <p class="text-xs text-base-content/45">
            Multi-sélection — mélange possible (ex. Rap × Électro). Définit le son, les paroles et la
            prod.
          </p>
          <div class="flex flex-wrap gap-2">
            {MUSIC_STYLES.map((s) => {
              const active = s.value
                ? genres.includes(s.value)
                : genres.length === 0 && !showCustom;
              return (
                <button
                  key={s.label}
                  type="button"
                  class={`btn btn-sm ${active ? "btn-primary" : "btn-ghost border border-base-content/15"}`}
                  onClick={() => toggleStyle(s.value)}
                >
                  {s.label}
                </button>
              );
            })}
            <button
              type="button"
              class={`btn btn-sm ${showCustom ? "btn-primary" : "btn-ghost border border-base-content/15"}`}
              onClick={() => {
                setShowCustom((v) => !v);
                if (showCustom) setCustomGenre("");
              }}
            >
              Personnalisé
            </button>
          </div>
          {resolvedGenres.length > 0 && (
            <p class="text-xs text-primary">
              Sélection : {formatGenres(resolvedGenres)}
            </p>
          )}
          {showCustom && (
            <input
              class="input input-bordered mt-2 w-full bg-base-200"
              type="text"
              placeholder="Ex. duo électro-rap aux influences orientales"
              value={customGenre}
              onInput={(e) => setCustomGenre(e.currentTarget.value)}
            />
          )}
          <div class="pt-1">
            <StyleArtistPicker
              value={styleArtist}
              pick={styleArtistPick}
              disabled={loading}
              onQueryChange={(q) => {
                setStyleArtist(q);
                setStyleArtistPick(null);
                setPickError("");
              }}
              onPickChange={(pick) => {
                setStyleArtistPick(pick);
                if (pick?.name) setStyleArtist(pick.name);
                setPickError("");
              }}
            />
            {pickError && <p class="mt-1 text-xs text-warning">{pickError}</p>}
          </div>
        </fieldset>

        <fieldset class="space-y-2">
          <legend class="mb-1 flex items-center gap-2 text-sm text-base-content/60">
            <Languages size={14} class="text-primary" />
            Langue des chansons
          </legend>
          <p class="text-xs text-base-content/45">
            Langue des paroles, du chant et des métadonnées de release.
          </p>
          <div class="flex flex-wrap gap-2">
            {MUSIC_LANGUAGES.map((l) => {
              const active = language === l.code;
              return (
                <button
                  key={l.code}
                  type="button"
                  class={`btn btn-sm ${active ? "btn-primary" : "btn-ghost border border-base-content/15"}`}
                  onClick={() => setLanguage(l.code)}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label class="form-control w-full">
          <span class="label-text mb-1 text-sm text-base-content/60">
            Personnalité / univers (optionnel)
          </span>
          <textarea
            class="textarea textarea-bordered w-full bg-base-200"
            rows={3}
            placeholder="Origines, look, histoire… (pas le style musical — déjà choisi au-dessus)"
            value={bioHint}
            onInput={(e) => setBioHint(e.currentTarget.value)}
          />
        </label>

        <button
          class="btn btn-primary gap-2 self-start"
          disabled={loading || (showCustom && !customGenre.trim() && genres.length === 0)}
          onClick={handleGenerate}
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
                  Sans photo réelle, la jaquette et ONCE resteront bloqués. Billing Replicate :{" "}
                  <a
                    class="link"
                    href="https://replicate.com/account/billing#billing"
                    target="_blank"
                    rel="noreferrer"
                  >
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

              <div class="flex flex-wrap gap-2">
                {displayGenres.length ? (
                  displayGenres.map((g) => (
                    <span
                      key={g}
                      class="inline-flex items-center gap-1.5 border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary"
                    >
                      <Music2 size={12} />
                      {g}
                    </span>
                  ))
                ) : (
                  <span class="inline-flex items-center gap-1.5 border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary">
                    <Music2 size={12} />
                    Style non défini
                  </span>
                )}
                {artist.gender && (
                  <span class="inline-flex items-center border border-base-content/15 px-2.5 py-1 text-xs text-base-content/70">
                    {artist.gender === "female"
                      ? "Femme"
                      : artist.gender === "nonbinary"
                        ? "Non-binaire"
                        : "Homme"}
                  </span>
                )}
                <span class="inline-flex items-center gap-1.5 border border-secondary/30 bg-secondary/10 px-2.5 py-1 text-xs text-secondary">
                  <Languages size={12} />
                  {languageLabel(artist.language)}
                </span>
                {artist.mood && (
                  <span class="inline-flex items-center border border-base-content/15 px-2.5 py-1 text-xs text-base-content/70">
                    {artist.mood}
                  </span>
                )}
              </div>

              <p class="leading-relaxed text-base-content/80">{artist.bio}</p>

              <div class="flex flex-wrap gap-4 text-sm text-base-content/70">
                <span class="inline-flex items-center gap-2">
                  <MapPin size={16} class="text-secondary" /> {artist.city}
                </span>
                <span class="inline-flex items-center gap-2">
                  <Mic2 size={16} class="text-accent" /> {artist.voice}
                </span>
              </div>

              <p class="text-sm text-base-content/55">
                Influences : {(artist.influences || []).join(" · ")}
              </p>
              {artist.styleArtist && (
                <p class="text-sm text-base-content/55">
                  Référence style : <span class="text-primary">{artist.styleArtist}</span>
                  {artist.styleLock?.source ? (
                    <span class="text-base-content/40">
                      {" "}
                      · {artist.styleLock.source}
                      {artist.styleLock.confidence ? ` · ${artist.styleLock.confidence}` : ""}
                    </span>
                  ) : null}
                </p>
              )}
              {artist.styleLock?.genreSummary && (
                <p class="text-sm text-base-content/55">
                  Style verrouillé :{" "}
                  <span class="text-secondary">{artist.styleLock.genreSummary}</span>
                </p>
              )}
              {artist.styleLock?.production && (
                <p class="text-xs text-base-content/45">{artist.styleLock.production}</p>
              )}

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
