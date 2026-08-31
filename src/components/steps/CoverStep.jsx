import { useEffect, useState } from "preact/hooks";
import { ImagePlus } from "lucide-preact";
import VersionPicker from "../VersionPicker.jsx";
import { artistEditHref } from "../../lib/studio.js";
import { artistPhotoPath } from "../../lib/artistPhotos.js";
import { displayArtistCredit, normalizeFeatArtist } from "../../lib/featArtist.js";

function isPortraitReady(url) {
  if (!url) return false;
  if (/^data:image\/svg/i.test(url)) return false;
  if (/replicate\.delivery|pb\.replicate\.com/i.test(url)) return false;
  return (
    /^https?:\/\//i.test(url) ||
    /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(url) ||
    String(url).startsWith("/api/")
  );
}

function resolveFeatPortraitUrl(feat, catalogArtists = []) {
  if (!feat) return "";
  if (isPortraitReady(feat.imageUrl)) return feat.imageUrl;
  const slug = String(feat.slug || "").trim();
  if (!slug) return "";
  const hit = (Array.isArray(catalogArtists) ? catalogArtists : []).find(
    (a) => String(a?.slug || "").trim() === slug,
  );
  const fromCatalog =
    hit?.imageUrl ||
    hit?.profile?.imageUrl ||
    (Array.isArray(hit?.profile?.photos) ? hit.profile.photos[0] : null) ||
    (Array.isArray(hit?.photos) ? hit.photos[0] : null);
  if (isPortraitReady(fromCatalog)) return fromCatalog;
  return artistPhotoPath(slug) || "";
}

export default function CoverStep({
  cover,
  versions = [],
  activeId = null,
  artist,
  featArtist = null,
  catalogArtists = [],
  track,
  loading,
  onGenerate,
  onSelectVersion,
  onDeleteVersion,
}) {
  const [prompt, setPrompt] = useState(cover?.prompt || "");
  const [featThumbOk, setFeatThumbOk] = useState(true);
  useEffect(() => {
    setPrompt(cover?.prompt || "");
  }, [cover?.id, cover?.prompt]);

  const feat = normalizeFeatArtist(featArtist);
  const isDuo = Boolean(feat?.name);
  const credit = displayArtistCredit(artist, feat);

  const portraitUrl = artist?.imageUrl || "";
  const featPortraitUrl = resolveFeatPortraitUrl(feat, catalogArtists);
  useEffect(() => {
    setFeatThumbOk(true);
  }, [featPortraitUrl, feat?.slug]);

  const hasPortrait = isPortraitReady(portraitUrl);
  const hasFeatPortrait = Boolean(featPortraitUrl) && featThumbOk;
  const portraitExpired = /replicate\.delivery|pb\.replicate\.com/i.test(portraitUrl);
  const hasVersions = versions.length > 0;
  const profileHref = artistEditHref(artist?.slug);
  const featProfileHref = feat?.slug ? artistEditHref(feat.slug) : null;

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Créer les jaquettes</h2>
        <p class="max-w-xl text-base-content/70">
          {isDuo ? (
            <>
              Gemini compose une jaquette <strong>duo / feat.</strong> à partir des portraits
              ({credit}).
            </>
          ) : (
            <>
              Gemini transforme le <strong>portrait de l’artiste</strong> en jaquette album (même visage).
            </>
          )}
          {hasVersions ? " Chaque génération ajoute une version — choisis celle que tu préfères." : ""}
        </p>
      </header>

      {artist && (
        <div class="flex flex-wrap items-start gap-4 border border-base-content/10 bg-base-200/40 p-3">
          <div class="flex flex-wrap items-center gap-3">
            {hasPortrait ? (
              <img
                src={artist.imageUrl}
                alt={`Référence ${artist.name}`}
                class="h-20 w-20 object-cover"
              />
            ) : (
              <div class="flex h-20 w-20 items-center justify-center bg-warning/15 text-center text-[10px] text-warning">
                Pas de photo
              </div>
            )}
            {isDuo ? (
              hasFeatPortrait ? (
                <img
                  src={featPortraitUrl}
                  alt={`Feat ${feat.name}`}
                  class="h-20 w-20 object-cover"
                  onError={() => setFeatThumbOk(false)}
                />
              ) : (
                <div class="flex h-20 w-20 flex-col items-center justify-center gap-0.5 border border-dashed border-warning/40 bg-warning/10 p-1 text-center text-[10px] text-warning">
                  <span>{feat?.name || "Feat"}</span>
                  <span>sans photo</span>
                </div>
              )
            ) : null}
          </div>
          <div class="min-w-0 flex-1 text-sm">
            <p class="font-medium">
              {isDuo ? `Références duo : ${credit}` : `Référence obligatoire : ${artist.name}`}
            </p>
            <p class="text-base-content/60">
              {hasPortrait
                ? isDuo
                  ? hasFeatPortrait
                    ? "Les deux portraits serviront de base (image-à-image)."
                    : (
                      <>
                        Lead OK — photo de {feat.name} introuvable
                        {featProfileHref ? (
                          <>
                            {" "}
                            (
                            <a class="link link-primary" href={featProfileHref}>
                              ouvrir le profil
                            </a>
                            ). Ajoute une photo pour un vrai duo visuel.
                          </>
                        ) : (
                          ". Ajoute une photo pour un vrai duo visuel."
                        )}
                      </>
                    )
                  : "La jaquette partira de ce portrait (image-à-image)."
                : portraitExpired
                  ? (
                    <>
                      Portrait Replicate expiré — ouvre{" "}
                      <a class="link link-primary" href={profileHref}>
                        Modifier le profil
                      </a>{" "}
                      et régénère la photo.
                    </>
                  )
                  : (
                    <>
                      Ouvre{" "}
                      <a class="link link-primary" href={profileHref}>
                        Modifier le profil
                      </a>{" "}
                      pour obtenir une vraie photo avant la jaquette.
                    </>
                  )}
            </p>
          </div>
        </div>
      )}

      <div class="flex flex-col gap-3">
        <label class="form-control w-full">
          <span class="label-text mb-1 text-sm text-base-content/60">Style / ambiance (optionnel)</span>
          <input
            class="input input-bordered w-full bg-base-200"
            type="text"
            placeholder="Grain film, lumière laiton, nuit urbaine…"
            value={prompt}
            onInput={(e) => setPrompt(e.currentTarget.value)}
          />
        </label>
        <button
          class="btn btn-primary gap-2 self-start"
          disabled={loading || !artist || !hasPortrait}
          onClick={() => onGenerate({ prompt, artist, track, featArtist: feat })}
        >
          {loading ? <span class="loading loading-spinner loading-sm" /> : <ImagePlus size={18} />}
          {loading
            ? isDuo
              ? "Gemini compose la jaquette duo…"
              : "Gemini compose la jaquette…"
            : hasVersions
              ? isDuo
                ? "Nouvelle version duo"
                : "Nouvelle version depuis le portrait"
              : isDuo
                ? "Générer jaquette duo"
                : "Générer depuis le portrait"}
        </button>
        {!artist && <p class="text-sm text-warning">Un profil artiste est requis.</p>}
        {artist && !hasPortrait && (
          <p class="text-sm text-warning">
            Portrait manquant — ouvre{" "}
            <a class="link link-primary" href={profileHref}>
              Modifier le profil
            </a>{" "}
            et régénère la photo (Flux/Gemini).
          </p>
        )}
      </div>

      {hasVersions && (
        <div class="space-y-3">
          <p class="text-xs uppercase tracking-wider text-base-content/45">
            Versions ({versions.length})
          </p>
          <VersionPicker
            layout="grid"
            versions={versions}
            activeId={activeId}
            onSelect={onSelectVersion}
            onDelete={onDeleteVersion}
            thumbFor={(v) => v.imageUrl || null}
          />
        </div>
      )}

      {cover && (
        <figure class="animate-rise grid gap-4 md:grid-cols-[minmax(0,280px)_1fr] md:items-end">
          {cover.imageUrl ? (
            <img
              src={cover.imageUrl}
              alt={`Jaquette ${track?.title || artist?.name || ""}`}
              class="aspect-square w-full max-w-xs object-cover shadow-2xl shadow-black/40"
            />
          ) : (
            <div class="flex aspect-square w-full max-w-xs items-center justify-center border border-warning/40 bg-warning/10 p-4 text-center text-sm text-warning">
              Image absente — régénère la jaquette.
            </div>
          )}
          <figcaption class="space-y-2 text-sm text-base-content/70">
            <p class="font-display text-lg text-base-content">
              {cover.format} · {cover.style}
              {cover.basedOnArtist ? " · basé portrait" : ""}
              {cover.featuring ? ` · feat. ${cover.featuring}` : ""}
            </p>
            <p class="text-xs text-base-content/45">Provider : {cover.provider || "—"}</p>
            <p>{cover.prompt}</p>
            {cover.warning && <p class="text-warning">{cover.warning}</p>}
          </figcaption>
        </figure>
      )}
    </section>
  );
}
