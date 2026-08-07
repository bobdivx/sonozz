import { useEffect, useRef, useState } from "preact/hooks";
import { Check, Search, X } from "lucide-preact";
import { api } from "../lib/apiClient.js";

function pickKey(p) {
  return `${p?.source || ""}:${p?.id || ""}`;
}

/**
 * Recherche Deezer/iTunes/Spotify + validation d'un titre de référence.
 */
export default function StyleTrackPicker({
  pick = null,
  disabled = false,
  compact = false,
  label = "Titre de référence (optionnel)",
  hint = "Tape un titre, clique sur la loupe — on écoute le preview de CE morceau pour caler BPM, groove et prod.",
  onPickChange,
}) {
  const [query, setQuery] = useState(
    pick?.name && pick?.artistName ? `${pick.name} — ${pick.artistName}` : pick?.name || "",
  );
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const lastQueryRef = useRef("");

  useEffect(() => {
    if (pick?.name && !query) {
      setQuery(
        pick.artistName ? `${pick.name} — ${pick.artistName}` : pick.name,
      );
    }
  }, [pick?.id]);

  function updateQuery(next) {
    setQuery(next);
    if (pick) onPickChange?.(null);
    setCandidates([]);
    setSearched(false);
    setError("");
  }

  async function runSearch(q = query) {
    const trimmed = String(q || "").trim();
    if (trimmed.length < 2) {
      setError("Saisis au moins 2 caractères.");
      return;
    }
    setSearching(true);
    setError("");
    setSearched(true);
    lastQueryRef.current = trimmed;
    try {
      const data = await api.searchStyleTracks(trimmed);
      if (lastQueryRef.current !== trimmed) return;
      setCandidates(data.candidates || []);
      if (!(data.candidates || []).length) {
        setError(`Aucun titre trouvé pour « ${trimmed} ». Essaie « Titre Artiste ».`);
      }
    } catch (e) {
      if (lastQueryRef.current !== trimmed) return;
      setCandidates([]);
      setError(e.message || "Recherche impossible");
    } finally {
      setSearching(false);
    }
  }

  function selectCandidate(c) {
    const next = {
      source: c.source,
      id: String(c.id),
      name: c.name,
      artistName: c.artistName || "",
      artistId: c.artistId,
      album: c.album || "",
      image: c.image || null,
      previewUrl: c.previewUrl || null,
      url: c.url || null,
      duration: c.duration || null,
      genres: Array.isArray(c.genres) ? c.genres.filter(Boolean) : [],
    };
    onPickChange?.(next);
    setQuery(`${next.name}${next.artistName ? ` — ${next.artistName}` : ""}`);
    setCandidates([]);
    setError("");
  }

  return (
    <div class={`space-y-2 ${compact ? "" : "pt-1"}`}>
      <div>
        <p class="text-sm text-base-content/70">{label}</p>
        {hint && <p class="mt-0.5 text-xs text-base-content/45">{hint}</p>}
      </div>

      <div class="flex gap-2">
        <input
          class="input input-bordered min-w-0 flex-1 bg-base-200"
          type="search"
          placeholder="Ex. Blinding Lights — The Weeknd"
          value={query}
          disabled={disabled}
          onInput={(e) => updateQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runSearch();
            }
          }}
        />
        <button
          type="button"
          class="btn btn-ghost btn-square"
          disabled={disabled || searching}
          onClick={() => runSearch()}
          title="Rechercher"
        >
          {searching ? (
            <span class="loading loading-spinner loading-sm" />
          ) : (
            <Search size={16} />
          )}
        </button>
      </div>

      {pick?.id && (
        <div class="flex items-center gap-3 border border-primary/30 bg-primary/10 p-2">
          {pick.image ? (
            <img src={pick.image} alt="" class="h-10 w-10 shrink-0 object-cover" />
          ) : (
            <div class="flex h-10 w-10 shrink-0 items-center justify-center bg-base-300 text-xs">
              ?
            </div>
          )}
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-1.5 truncate text-sm font-medium text-primary">
              <Check size={14} />
              {pick.name}
            </p>
            <p class="truncate text-[11px] text-base-content/55">
              {pick.artistName || "—"}
              {pick.source ? ` · ${pick.source}` : ""}
              {pick.album ? ` · ${pick.album}` : ""}
            </p>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            disabled={disabled}
            onClick={() => {
              onPickChange?.(null);
              setQuery("");
            }}
            title="Retirer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {candidates.length > 0 && (
        <ul class="max-h-56 space-y-1 overflow-y-auto border border-base-content/10 bg-base-200/60 p-1">
          {candidates.map((c) => (
            <li key={pickKey(c)}>
              <button
                type="button"
                class="flex w-full items-center gap-3 p-2 text-left hover:bg-base-300/60"
                disabled={disabled}
                onClick={() => selectCandidate(c)}
              >
                {c.image ? (
                  <img src={c.image} alt="" class="h-10 w-10 shrink-0 object-cover" />
                ) : (
                  <div class="flex h-10 w-10 shrink-0 items-center justify-center bg-base-300 text-xs">
                    ?
                  </div>
                )}
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{c.name}</p>
              <p class="truncate text-[11px] text-base-content/55">
                {c.artistName || "—"}
                {c.source ? ` · ${c.source}` : ""}
                {c.genres?.[0] ? ` · ${c.genres[0]}` : ""}
                {c.previewUrl ? " · preview" : ""}
              </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p class="text-xs text-warning">{error}</p>}
      {searched && !error && !candidates.length && !pick && !searching && (
        <p class="text-xs text-base-content/45">Aucun résultat.</p>
      )}
    </div>
  );
}
