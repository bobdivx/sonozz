import { useEffect, useRef, useState } from "preact/hooks";
import { AlertTriangle, Check, ExternalLink } from "lucide-preact";
import { api } from "../lib/apiClient.js";

function formatFans(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M fans`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k fans`;
  return `${v} fans`;
}

/**
 * Champ nom de scène + vérif dispo Spotify / Apple / Deezer.
 * @param {{
 *   value?: string,
 *   disabled?: boolean,
 *   placeholder?: string,
 *   allowTakenName?: boolean,
 *   onChange?: (name: string) => void,
 *   onAllowTakenNameChange?: (allow: boolean) => void,
 *   onAvailabilityChange?: (status: object | null) => void,
 * }} props
 */
export default function ArtistNameField({
  value = "",
  disabled = false,
  placeholder = "Laisser vide pour générer un nom",
  allowTakenName = false,
  onChange,
  onAllowTakenNameChange,
  onAvailabilityChange,
}) {
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const debounceRef = useRef(0);
  const lastQueryRef = useRef("");

  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    onAvailabilityChange?.(status);
  }, [status]);

  function updateName(next) {
    onChange?.(next);
    onAllowTakenNameChange?.(false);
    setStatus(null);
    setError("");

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const q = next.trim();
    if (q.length < 2) {
      setChecking(false);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      runCheck(q);
    }, 450);
  }

  async function runCheck(q = value) {
    const trimmed = String(q || "").trim();
    if (trimmed.length < 2) return;
    setChecking(true);
    setError("");
    lastQueryRef.current = trimmed;
    try {
      const data = await api.checkArtistName(trimmed);
      if (lastQueryRef.current !== trimmed) return;
      setStatus(data);
    } catch (e) {
      if (lastQueryRef.current !== trimmed) return;
      setStatus(null);
      setError(e.message || "Vérification impossible");
    } finally {
      setChecking(false);
    }
  }

  const taken = status && !status.available;
  const blocked = taken && !allowTakenName;

  return (
    <div class="space-y-2">
      <label class="form-control w-full">
        <span class="label-text mb-1 text-sm text-base-content/60">
          Nom de scène (ton artiste fictionnel)
        </span>
        <div class="relative">
          <input
            class={`input input-bordered w-full bg-base-200 ${
              blocked ? "border-warning" : status?.available ? "border-success/50" : ""
            }`}
            type="text"
            placeholder={placeholder}
            value={value}
            disabled={disabled}
            onInput={(e) => updateName(e.currentTarget.value)}
          />
          {checking && (
            <span class="loading loading-spinner loading-xs absolute right-3 top-1/2 -translate-y-1/2 text-base-content/40" />
          )}
        </div>
      </label>

      {error && <p class="text-xs text-warning">{error}</p>}

      {!checking && status?.available && value.trim().length >= 2 && (
        <p class="inline-flex items-center gap-1.5 text-xs text-success">
          <Check size={14} />
          Nom libre sur Spotify, Apple Music et Deezer
        </p>
      )}

      {taken && (
        <div class="space-y-2 border border-warning/40 bg-warning/10 p-3 text-sm">
          <p class="inline-flex items-start gap-2 font-medium text-warning">
            <AlertTriangle size={16} class="mt-0.5 shrink-0" />
            <span>
              « {status.query} » est déjà pris sur les plateformes de streaming.
              {!allowTakenName && " Choisis un autre nom avant de générer."}
            </span>
          </p>
          <ul class="space-y-1.5">
            {(status.collisions || []).map((c) => (
              <li key={`${c.source}-${c.id || c.name}`} class="flex items-center gap-2 text-xs">
                {c.image ? (
                  <img src={c.image} alt="" class="h-7 w-7 object-cover" />
                ) : (
                  <span class="flex h-7 w-7 items-center justify-center bg-base-300 text-[10px] uppercase">
                    {(c.source || "?").slice(0, 2)}
                  </span>
                )}
                <span class="min-w-0 flex-1 truncate">
                  <span class="text-base-content">{c.name}</span>
                  <span class="text-base-content/45">
                    {" "}
                    · {c.source}
                    {formatFans(c.followers) ? ` · ${formatFans(c.followers)}` : ""}
                  </span>
                </span>
                {c.url && (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    class="link link-hover shrink-0 text-base-content/50"
                    title="Ouvrir"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
              </li>
            ))}
          </ul>
          {!allowTakenName ? (
            <button
              type="button"
              class="btn btn-ghost btn-xs border border-warning/40"
              disabled={disabled}
              onClick={() => onAllowTakenNameChange?.(true)}
            >
              Utiliser quand même
            </button>
          ) : (
            <p class="text-xs text-warning/80">
              Tu as choisi d’ignorer le conflit — le nom pourra être difficile à trouver en store.
            </p>
          )}
        </div>
      )}

      {!taken && (status?.warnings || []).length > 0 && (
        <p class="text-xs text-base-content/50">
          Quasi-homonymes :{" "}
          {status.warnings
            .slice(0, 3)
            .map((w) => w.name)
            .join(", ")}
        </p>
      )}
    </div>
  );
}

/** True si le nom saisi bloque la génération (pris et non forcé). */
export function isArtistNameBlocked(name, status, allowTakenName) {
  const q = String(name || "").trim();
  if (q.length < 2) return false;
  if (allowTakenName) return false;
  return Boolean(status && !status.available);
}
