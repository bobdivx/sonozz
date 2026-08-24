import { useState } from "preact/hooks";
import { Play, Pause, ThumbsUp, ThumbsDown, RefreshCw, History } from "lucide-preact";

/**
 * Panneau de revue des morceaux avec possibilité de les régénérer.
 * Garde l'historique des versions pour chaque morceau.
 */
export default function TrackReviewPanel({
  tracks = [],
  onPlayTrack,
  onRegenerateTrack,
  nowPlayingId = null,
  playing = false,
  busy = false,
}) {
  const [ratings, setRatings] = useState(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("sonozz-track-ratings") : null;
    return saved ? JSON.parse(saved) : {};
  });

  const [showHistory, setShowHistory] = useState({});

  const saveRatings = (newRatings) => {
    setRatings(newRatings);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("sonozz-track-ratings", JSON.stringify(newRatings));
    }
  };

  const rateTrack = (trackId, rating) => {
    const newRatings = { ...ratings, [trackId]: rating };
    saveRatings(newRatings);
  };

  const toggleHistory = (trackId) => {
    setShowHistory((prev) => ({ ...prev, [trackId]: !prev[trackId] }));
  };

  const handleRegenerate = async (track) => {
    const rating = ratings[track.id];
    if (rating === "like") {
      const confirmed = window.confirm(
        `Tu as marqué ce morceau comme apprécié. Es-tu sûr de vouloir le régénérer ?`
      );
      if (!confirmed) return;
    }

    const keepGenre = window.confirm(
      `Régénération de « ${track.trackTitle || track.title} »\n\nGarder le genre et les références actuels ?`
    );

    await onRegenerateTrack(track, { keepGenre });
  };

  if (!tracks.length) {
    return (
      <div class="rounded-3xl border border-dashed border-base-content/15 bg-base-300/20 px-5 py-8 text-center">
        <p class="text-sm text-base-content/60">
          Aucun morceau à réviser pour le moment. Crée des titres dans le Studio !
        </p>
      </div>
    );
  }

  const likedTracks = tracks.filter((t) => ratings[t.id] === "like");
  const dislikedTracks = tracks.filter((t) => ratings[t.id] === "dislike");
  const neutralTracks = tracks.filter((t) => !ratings[t.id]);

  return (
    <div class="space-y-4">
      <div class="flex flex-wrap gap-2 text-xs">
        <span class="rounded-full bg-success/10 px-2.5 py-1 text-success">
          {likedTracks.length} apprécié{likedTracks.length !== 1 ? "s" : ""}
        </span>
        <span class="rounded-full bg-error/10 px-2.5 py-1 text-error">
          {dislikedTracks.length} à améliorer
        </span>
        <span class="rounded-full bg-base-content/10 px-2.5 py-1 text-base-content/60">
          {neutralTracks.length} non noté{neutralTracks.length !== 1 ? "s" : ""}
        </span>
      </div>

      <ul class="space-y-2">
        {tracks.map((track) => {
          const isCurrent = nowPlayingId === track.id;
          const rating = ratings[track.id];
          const hasVersions = Array.isArray(track.trackVersions) && track.trackVersions.length > 1;

          return (
            <li
              key={track.id}
              class={`overflow-hidden rounded-2xl border bg-base-300/40 transition ${
                isCurrent ? "border-primary/50" : "border-base-content/10"
              }`}
            >
              <div class="flex gap-3 p-3">
                {track.audioUrl && (
                  <button
                    type="button"
                    class="btn btn-circle btn-ghost btn-sm shrink-0"
                    onClick={() => onPlayTrack(track)}
                    aria-label={isCurrent && playing ? "Pause" : "Lire"}
                  >
                    {isCurrent && playing ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                )}

                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium">{track.trackTitle || track.title}</p>
                  <p class="text-xs text-base-content/50">
                    {track.status === "audio" || track.hasAudio ? "Audio généré" : "Paroles seulement"}
                  </p>
                </div>

                <div class="flex shrink-0 gap-1">
                  <button
                    type="button"
                    class={`btn btn-circle btn-ghost btn-sm ${rating === "like" ? "text-success" : ""}`}
                    onClick={() => rateTrack(track.id, rating === "like" ? null : "like")}
                    aria-label="J'aime"
                  >
                    <ThumbsUp size={16} fill={rating === "like" ? "currentColor" : "none"} />
                  </button>

                  <button
                    type="button"
                    class={`btn btn-circle btn-ghost btn-sm ${rating === "dislike" ? "text-error" : ""}`}
                    onClick={() => rateTrack(track.id, rating === "dislike" ? null : "dislike")}
                    aria-label="Je n'aime pas"
                  >
                    <ThumbsDown size={16} fill={rating === "dislike" ? "currentColor" : "none"} />
                  </button>

                  {track.hasAudio && (
                    <button
                      type="button"
                      class="btn btn-circle btn-ghost btn-sm"
                      onClick={() => handleRegenerate(track)}
                      disabled={busy}
                      aria-label="Régénérer"
                    >
                      {busy ? (
                        <span class="loading loading-spinner loading-xs" />
                      ) : (
                        <RefreshCw size={16} />
                      )}
                    </button>
                  )}

                  {hasVersions && (
                    <button
                      type="button"
                      class="btn btn-circle btn-ghost btn-sm"
                      onClick={() => toggleHistory(track.id)}
                      aria-label="Historique"
                    >
                      <History size={16} />
                    </button>
                  )}
                </div>
              </div>

              {showHistory[track.id] && hasVersions && (
                <div class="border-t border-base-content/10 bg-base-200/50 p-3">
                  <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-base-content/45">
                    Versions précédentes ({track.trackVersions.length})
                  </p>
                  <ul class="space-y-1.5">
                    {track.trackVersions.map((version, i) => (
                      <li
                        key={i}
                        class="flex items-center justify-between rounded bg-base-300/60 px-2 py-1.5 text-xs"
                      >
                        <span class="text-base-content/60">
                          Version {track.trackVersions.length - i}
                          {i === 0 ? " (actuelle)" : ""}
                        </span>
                        {version.audioUrl && (
                          <a
                            href={version.audioUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="link-primary link text-xs"
                          >
                            Écouter
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
