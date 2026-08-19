import { Ban, Library, RotateCcw, Trash2 } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { ALBUM_SIZES } from "../lib/studio.js";
import { albumHasWorkLeft, albumNeedsCover, isAlbumStale } from "../lib/albumTracks.js";

function albumStatusLabel(st) {
  if (st === "done") return "OK";
  if (st === "lyrics") return "Paroles…";
  if (st === "audio") return "Audio…";
  if (st === "error") return "Erreur";
  if (st === "pending") return "En attente";
  if (st === "cancelled") return "Annulé";
  return st || "—";
}

/**
 * UI Album autonome (présentation).
 * La génération / persist est gérée par le parent (fiche artiste).
 */
export default function AlbumAutonomePanel({
  album = null,
  albumSize = 8,
  onAlbumSizeChange,
  loading = false,
  canGenerate = true,
  progress = null,
  leadTitle = "",
  onGenerate,
  onCancel,
  onResume,
  onClear,
  onRemoveTrack,
  onOpenTrack,
  studioHref = null,
  manageMode = false,
}) {
  const albumRunning = album?.status === "running";
  const albumTracks = Array.isArray(album?.tracks) ? album.tracks : [];
  const albumDoneCount = albumTracks.filter((t) => t.status === "done").length;
  const canResume =
    Boolean(onResume) &&
    !albumRunning &&
    (albumHasWorkLeft(album) || albumNeedsCover(album));
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!albumRunning) return undefined;
    const id = window.setInterval(() => setTick((n) => n + 1), 15000);
    return () => window.clearInterval(id);
  }, [albumRunning]);
  const stale = isAlbumStale(album);

  return (
    <div class="space-y-4 rounded-2xl border border-primary/25 bg-primary/5 p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        {album?.cover?.imageUrl ? (
          <img
            src={album.cover.imageUrl}
            alt=""
            class="h-16 w-16 shrink-0 rounded-xl object-cover"
          />
        ) : null}
        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-2 text-sm font-medium">
            <Library size={16} class="text-primary" />
            {manageMode && album?.title ? album.title : manageMode ? "Gérer l’album" : "Nouvel album"}
          </p>
          <p class="mt-1 text-xs text-base-content/60">
            {manageMode
              ? "Ajoute, retire, reprends une génération ou ouvre chaque piste dans le Studio."
              : (
                <>
                  À partir du single lead
                  {leadTitle ? (
                    <>
                      {" "}
                      « <span class="text-base-content/80">{leadTitle}</span> »
                    </>
                  ) : null}{" "}
                  — génère le reste (paroles, audio et jaquette), même style.
                </>
              )}
          </p>
        </div>
        <select
          class="select select-bordered select-sm bg-base-100"
          value={albumSize}
          disabled={loading || albumRunning}
          onChange={(e) => onAlbumSizeChange?.(Number(e.currentTarget.value) || 8)}
        >
          {ALBUM_SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn btn-outline btn-sm gap-2"
          disabled={loading || albumRunning || !canGenerate}
          onClick={() => onGenerate?.(albumSize)}
        >
          {albumRunning ? (
            <span class="loading loading-spinner loading-xs" />
          ) : (
            <Library size={14} />
          )}
          {albumRunning
            ? `Album en cours (${albumDoneCount}/${album.targetCount || albumSize})…`
            : album?.status === "done" || album?.status === "cancelled"
              ? `Relancer un album (${albumSize} titres)`
              : `Créer l’album (${albumSize} titres)`}
        </button>
        {albumRunning && (
          <button
            type="button"
            class="btn btn-ghost btn-sm gap-2 text-error"
            onClick={() => onCancel?.()}
          >
            <Ban size={14} />
            {stale ? "Forcer l’arrêt" : "Annuler"}
          </button>
        )}
        {canResume && (
          <button
            type="button"
            class="btn btn-outline btn-sm gap-2"
            disabled={loading}
            onClick={() => onResume?.()}
          >
            <RotateCcw size={14} />
            {albumHasWorkLeft(album)
              ? `Reprendre (${albumDoneCount} OK)`
              : "Générer la jaquette"}
          </button>
        )}
        {album && !albumRunning && (
          <button
            type="button"
            class="btn btn-ghost btn-sm gap-2 text-error"
            onClick={() => onClear?.()}
          >
            <Trash2 size={14} />
            Effacer l’album
          </button>
        )}
        {studioHref && (
          <a class="btn btn-ghost btn-sm" href={studioHref}>
            Ouvrir le lead dans le Studio
          </a>
        )}
      </div>

      {progress?.message && (
        <div class="space-y-1">
          <p class="text-xs text-base-content/60">{progress.message}</p>
          <div class="h-1.5 overflow-hidden rounded-full bg-base-300">
            <div
              class="h-full bg-primary transition-all"
              style={{ width: `${Math.max(4, Number(progress.percent) || 0)}%` }}
            />
          </div>
        </div>
      )}

      {album?.title && (
        <p class="text-xs text-base-content/55">
          <span class="font-medium text-base-content/80">{album.title}</span>
          {album.concept ? ` — ${album.concept}` : ""}
        </p>
      )}
      {album?.coverError && !album?.cover?.imageUrl && (
        <p class="text-xs text-warning">{album.coverError}</p>
      )}

      {albumTracks.length > 0 && (
        <ul class="divide-y divide-base-content/10 border border-base-content/10 bg-base-100/60">
          {albumTracks.map((entry) => (
            <li
              key={entry.id}
              class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">
                  {entry.index}.{" "}
                  {entry.lyrics?.title || entry.workingTitle || entry.theme || "Sans titre"}
                  {entry.role === "lead" ? (
                    <span class="badge badge-primary badge-xs ml-2">Lead</span>
                  ) : null}
                </p>
                <p class="truncate text-xs text-base-content/50">{entry.theme}</p>
                {entry.error && <p class="text-xs text-error">{entry.error}</p>}
                {entry.track?.warning && (
                  <p class="text-xs text-warning">{entry.track.warning}</p>
                )}
              </div>
              <div class="flex items-center gap-2">
                <span
                  class={`badge badge-sm ${
                    entry.status === "done"
                      ? "badge-success"
                      : entry.status === "error"
                        ? "badge-error"
                        : entry.status === "pending"
                          ? "badge-ghost"
                          : "badge-warning"
                  }`}
                >
                  {albumStatusLabel(entry.status)}
                </span>
                {(entry.track?.audioUrl || entry.lyrics) && onOpenTrack && (
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    onClick={() => onOpenTrack(entry)}
                  >
                    Ouvrir dans le Studio
                  </button>
                )}
                <button
                  type="button"
                  class="btn btn-ghost btn-xs text-error"
                  title={
                    entry.role === "lead"
                      ? "Effacer l’album (le single lead reste)"
                      : "Retirer ce morceau"
                  }
                  onClick={() => onRemoveTrack?.(entry.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {albumRunning && (
        <p class={`text-xs ${stale ? "text-warning" : "text-base-content/50"}`}>
          {stale
            ? "Plus de progression depuis ~1 min — ACE est peut-être saturé ou injoignable. Force l’arrêt, puis Reprendre."
            : "Tu peux changer de page : la génération continue dans Tâches."}
        </p>
      )}
    </div>
  );
}
