import { Users, X } from "lucide-preact";
import { resolveArtistGender } from "../lib/artistGender.js";
import { normalizeFeatArtist } from "../lib/featArtist.js";

/**
 * Sélecteur d’artiste SONOZZ en feat. / duo.
 * Exclut le lead courant ; charge le snapshot vocal+style du profil catalogue.
 */
export default function FeatArtistPicker({
  leadArtist = null,
  featArtist = null,
  catalogArtists = [],
  disabled = false,
  embedded = false,
  onChange,
}) {
  const leadSlug = String(leadArtist?.slug || "").trim();
  const options = (Array.isArray(catalogArtists) ? catalogArtists : []).filter((a) => {
    const slug = String(a?.slug || "").trim();
    if (!slug && !a?.name) return false;
    if (leadSlug && slug === leadSlug) return false;
    const name = String(a?.name || a?.profile?.name || "").trim();
    if (leadArtist?.name && name.toLowerCase() === String(leadArtist.name).toLowerCase()) {
      return false;
    }
    return Boolean(name);
  });

  const current = normalizeFeatArtist(featArtist);
  const currentSlug = String(current?.slug || "").trim();

  function pickSlug(slug) {
    if (!slug) {
      onChange?.(null);
      return;
    }
    const entry = options.find((a) => String(a.slug || "").trim() === slug);
    if (!entry) {
      onChange?.(null);
      return;
    }
    onChange?.(normalizeFeatArtist(entry));
  }

  const featGender = current ? resolveArtistGender(current) : null;
  const leadGender = leadArtist ? resolveArtistGender(leadArtist) : null;

  return (
    <div class={embedded ? "space-y-3" : "space-y-3 border border-base-content/10 bg-base-200/30 p-4"}>
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 class="flex items-center gap-2 text-sm font-medium text-base-content/80">
            <Users size={14} class="text-primary" />
            Duo / Feat.
          </h3>
          <p class="mt-1 text-xs text-base-content/45">
            Second artiste SONOZZ — sa voix et son style restent distincts du lead
            {leadArtist?.name ? ` (${leadArtist.name})` : ""}.
          </p>
        </div>
        {current ? (
          <button
            type="button"
            class="btn btn-ghost btn-xs gap-1 text-error"
            disabled={disabled}
            onClick={() => onChange?.(null)}
          >
            <X size={12} />
            Retirer
          </button>
        ) : null}
      </div>

      {options.length === 0 ? (
        <p class="text-sm text-base-content/55">
          Aucun autre artiste dans ton catalogue. Crée un second profil pour faire un duo.
        </p>
      ) : (
        <label class="form-control w-full max-w-md">
          <span class="label-text text-xs text-base-content/55">Artiste en featuring</span>
          <select
            class="select select-bordered select-sm"
            disabled={disabled}
            value={currentSlug}
            onChange={(e) => pickSlug(e.target.value)}
          >
            <option value="">— Solo (pas de feat.) —</option>
            {options.map((a) => {
              const slug = String(a.slug || "").trim();
              const name = String(a.name || a.profile?.name || "").trim();
              const g = resolveArtistGender(a.profile || a);
              const genre = a.profile?.genre || a.genre || "";
              return (
                <option key={slug || name} value={slug}>
                  {name}
                  {g?.label ? ` · ${g.label}` : ""}
                  {genre ? ` · ${genre}` : ""}
                </option>
              );
            })}
          </select>
        </label>
      )}

      {current ? (
        <div class="space-y-1 text-sm">
          <p>
            <span class="text-base-content/55">Feat. :</span>{" "}
            <span class="font-medium">{current.name}</span>
            {featGender?.label ? (
              <span class="text-base-content/55"> · {featGender.label}</span>
            ) : (
              <span class="text-warning"> · voix non définie</span>
            )}
            {current.genre ? (
              <span class="text-base-content/55"> · {current.genre}</span>
            ) : null}
          </p>
          {leadGender?.code && featGender?.code && leadGender.code !== featGender.code ? (
            <p class="text-xs text-info">
              Duo mixte : les deux voix (lead + feat.) seront demandées séparément dans le
              prompt — pas de fusion en une seule voix.
            </p>
          ) : leadGender?.code && featGender?.code ? (
            <p class="text-xs text-base-content/50">
              Même présentation vocale : les timbres et styles d’écriture restent contrastés
              nommés.
            </p>
          ) : null}
          {!featGender ? (
            <p class="text-xs text-warning">
              Définis Homme/Femme sur le profil de {current.name} pour verrouiller sa voix.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
