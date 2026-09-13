import { useEffect, useState } from "preact/hooks";
import { PenLine, Languages, Music2, ClipboardPaste } from "lucide-preact";
import { languageLabel, languagesForProvider, songGenLanguageHint, languageEngineLabel } from "../../lib/studio.js";
import { loadKeys } from "../../lib/keys.js";
import { deriveStructureFromText } from "../../lib/lyricsStructure.js";
import VersionPicker from "../VersionPicker.jsx";
import FeatArtistPicker from "../FeatArtistPicker.jsx";

function LyricsEditor({
  language,
  draftTitle,
  draftText,
  onTitleChange,
  onTextChange,
  onCommit,
  disabled,
  emptyHint = false,
}) {
  const structure = deriveStructureFromText(draftText);

  return (
    <div class="animate-rise space-y-3">
      <div class="flex flex-wrap items-baseline gap-3">
        <input
          class="input input-ghost h-auto min-h-0 w-full max-w-md px-0 font-display text-xl font-semibold focus:bg-base-200 focus:px-2"
          type="text"
          value={draftTitle}
          disabled={disabled}
          placeholder="Titre du morceau"
          aria-label="Titre des paroles"
          onInput={(e) => onTitleChange(e.currentTarget.value)}
          onBlur={onCommit}
        />
        <span class="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-primary">
          <Languages size={12} />
          {languageLabel(language)}
        </span>
        {structure.length > 0 ? (
          <span class="text-xs uppercase tracking-wider text-base-content/45">
            {structure.join(" → ")}
          </span>
        ) : null}
      </div>
      <textarea
        class="textarea textarea-bordered min-h-72 w-full bg-base-200 font-mono text-sm leading-relaxed"
        value={draftText}
        disabled={disabled}
        spellcheck={false}
        placeholder={
          emptyHint
            ? "[Verse]\nColle ou écris tes paroles ici…\n\n[Chorus]\n…"
            : undefined
        }
        aria-label="Texte des paroles"
        onInput={(e) => onTextChange(e.currentTarget.value)}
        onBlur={onCommit}
      />
      <p class="text-xs text-base-content/50">
        {emptyHint
          ? "Colle tes paroles puis clique ailleurs — elles sont enregistrées sans génération."
          : "Modifications enregistrées à la sortie du champ."}
      </p>
    </div>
  );
}

export default function LyricsStep({
  lyrics,
  versions = [],
  activeId = null,
  artist,
  featArtist = null,
  catalogArtists = [],
  loading,
  onGenerate,
  onFeatArtistChange,
  onSelectVersion,
  onDeleteVersion,
  onSaveLyrics,
}) {
  const [theme, setTheme] = useState(lyrics?.theme || "");
  const [language, setLanguage] = useState(lyrics?.language || artist?.language || "fr");
  const [draftTitle, setDraftTitle] = useState(lyrics?.title || "");
  const [draftText, setDraftText] = useState(lyrics?.text || "");
  const [asNewVersion, setAsNewVersion] = useState(false);
  const keysSnap = loadKeys();
  const langOptions = languagesForProvider(
    keysSnap.musicProvider,
    keysSnap.songGenPreferredModel,
  );
  const songGenLangs = String(keysSnap.musicProvider || "") === "songgen";

  useEffect(() => {
    if (lyrics?.language) setLanguage(lyrics.language);
    else if (artist?.language) setLanguage(artist.language);
  }, [lyrics?.language, artist?.language]);

  useEffect(() => {
    if (lyrics?.theme) setTheme(lyrics.theme);
  }, [lyrics?.theme]);

  useEffect(() => {
    if (asNewVersion) return;
    setDraftTitle(lyrics?.title || "");
    setDraftText(lyrics?.text || "");
  }, [activeId, lyrics?.title, lyrics?.text, asNewVersion]);

  useEffect(() => {
    if (!langOptions.some((l) => l.code === language) && langOptions[0]) {
      setLanguage(langOptions[0].code);
    }
  }, [language, langOptions]);

  const hasVersions = versions.length > 0;
  const editingEmpty = asNewVersion || !String(lyrics?.text || "").trim();
  const generateLabel = hasVersions
    ? `Nouvelle version · ${languageLabel(language)}`
    : `Générer en ${languageLabel(language)}`;

  function buildPayload() {
    const title = String(draftTitle || "").trim() || String(theme || "").trim() || "Sans titre";
    const text = String(draftText || "");
    return {
      ...(lyrics && !asNewVersion ? lyrics : {}),
      title,
      text,
      theme: String(theme || "").trim() || title,
      language,
      structure: deriveStructureFromText(text),
      source: lyrics?.source && !asNewVersion ? lyrics.source : "manual",
    };
  }

  function commitEdits() {
    if (!onSaveLyrics) return;
    const textRaw = String(draftText || "");
    const textTrim = textRaw.trim();
    const titleTrim =
      String(draftTitle || "").trim() || String(theme || "").trim();

    // Rien à enregistrer
    if (!textTrim && !titleTrim) return;
    // Nouvelle version « à coller » : attendre au moins un titre ou du texte
    if (asNewVersion && !textTrim && !titleTrim) return;

    const payload = buildPayload();
    const unchanged =
      !asNewVersion &&
      lyrics &&
      payload.title === (lyrics.title || "") &&
      payload.text === (lyrics.text || "") &&
      payload.theme === (lyrics.theme || "") &&
      payload.language === (lyrics.language || language);

    if (unchanged) return;

    onSaveLyrics(payload, { asNew: asNewVersion || !lyrics });
    setAsNewVersion(false);
    if (!String(draftTitle || "").trim() && titleTrim) {
      setDraftTitle(titleTrim);
    }
  }

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Écrire les paroles</h2>
        <p class="max-w-xl text-base-content/70">
          Génère, ou colle directement tes couplets / refrain pour{" "}
          {artist?.name || "l'artiste"}
          {featArtist?.name ? (
            <>
              {" "}
              feat. <span class="text-base-content">{featArtist.name}</span>
            </>
          ) : null}
          {artist?.genre ? ` · ${artist.genre}` : ""}.
        </p>
      </header>

      <div class="flex flex-col gap-4">
        {artist?.genre && (
          <p class="inline-flex items-center gap-2 text-sm text-base-content/65">
            <Music2 size={14} class="text-primary" />
            Style lead : <span class="text-base-content">{artist.genre}</span>
          </p>
        )}

        {artist && onFeatArtistChange ? (
          <FeatArtistPicker
            leadArtist={artist}
            featArtist={featArtist}
            catalogArtists={catalogArtists}
            disabled={loading}
            onChange={onFeatArtistChange}
          />
        ) : null}

        <fieldset class="space-y-2">
          <legend class="mb-1 flex items-center gap-2 text-sm text-base-content/60">
            <Languages size={14} class="text-primary" />
            Langue des paroles
          </legend>
          {songGenLangs && (
            <p class="text-xs text-warning">
              {songGenLanguageHint(keysSnap.songGenPreferredModel || "songgeneration_large")}
            </p>
          )}
          <div class="flex flex-wrap gap-2">
            {langOptions.map((l) => {
              const active = language === l.code;
              const engine = languageEngineLabel(
                l.code,
                keysSnap.musicProvider,
                keysSnap.songGenPreferredModel,
              );
              return (
                <button
                  key={l.code}
                  type="button"
                  class={`btn btn-sm ${active ? "btn-primary" : "btn-ghost border border-base-content/15"}`}
                  onClick={() => setLanguage(l.code)}
                >
                  {l.label}
                  {engine === "MiniMax" ? (
                    <span class="ml-1 text-[10px] opacity-70">MiniMax</span>
                  ) : null}
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
            onInput={(e) => {
              const v = e.currentTarget.value;
              setTheme(v);
              if (!lyrics || asNewVersion || !String(draftTitle || "").trim()) {
                setDraftTitle(v);
              }
            }}
            onBlur={commitEdits}
          />
        </label>
        <div class="flex flex-wrap gap-2">
          <button
            class="btn btn-primary gap-2"
            disabled={loading || !artist}
            onClick={() => onGenerate({ theme, artist, language })}
          >
            {loading ? <span class="loading loading-spinner loading-sm" /> : <PenLine size={18} />}
            {loading ? "Écriture…" : generateLabel}
          </button>
          {hasVersions ? (
            <button
              type="button"
              class={`btn gap-2 ${asNewVersion ? "btn-secondary" : "btn-ghost border border-base-content/15"}`}
              disabled={loading || !artist}
              onClick={() => {
                setAsNewVersion(true);
                setDraftTitle(String(theme || "").trim());
                setDraftText("");
              }}
            >
              <ClipboardPaste size={18} />
              {asNewVersion ? "Colle ci-dessous…" : "Version à coller"}
            </button>
          ) : null}
        </div>
        {!artist && (
          <p class="text-sm text-warning">
            Choisis un artiste existant (Auto A→Z) ou{" "}
            <a class="link" href="/artiste/nouveau">
              crée un profil
            </a>{" "}
            dans Artistes.
          </p>
        )}
      </div>

      {hasVersions ? (
        <div class="grid gap-6 md:grid-cols-[minmax(0,220px)_1fr]">
          <aside class="space-y-2">
            <p class="text-xs uppercase tracking-wider text-base-content/45">
              Versions ({versions.length})
              {asNewVersion ? " · brouillon" : ""}
            </p>
            <VersionPicker
              versions={versions}
              activeId={asNewVersion ? null : activeId}
              onSelect={(id) => {
                setAsNewVersion(false);
                onSelectVersion?.(id);
              }}
              onDelete={onDeleteVersion}
              canDelete={() => versions.length > 1}
              labelFor={(v, i) =>
                v.title || `Paroles ${i + 1}${v.language ? ` · ${languageLabel(v.language)}` : ""}`
              }
            />
          </aside>

          <LyricsEditor
            language={language}
            draftTitle={draftTitle}
            draftText={draftText}
            disabled={loading}
            emptyHint={editingEmpty}
            onTitleChange={setDraftTitle}
            onTextChange={setDraftText}
            onCommit={commitEdits}
          />
        </div>
      ) : (
        <LyricsEditor
          language={language}
          draftTitle={draftTitle}
          draftText={draftText}
          disabled={loading || !artist}
          emptyHint
          onTitleChange={setDraftTitle}
          onTextChange={setDraftText}
          onCommit={commitEdits}
        />
      )}
    </section>
  );
}
