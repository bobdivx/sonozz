import { useEffect, useRef, useState } from "preact/hooks";
import { Check, Search, X } from "lucide-preact";
import { api } from "../lib/apiClient.js";

function formatFans(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M fans`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k fans`;
  return `${v} fans`;
}

function pickKey(p) {
  return `${p?.source || ""}:${p?.id || ""}`;
}

/**
 * Recherche Spotify/Deezer + validation d'un ou plusieurs candidats.
 * @param {{
 *   value?: string,
 *   pick?: object | null,
 *   picks?: object[],
 *   multiple?: boolean,
 *   maxPicks?: number,
 *   disabled?: boolean,
 *   compact?: boolean,
 *   label?: string,
 *   hint?: string,
 *   onQueryChange?: (q: string) => void,
 *   onPickChange?: (pick: object | null) => void,
 *   onPicksChange?: (picks: object[]) => void,
 * }} props
 */
export default function StyleArtistPicker({
  value = "",
  pick = null,
  picks = null,
  multiple = false,
  maxPicks = 5,
  disabled = false,
  compact = false,
  label,
  hint,
  onQueryChange,
  onPickChange,
  onPicksChange,
}) {
  const selected = multiple
    ? Array.isArray(picks)
      ? picks
      : pick
        ? [pick]
        : []
    : [];
  const single = multiple ? null : pick;

  const [query, setQuery] = useState(value || single?.name || "");
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef(0);
  const lastQueryRef = useRef("");

  useEffect(() => {
    if (!multiple && single?.name && !query) setQuery(single.name);
  }, [single?.id]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, []);

  function updateQuery(next) {
    setQuery(next);
    onQueryChange?.(next);
    if (!multiple && single) {
      onPickChange?.(null);
    }
    setCandidates([]);
    setSearched(false);
    setError("");

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const q = next.trim();
    if (q.length < 2) return;
    debounceRef.current = window.setTimeout(() => {
      runSearch(q);
    }, 450);
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
      const data = await api.searchStyleArtists(trimmed);
      if (lastQueryRef.current !== trimmed) return;
      setCandidates(data.candidates || []);
      if (!(data.candidates || []).length) {
        setError(`Aucun artiste trouvé pour « ${trimmed} ». Essaie une autre orthographe.`);
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
      image: c.image || null,
      genres: c.genres || [],
      followers: c.followers ?? null,
      popularity: c.popularity ?? null,
      url: c.url || null,
    };

    if (multiple) {
      if (selected.some((p) => pickKey(p) === pickKey(next))) {
        setCandidates([]);
        setSearched(false);
        setQuery("");
        onQueryChange?.("");
        return;
      }
      if (selected.length >= maxPicks) {
        setError(`Maximum ${maxPicks} artistes favoris.`);
        return;
      }
      onPicksChange?.([...selected, next]);
      setQuery("");
      onQueryChange?.("");
    } else {
      setQuery(c.name);
      onPickChange?.(next);
    }
    setCandidates([]);
    setSearched(false);
    setError("");
  }

  function clearPick() {
    onPickChange?.(null);
    setCandidates([]);
    setSearched(false);
  }

  function removePick(target) {
    onPicksChange?.(selected.filter((p) => pickKey(p) !== pickKey(target)));
  }

  const title =
    label ||
    (multiple ? "Artistes que tu aimes" : "Caler le son sur un artiste réel");
  const help =
    hint ||
    (multiple
      ? `Ajoute jusqu’à ${maxPicks} artistes — les morceaux seront calés sur leur son.`
      : "Tape un nom, choisis le bon résultat (iTunes / Spotify / Deezer), puis valide.");

  return (
    <div class={`space-y-2 ${compact ? "" : "w-full"}`}>
      <span class={`label-text mb-1 block ${compact ? "text-xs" : "text-sm"} text-base-content/55`}>
        {title}
      </span>
      <div class="flex gap-2">
        <input
          class="input input-bordered min-w-0 flex-1 bg-base-200"
          type="text"
          placeholder={multiple ? "Ex. Aya Nakamura, Damso…" : "Ex. Jonah Dean, Aya Nakamura…"}
          value={query}
          disabled={disabled || searching || (multiple && selected.length >= maxPicks)}
          onInput={(e) => updateQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (debounceRef.current) window.clearTimeout(debounceRef.current);
              runSearch();
            }
          }}
        />
        <button
          type="button"
          class="btn btn-ghost border border-base-content/15"
          disabled={disabled || searching || query.trim().length < 2}
          onClick={() => {
            if (debounceRef.current) window.clearTimeout(debounceRef.current);
            runSearch();
          }}
          title="Rechercher"
        >
          {searching ? (
            <span class="loading loading-spinner loading-sm" />
          ) : (
            <Search size={16} />
          )}
        </button>
      </div>

      {multiple && selected.length > 0 && (
        <ul class="space-y-1.5">
          {selected.map((p) => (
            <li
              key={pickKey(p)}
              class="flex items-center gap-3 border border-primary/30 bg-primary/10 p-2"
            >
              {p.image ? (
                <img src={p.image} alt="" class="h-10 w-10 shrink-0 object-cover" />
              ) : (
                <div class="flex h-10 w-10 shrink-0 items-center justify-center bg-base-300 text-xs">
                  ?
                </div>
              )}
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-1.5 truncate text-sm font-medium text-primary">
                  <Check size={14} />
                  {p.name}
                </p>
                <p class="truncate text-[11px] text-base-content/55">
                  {p.source}
                  {p.genres?.length ? ` · ${p.genres.slice(0, 2).join(", ")}` : ""}
                </p>
              </div>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                disabled={disabled}
                onClick={() => removePick(p)}
                title="Retirer"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!multiple && single ? (
        <div class="flex items-center gap-3 border border-primary/30 bg-primary/10 p-2.5">
          {single.image ? (
            <img src={single.image} alt="" class="h-12 w-12 shrink-0 object-cover" />
          ) : (
            <div class="flex h-12 w-12 shrink-0 items-center justify-center bg-base-300 text-xs">
              ?
            </div>
          )}
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-1.5 truncate text-sm font-medium text-primary">
              <Check size={14} />
              {single.name}
            </p>
            <p class="truncate text-[11px] text-base-content/55">
              Validé · {single.source}
              {single.genres?.length ? ` · ${single.genres.slice(0, 2).join(", ")}` : ""}
              {formatFans(single.followers) ? ` · ${formatFans(single.followers)}` : ""}
            </p>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            disabled={disabled}
            onClick={clearPick}
            title="Changer"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        !multiple && (
          <p class="text-[11px] text-base-content/45">{help}</p>
        )
      )}

      {multiple && <p class="text-[11px] text-base-content/45">{help}</p>}

      {error && <p class="text-xs text-warning">{error}</p>}

      {candidates.length > 0 && (
        <ul class="max-h-64 space-y-1 overflow-y-auto border border-base-content/10 bg-base-200/80 p-1">
          {candidates.map((c) => (
            <li key={`${c.source}-${c.id}`}>
              <button
                type="button"
                class="flex w-full items-center gap-3 p-2 text-left transition hover:bg-primary/15"
                disabled={disabled}
                onClick={() => selectCandidate(c)}
              >
                {c.image ? (
                  <img src={c.image} alt="" class="h-10 w-10 shrink-0 object-cover" />
                ) : (
                  <div class="flex h-10 w-10 shrink-0 items-center justify-center bg-base-300 text-[10px]">
                    ?
                  </div>
                )}
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{c.name}</p>
                  <p class="truncate text-[11px] text-base-content/50">
                    {c.source}
                    {c.genres?.length ? ` · ${c.genres.slice(0, 2).join(", ")}` : ""}
                    {formatFans(c.followers) ? ` · ${formatFans(c.followers)}` : ""}
                  </p>
                </div>
                <span class="btn btn-primary btn-xs shrink-0">
                  {multiple ? "Ajouter" : "Choisir"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {searched && !searching && !candidates.length && !error && (
        <p class="text-xs text-base-content/50">Aucun résultat.</p>
      )}
    </div>
  );
}
