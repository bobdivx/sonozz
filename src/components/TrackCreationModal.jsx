import { useState } from "preact/hooks";
import { X } from "lucide-preact";

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
  const [newGenre, setNewGenre] = useState("");
  const [newReferences, setNewReferences] = useState("");
  const [newReferenceTrack, setNewReferenceTrack] = useState("");

  if (!open) return null;

  const handleConfirm = () => {
    if (keepSettings) {
      onConfirm({
        genre: currentGenre,
        references: currentReferences,
        referenceTrack: currentReferenceTrack,
      });
    } else {
      onConfirm({
        genre: newGenre.trim() || currentGenre,
        references: newReferences
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean),
        referenceTrack: newReferenceTrack.trim() || currentReferenceTrack,
      });
    }
  };

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
            <div class="space-y-3 rounded-2xl border border-base-content/10 bg-base-300/40 p-4">
              <div class="form-control">
                <label class="label">
                  <span class="label-text text-xs font-medium">Nouveau genre</span>
                </label>
                <input
                  type="text"
                  class="input input-bordered input-sm"
                  placeholder={currentGenre || "Pop, Rap, etc."}
                  value={newGenre}
                  onInput={(e) => setNewGenre(e.currentTarget.value)}
                />
              </div>

              <div class="form-control">
                <label class="label">
                  <span class="label-text text-xs font-medium">
                    Artistes de référence (séparés par des virgules)
                  </span>
                </label>
                <input
                  type="text"
                  class="input input-bordered input-sm"
                  placeholder="Artiste 1, Artiste 2"
                  value={newReferences}
                  onInput={(e) => setNewReferences(e.currentTarget.value)}
                />
              </div>

              <div class="form-control">
                <label class="label">
                  <span class="label-text text-xs font-medium">Titre de référence (optionnel)</span>
                </label>
                <input
                  type="text"
                  class="input input-bordered input-sm"
                  placeholder="Nom du titre"
                  value={newReferenceTrack}
                  onInput={(e) => setNewReferenceTrack(e.currentTarget.value)}
                />
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
