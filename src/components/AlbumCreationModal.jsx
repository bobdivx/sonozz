import { useState } from "preact/hooks";
import { X } from "lucide-preact";
import { albumsApi } from "../lib/albumsApi.js";

export default function AlbumCreationModal({ slug, leadCandidates = [], onClose, onCreate }) {
  const [leadId, setLeadId] = useState(leadCandidates[0]?.id || "");
  const [title, setTitle] = useState("");
  const [concept, setConcept] = useState("");
  const [albumSize, setAlbumSize] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedLead = leadCandidates.find((c) => c.id === leadId);

  async function handleCreate() {
    if (!leadId) {
      setError("Sélectionne un titre lead");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const album = await albumsApi.createAlbum({
        artistSlug: slug,
        leadProjectId: leadId,
        title: title || selectedLead?.trackTitle || "Album",
        concept,
        targetCount: albumSize,
      });

      if (onCreate) onCreate(album);
      onClose();
    } catch (e) {
      setError(e.message || "Impossible de créer l'album");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="modal modal-open">
      <div class="modal-box max-w-lg">
        <button
          class="btn btn-circle btn-ghost btn-sm absolute right-3 top-3"
          onClick={onClose}
          disabled={loading}
        >
          <X size={16} />
        </button>

        <h3 class="font-display text-xl font-bold">Créer un nouvel album</h3>
        <p class="mt-2 text-sm text-base-content/60">
          Chaque album est indépendant. Créer un nouvel album ne supprime pas les albums existants.
        </p>

        <div class="mt-5 space-y-4">
          <label class="form-control w-full">
            <span class="label-text">Titre lead</span>
            <select
              class="select select-bordered"
              value={leadId}
              onChange={(e) => setLeadId(e.currentTarget.value)}
              disabled={loading}
            >
              <option value="">-- Sélectionne un titre --</option>
              {leadCandidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.trackTitle || c.title || c.id}
                </option>
              ))}
            </select>
            <span class="label-text-alt mt-1 text-base-content/55">
              Le titre avec audio + paroles qui sera la base de l'album
            </span>
          </label>

          <label class="form-control w-full">
            <span class="label-text">Titre de l'album (optionnel)</span>
            <input
              type="text"
              class="input input-bordered"
              value={title}
              onInput={(e) => setTitle(e.currentTarget.value)}
              placeholder={selectedLead?.trackTitle || "Titre automatique"}
              disabled={loading}
            />
          </label>

          <label class="form-control w-full">
            <span class="label-text">Concept (optionnel)</span>
            <textarea
              class="textarea textarea-bordered"
              rows={3}
              value={concept}
              onInput={(e) => setConcept(e.currentTarget.value)}
              placeholder="Décris l'ambiance ou le thème de l'album…"
              disabled={loading}
            />
          </label>

          <label class="form-control w-full">
            <span class="label-text">Nombre de titres</span>
            <input
              type="number"
              class="input input-bordered"
              min={3}
              max={12}
              value={albumSize}
              onInput={(e) => setAlbumSize(Number(e.currentTarget.value) || 8)}
              disabled={loading}
            />
            <span class="label-text-alt mt-1 text-base-content/55">
              Entre 3 et 12 titres (lead inclus)
            </span>
          </label>

          {error && (
            <div class="border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </div>
          )}
        </div>

        <div class="modal-action">
          <button class="btn btn-ghost" onClick={onClose} disabled={loading}>
            Annuler
          </button>
          <button class="btn btn-primary" onClick={handleCreate} disabled={loading || !leadId}>
            {loading ? <span class="loading loading-spinner loading-sm" /> : "Créer l'album"}
          </button>
        </div>
      </div>
      <div class="modal-backdrop" onClick={onClose} />
    </div>
  );
}
