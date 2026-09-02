import { useEffect, useState } from "preact/hooks";
import { Trash2 } from "lucide-preact";
import AppShell from "./AppShell.jsx";
import ArtistStep from "./steps/ArtistStep.jsx";
import ConfirmModal from "./ConfirmModal.jsx";
import { api } from "../lib/apiClient.js";
import { keysReady, loadKeys, ensureKeysHydrated } from "../lib/keys.js";
import { isOncePublished } from "../lib/studio.js";

/**
 * Création / édition de profil artiste — hors du pipeline morceau.
 * @param {{ slug?: string, initialMode?: "self" | "fiction" }} props
 */
export default function ArtistCreatePage({ slug = "", initialMode } = {}) {
  const [savedSlug, setSavedSlug] = useState(slug);
  const [artist, setArtist] = useState(null);
  const [loading, setLoading] = useState(Boolean(slug));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [oncePublishedCount, setOncePublishedCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureKeysHydrated();
      if (!cancelled) setReady(keysReady(loadKeys()));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/artists/${encodeURIComponent(slug)}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Artiste introuvable");
        const hub = json.artist || {};
        if (!cancelled) {
          setArtist({
            ...(hub.profile || {}),
            name: hub.name || hub.profile?.name || "",
            slug: hub.slug || slug,
          });
          const onceCount = (hub.releases || []).filter((r) =>
            isOncePublished({
              status: r?.onceStatus,
              onceStatus: r?.onceStatus,
              provider: r?.distributed ? "once" : undefined,
              releaseId: r?.releaseId,
              distributed: Boolean(r?.distributed),
            }),
          ).length;
          setOncePublishedCount(onceCount);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Chargement impossible");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function handleGenerate(payload) {
    if (!keysReady(loadKeys())) {
      window.location.href = "/parametres?section=ia";
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const data = await api.artist({
        ...payload,
        slug: savedSlug || undefined,
        persist: true,
      });
      const nextSlug = data.slug || savedSlug;
      if (!nextSlug) throw new Error("Profil généré mais slug manquant");
      window.location.href = `/artiste/${encodeURIComponent(nextSlug)}`;
    } catch (e) {
      setError(e.message || "Génération du profil impossible");
      setSaving(false);
    }
  }

  async function handleSave(snapshot) {
    const profile = snapshot || artist;
    if (!profile?.name) {
      setError("Nom d’artiste manquant");
      return false;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const data = await api.saveArtistProfile(savedSlug || undefined, profile);
      const saved = data.artist || {};
      const nextSlug = saved.slug || savedSlug;
      setArtist({
        ...(saved.profile || profile),
        name: saved.name || saved.profile?.name || profile.name,
        slug: nextSlug,
      });
      if (nextSlug && nextSlug !== savedSlug) {
        setSavedSlug(nextSlug);
        window.history.replaceState(
          {},
          "",
          `/artiste/${encodeURIComponent(nextSlug)}/editer`,
        );
      }
      setNotice("Enregistré");
      return true;
    } catch (e) {
      setError(e.message || "Sauvegarde impossible");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteArtist() {
    if (!savedSlug || deleting) return;
    setConfirmDelete(false);
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      await api.deleteArtist(savedSlug);
      window.location.href = "/artistes";
    } catch (e) {
      setError(e.message || "Suppression impossible");
      setDeleting(false);
    }
  }

  const artistName = artist?.name || savedSlug || "cet artiste";
  const deleteMessage =
    oncePublishedCount > 0
      ? `Attention — ${oncePublishedCount} morceau(x) lié(s) ont déjà été publiés / soumis sur ONCE.\n\n` +
        `Supprimer ici n’annule PAS les releases ONCE ni les stores (Spotify, etc.).\n` +
        `Tu devras les gérer séparément dans le dashboard ONCE.\n\n` +
        `Continuer ? Cela efface définitivement « ${artistName} », tous ses projets / albums Turso, et les fichiers audio / clips sur S3.`
      : `Supprimer définitivement « ${artistName} » ?\n\n` +
        `Tous les projets, albums, et fichiers audio / clips S3 associés seront effacés. Cette action est irréversible.`;

  return (
    <AppShell
      active="artistes"
      title="Profil artiste"
      subtitle="Onglets Identité et Style musical. Sauvegarde à tout moment — le Studio sert ensuite aux morceaux."
    >
      <div class="mx-auto w-full min-w-0 max-w-3xl space-y-4">
        {!ready && (
          <p class="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            Configure un LLM dans{" "}
            <a class="underline" href="/parametres?section=ia">
              Paramètres
            </a>{" "}
            avant de générer un profil.
          </p>
        )}
        {error && <p class="text-sm text-error">{error}</p>}
        {notice && !error && <p class="text-sm text-success">{notice}</p>}
        {loading ? (
          <div class="h-64 animate-pulse rounded-2xl bg-base-300/50" />
        ) : (
          <ArtistStep
            artist={artist}
            loading={saving || deleting}
            initialMode={initialMode || artist?.mode || undefined}
            onGenerate={handleGenerate}
            onSave={handleSave}
            onPatchArtist={(patch) => {
              setArtist((prev) => ({ ...(prev || {}), ...patch }));
            }}
          />
        )}

        {savedSlug && !loading ? (
          <div class="rounded-2xl border border-error/25 bg-error/5 p-4">
            <h2 class="text-sm font-semibold text-error">Zone dangereuse</h2>
            <p class="mt-1 text-xs text-base-content/60">
              Supprime l’artiste de Turso, ses morceaux / albums, et les objets S3 (audio, clips,
              extrait vocal).
            </p>
            <button
              type="button"
              class="btn btn-error btn-outline mt-3 gap-2"
              disabled={deleting || saving}
              onClick={() => setConfirmDelete(true)}
            >
              {deleting ? (
                <span class="loading loading-spinner loading-sm" />
              ) : (
                <Trash2 size={16} />
              )}
              Supprimer l’artiste
            </button>
          </div>
        ) : null}
      </div>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDeleteArtist}
        title={`Supprimer « ${artistName} » ?`}
        message={deleteMessage}
        confirmText="Oui, supprimer"
        confirmClass="btn-error"
      />
    </AppShell>
  );
}
