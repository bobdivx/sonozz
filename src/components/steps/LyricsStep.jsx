import { useEffect, useState } from "preact/hooks";
import { PenLine, Languages, Music2 } from "lucide-preact";
import { MUSIC_LANGUAGES, languageLabel } from "../../lib/studio.js";
import VersionPicker from "../VersionPicker.jsx";

export default function LyricsStep({
  lyrics,
  versions = [],
  activeId = null,
  artist,
  loading,
  onGenerate,
  onSelectVersion,
  onDeleteVersion,
}) {
  const [theme, setTheme] = useState(lyrics?.theme || "");
  const [language, setLanguage] = useState(lyrics?.language || artist?.language || "fr");

  useEffect(() => {
    if (lyrics?.language) setLanguage(lyrics.language);
    else if (artist?.language) setLanguage(artist.language);
  }, [lyrics?.language, artist?.language]);

  useEffect(() => {
    if (lyrics?.theme) setTheme(lyrics.theme);
  }, [lyrics?.theme]);

  const hasVersions = versions.length > 0;
  const generateLabel = hasVersions
    ? `Nouvelle version · ${languageLabel(language)}`
    : `Générer en ${languageLabel(language)}`;

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Écrire les paroles</h2>
        <p class="max-w-xl text-base-content/70">
          Couplets, refrain et pont calibrés pour{" "}
          {artist?.name || "l'artiste"}
          {artist?.genre ? ` · ${artist.genre}` : ""}.
          {hasVersions ? " Chaque génération ajoute une version sans écraser les autres." : ""}
        </p>
      </header>

      <div class="flex flex-col gap-4">
        {artist?.genre && (
          <p class="inline-flex items-center gap-2 text-sm text-base-content/65">
            <Music2 size={14} class="text-primary" />
            Style : <span class="text-base-content">{artist.genre}</span>
          </p>
        )}

        <fieldset class="space-y-2">
          <legend class="mb-1 flex items-center gap-2 text-sm text-base-content/60">
            <Languages size={14} class="text-primary" />
            Langue des paroles
          </legend>
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
          {artist?.language && artist.language !== language && (
            <p class="text-xs text-warning">
              Différent de la langue artiste ({languageLabel(artist.language)}) — le chant suivra ce choix.
            </p>
          )}
        </fieldset>

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
          onClick={() => onGenerate({ theme, artist, language })}
        >
          {loading ? <span class="loading loading-spinner loading-sm" /> : <PenLine size={18} />}
          {loading ? "Écriture…" : generateLabel}
        </button>
        {!artist && <p class="text-sm text-warning">Créez d'abord un artiste (étape 2).</p>}
      </div>

      {hasVersions && (
        <div class="grid gap-6 md:grid-cols-[minmax(0,220px)_1fr]">
          <aside class="space-y-2">
            <p class="text-xs uppercase tracking-wider text-base-content/45">
              Versions ({versions.length})
            </p>
            <VersionPicker
              versions={versions}
              activeId={activeId}
              onSelect={onSelectVersion}
              onDelete={onDeleteVersion}
              labelFor={(v, i) =>
                v.title || `Paroles ${i + 1}${v.language ? ` · ${languageLabel(v.language)}` : ""}`
              }
            />
          </aside>

          {lyrics?.text ? (
            <div class="animate-rise space-y-3">
              <div class="flex flex-wrap items-baseline gap-3">
                <h3 class="font-display text-xl font-semibold">{lyrics.title}</h3>
                <span class="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-primary">
                  <Languages size={12} />
                  {languageLabel(lyrics.language)}
                </span>
                <span class="text-xs uppercase tracking-wider text-base-content/45">
                  {(lyrics.structure || []).join(" → ")}
                </span>
              </div>
              <textarea
                class="textarea textarea-bordered min-h-72 w-full bg-base-200 font-mono text-sm leading-relaxed"
                value={lyrics.text}
                readOnly
              />
            </div>
          ) : (
            <p class="text-sm text-base-content/50">Sélectionne une version pour l’afficher.</p>
          )}
        </div>
      )}

      {!hasVersions && lyrics?.text && (
        <div class="animate-rise space-y-3">
          <div class="flex flex-wrap items-baseline gap-3">
            <h3 class="font-display text-xl font-semibold">{lyrics.title}</h3>
            <span class="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-primary">
              <Languages size={12} />
              {languageLabel(lyrics.language)}
            </span>
            <span class="text-xs uppercase tracking-wider text-base-content/45">
              {(lyrics.structure || []).join(" → ")}
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
