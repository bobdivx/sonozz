import { useState, useEffect } from "preact/hooks";
import { X, Search } from "lucide-preact";
import { MUSIC_STYLES, catalogGenresToStyleValues, styleLabelForValue } from "../lib/studio.js";
import StyleArtistPicker from "./StyleArtistPicker.jsx";
import StyleTrackPicker from "./StyleTrackPicker.jsx";

/**
 * Modal de confirmation lors de la création d'un nouveau morceau.
 * Permet de confirmer/modifier le genre et les références artistiques.
 */
export default function TrackCreationModal({
  open,
  onClose,
  onConfirm,
  currentGenre = "",
  currentReferences = [],
  currentReferenceTrack = "",
}) {
  const [keepSettings, setKeepSettings] = useState(true);
  
  // Pour "Modifier pour ce titre"
  const [genres, setGenres] = useState(() => {
    const vals = catalogGenresToStyleValues([currentGenre].filter(Boolean));
    return vals.length > 0 ? vals : [];
  });
  const [styleQuery, setStyleQuery] = useState("");
  const [styleSearchOpen, setStyleSearchOpen] = useState(false);
  const [artistPicks, setArtistPicks] = useState(() => {
    return Array.isArray(currentReferences) && currentReferences.length > 0
      ? currentReferences.map((name, idx) => ({
          source: "legacy",
          id: `ref-${idx}`,
          name: name,
          image: null,
          genres: [],
        }))
      : [];
  });
  const [trackPick, setTrackPick] = useState(() => {
    if (!currentReferenceTrack) return null;
    return {
      source: "legacy",
      id: "ref-track",
      name: currentReferenceTrack,
      artistName: "",
      image: null,
      genres: [],
    };
  });

  useEffect(() => {
    if (!open) {
      setKeepSettings(true);
      return;
    }
    // Réinitialiser avec les valeurs actuelles quand le modal s'ouvre
    const vals = catalogGenresToStyleValues([currentGenre].filter(Boolean));
    setGenres(vals.length > 0 ? vals : []);
    
    if (Array.isArray(currentReferences) && currentReferences.length > 0) {
      setArtistPicks(
        currentReferences.map((name, idx) => ({
          source: "legacy",
          id: `ref-${idx}`,
          name: name,
          image: null,
          genres: [],
        }))
      );
    } else {
      setArtistPicks([]);
    }

    if (currentReferenceTrack) {
      setTrackPick({
        source: "legacy",
        id: "ref-track",
        name: currentReferenceTrack,
        artistName: "",
        image: null,
        genres: [],
      });
    } else {
      setTrackPick(null);
    }
  }, [open, currentGenre, currentReferences, currentReferenceTrack]);

  if (!open) return null;

  const handleConfirm = () => {
    if (keepSettings) {
      onConfirm({
        genre: currentGenre,
        references: currentReferences,
        referenceTrack: currentReferenceTrack,
      });
    } else {
      // Utiliser les nouveaux choix
      const genreValue = genres.length > 0 ? genres.join(", ") : currentGenre;
      const refs = artistPicks.map(p => p.name);
      const refTrack = trackPick?.name || "";
      
      onConfirm({
        genre: genreValue || currentGenre,
        references: refs.length > 0 ? refs : currentReferences,
        referenceTrack: refTrack || currentReferenceTrack,
      });
    }
  };

  function addStyle(value) {
    const v = String(value || "").trim();
    if (!v) return;
    setGenres((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setStyleQuery("");
    setStyleSearchOpen(false);
  }

  function removeStyle(value) {
    setGenres((prev) => prev.filter((g) => g !== value));
  }

  const styleOptions = MUSIC_STYLES.filter((s) => s.value);

  const displayGenre = currentGenre || "Non défini";
  const displayReferences =
    Array.isArray(currentReferences) && currentReferences.length > 0
      ? currentReferences.join(", ")
      : "Aucune référence";
  const displayReferenceTrack = currentReferenceTrack || "Aucun titre de référence";

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-rise">
      <div class="relative mx-4 w-full max-w-lg rounded-3xl border border-base-content/10 bg-base-200 p-6 shadow-2xl">
        <button
          type="button"
          class="btn btn-ghost btn-circle btn-sm absolute right-4 top-4"
          onClick={onClose}
          aria-label="Fermer"
        >
          <X size={18} />
        </button>

        <h2 class="font-display text-2xl font-bold">Créer un nouveau morceau</h2>
        <p class="mt-2 text-sm text-base-content/60">
          Veux-tu garder le genre et les références actuels, ou en choisir d'autres pour ce nouveau titre ?
        </p>

        <div class="mt-6 space-y-4">
          <div class="rounded-2xl border border-base-content/10 bg-base-300/40 p-4">
            <p class="text-xs font-semibold uppercase tracking-wider text-base-content/45">
              Genre actuel
            </p>
            <p class="mt-1 text-base font-medium">{displayGenre}</p>

            <p class="mt-3 text-xs font-semibold uppercase tracking-wider text-base-content/45">
              Artistes de référence
            </p>
            <p class="mt-1 text-sm">{displayReferences}</p>

            {currentReferenceTrack && (
              <>
                <p class="mt-3 text-xs font-semibold uppercase tracking-wider text-base-content/45">
                  Titre de référence
                </p>
                <p class="mt-1 text-sm">{displayReferenceTrack}</p>
              </>
            )}
          </div>

          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3">
              <input
                type="radio"
                name="settings-choice"
                class="radio radio-primary"
                checked={keepSettings}
                onChange={() => setKeepSettings(true)}
              />
              <span class="label-text">Garder ces paramètres</span>
            </label>
          </div>

          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3">
              <input
                type="radio"
                name="settings-choice"
                class="radio radio-primary"
                checked={!keepSettings}
                onChange={() => setKeepSettings(false)}
              />
              <span class="label-text">Modifier pour ce titre</span>
            </label>
          </div>

          {!keepSettings && (
            <div class="space-y-4 rounded-2xl border border-base-content/10 bg-base-300/40 p-4">
              <div class="space-y-2">
                <p class="text-xs font-medium text-base-content/70">Artistes de référence</p>
                <StyleArtistPicker
                  multiple
                  maxPicks={5}
                  picks={artistPicks}
                  compact
                  label=""
                  hint="Choisis jusqu'à 5 artistes pour ce morceau"
                  onPicksChange={(next) => setArtistPicks(next)}
                />
              </div>

              <div class="space-y-2">
                <p class="text-xs font-medium text-base-content/70">Titre de référence (optionnel)</p>
                <StyleTrackPicker
                  pick={trackPick}
                  artistPick={artistPicks[0] || null}
                  compact
                  label=""
                  hint="Choisis un titre pour caler BPM et prod"
                  onPickChange={(p) => setTrackPick(p)}
                />
              </div>

              <div class="space-y-2">
                <p class="text-xs font-medium text-base-content/70">Styles musicaux</p>
                <p class="text-xs text-base-content/45">
                  Cherche un style ou laisse vide pour utiliser les références
                </p>
                {genres.length > 0 && (
                  <div class="flex flex-wrap gap-2">
                    {genres.map((value) => (
                      <span
                        key={value}
                        class="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1 text-xs text-primary"
                      >
                        {styleLabelForValue(value)}
                        <button
                          type="button"
                          class="ml-0.5 rounded-full p-0.5 opacity-70 hover:opacity-100"
                          aria-label={`Retirer ${styleLabelForValue(value)}`}
                          onClick={() => removeStyle(value)}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div class="relative">
                  <label class="input input-bordered input-sm flex w-full items-center gap-2 bg-base-200">
                    <Search size={14} class="shrink-0 opacity-50" />
                    <input
                      class="grow bg-transparent text-sm"
                      type="search"
                      placeholder="Rechercher un style (metal, rap, folk…)"
                      value={styleQuery}
                      onFocus={() => setStyleSearchOpen(true)}
                      onBlur={() => {
                        window.setTimeout(() => setStyleSearchOpen(false), 150);
                      }}
                      onInput={(e) => {
                        setStyleQuery(e.currentTarget.value);
                        setStyleSearchOpen(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const q = styleQuery.trim().toLowerCase();
                        const hit = styleOptions.find(
                          (s) =>
                            !genres.includes(s.value) &&
                            (s.label.toLowerCase().includes(q) ||
                              s.value.toLowerCase().includes(q)),
                        );
                        if (hit) addStyle(hit.value);
                      }}
                    />
                  </label>
                  {styleSearchOpen && (
                    <ul class="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-base-content/15 bg-base-200 py-1 shadow-lg">
                      {(() => {
                        const q = styleQuery.trim().toLowerCase();
                        const hits = styleOptions.filter((s) => {
                          if (genres.includes(s.value)) return false;
                          if (!q) return true;
                          return (
                            s.label.toLowerCase().includes(q) ||
                            s.value.toLowerCase().includes(q)
                          );
                        });
                        const shown = q ? hits.slice(0, 8) : hits.slice(0, 6);
                        if (!shown.length) {
                          return (
                            <li class="px-3 py-2 text-xs text-base-content/50">
                              {q ? `Aucun style pour « ${styleQuery.trim()} »` : "Tous les styles sont déjà ajoutés"}
                            </li>
                          );
                        }
                        return shown.map((s) => (
                          <li key={s.value}>
                            <button
                              type="button"
                              class="w-full px-3 py-2 text-left text-sm hover:bg-primary/15"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => addStyle(s.value)}
                            >
                              {s.label}
                            </button>
                          </li>
                        ));
                      })()}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div class="mt-6 flex gap-2">
          <button type="button" class="btn btn-ghost flex-1" onClick={onClose}>
            Annuler
          </button>
          <button type="button" class="btn btn-primary flex-1" onClick={handleConfirm}>
            Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}
