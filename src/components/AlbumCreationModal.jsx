import { useEffect, useState } from "preact/hooks";
import { Library, Users, X } from "lucide-preact";
import { albumsApi } from "../lib/albumsApi.js";
import { featPoolFromCatalog } from "../lib/albumAutoFeats.js";

export default function AlbumCreationModal({
  slug,
  leadCandidates = [],
  leadArtist = null,
  onClose,
  onCreate,
}) {
  const [leadId, setLeadId] = useState(leadCandidates[0]?.id || "");
  const [memberIds, setMemberIds] = useState([]);
  const [title, setTitle] = useState("");
  const [concept, setConcept] = useState("");
  const [albumSize, setAlbumSize] = useState(8);
  const [withFeats, setWithFeats] = useState(false);
  const [featPool, setFeatPool] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedLead = leadCandidates.find((c) => c.id === leadId);
  const memberCandidates = leadCandidates.filter((c) => c.id && c.id !== leadId);
  const canUseFeats = featPool.length > 0;
  const minSizeFromMembers = 1 + memberIds.length;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCatalogLoading(true);
      try {
        const res = await fetch("/api/artists");
        const data = res.ok ? await res.json() : {};
        const artists = Array.isArray(data?.artists) ? data.artists : Array.isArray(data) ? data : [];
        if (cancelled) return;
        setFeatPool(
          featPoolFromCatalog(
            artists,
            leadArtist?.slug || slug,
            leadArtist?.name || "",
          ),
        );
      } catch {
        if (!cancelled) setFeatPool([]);
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, leadArtist?.slug, leadArtist?.name]);

  useEffect(() => {
    if (!canUseFeats && withFeats) setWithFeats(false);
  }, [canUseFeats, withFeats]);

  useEffect(() => {
    setMemberIds((prev) => prev.filter((id) => id !== leadId));
  }, [leadId]);

  useEffect(() => {
    if (albumSize < minSizeFromMembers) {
      setAlbumSize(Math.min(12, minSizeFromMembers));
    }
  }, [minSizeFromMembers, albumSize]);

  function toggleMember(id) {
    setMemberIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length + 1 >= 12) return prev;
      return [...prev, id];
    });
  }

  async function handleCreate(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();

    if (!leadId) {
      setError("Sélectionne un titre lead");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const targetCount = Math.min(
        12,
        Math.max(3, Math.max(Number(albumSize) || 8, minSizeFromMembers)),
      );
      const albumTitle =
        title.trim() || selectedLead?.trackTitle || selectedLead?.title || "Album";
      const albumConcept = concept.trim();
      const album = await albumsApi.createAlbum({
        artistSlug: slug,
        leadProjectId: leadId,
        title: albumTitle,
        concept: albumConcept,
        targetCount,
      });

      const selectedMembers = memberCandidates.filter((c) => memberIds.includes(c.id));
      for (let i = 0; i < selectedMembers.length; i++) {
        const m = selectedMembers[i];
        await albumsApi.addTrack(album.id, {
          projectId: m.id,
          role: "member",
          index: i + 2,
          workingTitle: m.trackTitle || m.title || "",
          theme: m.theme || "",
          status: "done",
        });
      }

      if (onCreate) {
        onCreate({
          album,
          leadProjectId: leadId,
          title: albumTitle,
          concept: albumConcept,
          targetCount,
          memberProjectIds: selectedMembers.map((m) => m.id),
          withFeats: Boolean(withFeats && canUseFeats),
          featArtists: withFeats && canUseFeats ? featPool : [],
        });
      }
      onClose?.();
    } catch (err) {
      setError(err?.message || "Impossible de créer l'album");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-rise"
      onClick={() => !loading && onClose?.()}
      role="presentation"
    >
      <div
        class="relative mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-base-content/10 bg-base-200 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="album-create-title"
      >
        <button
          type="button"
          class="btn btn-ghost btn-circle btn-sm absolute right-4 top-4"
          onClick={onClose}
          disabled={loading}
          aria-label="Fermer"
        >
          <X size={18} />
        </button>

        <h2 id="album-create-title" class="font-display pr-10 text-2xl font-bold">
          Créer un nouvel album
        </h2>
        <p class="mt-2 text-sm text-base-content/60">
          Choisis un lead, déplace d’autres singles dedans si tu veux, puis complète avec de nouveaux titres.
        </p>

        <form class="mt-6 space-y-4" onSubmit={handleCreate}>
          <label class="block w-full">
            <span class="mb-1.5 block text-sm text-base-content/60">Titre lead</span>
            <select
              class="select select-bordered w-full"
              value={leadId}
              onChange={(e) => setLeadId(e.currentTarget.value)}
              disabled={loading || leadCandidates.length === 0}
              required
            >
              {leadCandidates.length === 0 ? (
                <option value="">Aucun titre disponible</option>
              ) : (
                <>
                  <option value="">-- Sélectionne un titre --</option>
                  {leadCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.trackTitle || c.title || c.id}
                    </option>
                  ))}
                </>
              )}
            </select>
            <span class="mt-1 block text-xs text-base-content/55">
              Le titre avec audio + paroles qui sera la base de l'album
            </span>
          </label>

          {memberCandidates.length > 0 && (
            <div class="rounded-2xl border border-base-content/10 bg-base-300/30 p-4">
              <p class="flex items-center gap-1.5 text-sm font-medium">
                <Library size={14} class="text-primary" />
                Singles à inclure
              </p>
              <p class="mt-1 text-xs text-base-content/55">
                Coche les singles déjà prêts à déplacer dans cet album. Le reste sera généré.
              </p>
              <ul class="mt-3 max-h-40 space-y-2 overflow-y-auto">
                {memberCandidates.map((c) => {
                  const checked = memberIds.includes(c.id);
                  return (
                    <li key={c.id}>
                      <label class="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-base-100/60">
                        <input
                          type="checkbox"
                          class="checkbox checkbox-primary checkbox-sm"
                          checked={checked}
                          disabled={loading}
                          onChange={() => toggleMember(c.id)}
                        />
                        <span class="min-w-0 truncate text-sm">
                          {c.trackTitle || c.title || c.id}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {memberIds.length > 0 && (
                <p class="mt-2 text-xs text-base-content/55">
                  {memberIds.length} single{memberIds.length > 1 ? "s" : ""} + lead
                  {` → ${minSizeFromMembers} titre${minSizeFromMembers > 1 ? "s" : ""} déjà prêts`}
                </p>
              )}
            </div>
          )}

          <label class="block w-full">
            <span class="mb-1.5 block text-sm text-base-content/60">Titre de l'album (optionnel)</span>
            <input
              type="text"
              class="input input-bordered w-full"
              value={title}
              onInput={(e) => setTitle(e.currentTarget.value)}
              placeholder={selectedLead?.trackTitle || selectedLead?.title || "Titre automatique"}
              disabled={loading}
            />
          </label>

          <label class="block w-full">
            <span class="mb-1.5 block text-sm text-base-content/60">Concept (optionnel)</span>
            <textarea
              class="textarea textarea-bordered w-full"
              rows={3}
              value={concept}
              onInput={(e) => setConcept(e.currentTarget.value)}
              placeholder="Décris l'ambiance ou le thème de l'album…"
              disabled={loading}
            />
          </label>

          <label class="block w-full">
            <span class="mb-1.5 block text-sm text-base-content/60">Nombre de titres</span>
            <input
              type="number"
              class="input input-bordered w-full"
              min={Math.max(3, minSizeFromMembers)}
              max={12}
              value={albumSize}
              onInput={(e) => setAlbumSize(Number(e.currentTarget.value) || 8)}
              disabled={loading}
            />
            <span class="mt-1 block text-xs text-base-content/55">
              Entre {Math.max(3, minSizeFromMembers)} et 12 titres (lead + singles inclus)
              {minSizeFromMembers > 1
                ? ` — ${Math.max(0, albumSize - minSizeFromMembers)} à générer`
                : ""}
            </span>
          </label>

          <div class="rounded-2xl border border-base-content/10 bg-base-300/30 p-4">
            <label class="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                class="checkbox checkbox-primary mt-0.5"
                checked={withFeats}
                disabled={loading || catalogLoading || !canUseFeats}
                onChange={(e) => setWithFeats(e.currentTarget.checked)}
              />
              <span class="min-w-0">
                <span class="flex items-center gap-1.5 text-sm font-medium">
                  <Users size={14} class="text-primary" />
                  Avec feats automatiques
                </span>
                <span class="mt-1 block text-xs text-base-content/55">
                  {catalogLoading
                    ? "Chargement du catalogue…"
                    : canUseFeats
                      ? `Seulement 2–3 titres en duo (pas tout l’album), avec tes autres artistes (${featPool
                          .map((f) => f.name)
                          .slice(0, 3)
                          .join(", ")}${featPool.length > 3 ? "…" : ""}). Le reste reste solo.`
                      : "Crée un autre profil artiste pour activer les feats."}
                </span>
              </span>
            </label>
          </div>

          {error && (
            <div class="rounded-xl border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </div>
          )}

          <div class="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" class="btn btn-ghost" onClick={onClose} disabled={loading}>
              Annuler
            </button>
            <button
              type="submit"
              class="btn btn-primary"
              disabled={loading || !leadId || leadCandidates.length === 0}
            >
              {loading ? (
                <span class="loading loading-spinner loading-sm" />
              ) : memberIds.length > 0 ? (
                "Créer et compléter"
              ) : (
                "Créer et lancer"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
