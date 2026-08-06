import { useState } from "preact/hooks";
import { Check, Circle, ExternalLink, Download, Copy, PackageOpen, Rocket, ImagePlus } from "lucide-preact";

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

function isDurableRaster(url) {
  return typeof url === "string" && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(url);
}

function isEphemeralHttp(url) {
  return (
    typeof url === "string" &&
    /^https?:\/\//i.test(url) &&
    /replicate\.delivery|pb\.replicate\.com/i.test(url)
  );
}

function isUsableRaster(url) {
  if (!url || typeof url !== "string") return false;
  if (/^data:image\/svg\+xml/i.test(url)) return false;
  if (isDurableRaster(url)) return true;
  if (isEphemeralHttp(url)) return false; // expirée / non fiable pour l’UI
  return /^https?:\/\//i.test(url);
}

function pickArtwork(...candidates) {
  const list = candidates.filter(Boolean);
  return list.find((u) => isDurableRaster(u)) || list.find((u) => isUsableRaster(u)) || null;
}

export default function DistroKidStep({
  distrokid,
  track,
  cover,
  artist,
  loading,
  onConfigure,
  onPrepare,
  onGoToCover,
  configured,
}) {
  const form = distrokid?.form;
  const isOnce = distrokid?.provider === "once";
  const [artBroken, setArtBroken] = useState(false);

  const rawEphemeral =
    [cover?.imageUrl, artist?.imageUrl, distrokid?.assets?.coverUrl].find((u) =>
      isEphemeralHttp(u),
    ) || null;

  const liveArtwork =
    pickArtwork(cover?.imageUrl, artist?.imageUrl, distrokid?.assets?.coverUrl) || null;

  const artworkExpired = Boolean(rawEphemeral) && !liveArtwork;

  // Ignore l’ancien package DistroKid persisté (Turso / local) — distribution = ONCE uniquement
  const showResult = Boolean(distrokid) && isOnce;

  const checklist = (showResult ? distrokid.checklist || [] : [])
    .filter((item) => !/distrokid/i.test(`${item.label || ""} ${item.tip || ""}`))
    .map((item) => {
      if (item.label !== "Artwork carré (JPG/PNG)") return item;
      return {
        ...item,
        ok: Boolean(liveArtwork),
        tip: liveArtwork
          ? liveArtwork === artist?.imageUrl && liveArtwork !== cover?.imageUrl
            ? "Portrait artiste utilisé — idéalement génère une vraie jaquette (étape 5)"
            : "Idéal 3000×3000, sans URL / @reseaux / logos stores"
          : "Manquant — génère la jaquette à l’étape 5 (basée sur le portrait)",
      };
    });

  async function copyFieldSheet() {
    if (!form) return;
    const sheet = [
      `Artist: ${form.artistName}`,
      `Release / Track: ${form.trackTitle}`,
      `Genre: ${form.genre} / ${form.subgenre}`,
      `Language: ${form.lyricsLanguage}`,
      `Explicit: ${form.explicitLyrics}`,
      `Release date: ${form.releaseDate}`,
      `Label: ${form.recordLabel}`,
      `Copyright: ${form.copyrightOwner}`,
      `Phonogram: ${form.phonogramOwner}`,
      `Stores: ${form.stores.join(", ")}`,
    ].join("\n");
    await copyText(sheet);
  }

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">ONCE → Spotify</h2>
        <p class="max-w-xl text-base-content/70">
          Soumission automatique via l’API ONCE (crédits débités à l’envoi).
        </p>
      </header>

      <div class="flex flex-wrap gap-3">
        <button type="button" class="btn btn-outline gap-2 border-primary/40" onClick={onConfigure}>
          <PackageOpen size={18} />
          {configured ? "Token ONCE — modifier" : "Configurer ONCE"}
        </button>
        <button
          type="button"
          class="btn btn-primary gap-2"
          disabled={loading || !track}
          onClick={onPrepare}
        >
          {loading ? <span class="loading loading-spinner loading-sm" /> : <Rocket size={18} />}
          {loading ? "Envoi…" : "Publier via ONCE"}
        </button>
        {!liveArtwork && (
          <button type="button" class="btn btn-secondary gap-2" onClick={onGoToCover}>
            <ImagePlus size={18} /> Créer la jaquette
          </button>
        )}
      </div>

      {!track && <p class="text-sm text-warning">Morceau requis avant distribution.</p>}
      {track && artworkExpired && (
        <p class="text-sm text-warning">
          Artwork Replicate expiré (URL temporaire). Régénère la jaquette à l’étape Jaquettes, puis republie sur ONCE.
        </p>
      )}
      {track && !liveArtwork && !artworkExpired && (
        <p class="text-sm text-warning">
          Artwork manquant : va à l’étape Jaquettes et génère depuis le portrait artiste, puis reviens ici.
        </p>
      )}

      {liveArtwork && !artBroken && (
        <div class="flex items-center gap-3 border border-base-content/10 bg-base-200/40 p-3">
          <img
            src={liveArtwork}
            alt="Artwork"
            class="h-16 w-16 object-cover"
            onError={() => setArtBroken(true)}
          />
          <p class="text-sm text-base-content/70">
            Artwork prêt
            {liveArtwork === artist?.imageUrl && liveArtwork !== cover?.imageUrl
              ? " (portrait — jaquette dédiée recommandée)"
              : ""}
          </p>
        </div>
      )}
      {(artworkExpired || artBroken) && (
        <div class="flex items-center gap-3 border border-warning/30 bg-warning/10 p-3">
          <div class="flex h-16 w-16 items-center justify-center bg-base-300 text-[10px] text-warning">
            Expiré
          </div>
          <div class="text-sm">
            <p class="text-warning">Artwork indisponible</p>
            <p class="text-base-content/60">
              L’URL Replicate a expiré. Clique « Créer la jaquette » pour en générer une nouvelle (persistée en base64).
            </p>
            <button type="button" class="btn btn-secondary btn-sm mt-2 gap-1" onClick={onGoToCover}>
              <ImagePlus size={14} /> Régénérer la jaquette
            </button>
          </div>
        </div>
      )}

      {distrokid && !isOnce && (
        <p class="text-sm text-base-content/55">
          Ancien résultat DistroKid ignoré. Clique « Publier via ONCE » pour soumettre la release.
        </p>
      )}

      {showResult && (
        <div class="animate-rise space-y-5 border-t border-base-content/10 pt-5">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-xs uppercase tracking-[0.18em] text-primary">
                ONCE {distrokid.packageId || distrokid.releaseId}
              </p>
              <h3 class="font-display text-xl font-semibold">
                {(form?.trackTitle || distrokid.title) + " — " + (form?.artistName || distrokid.artist)}
              </h3>
              <p class="text-sm text-base-content/60">
                Statut : {distrokid.status}
                {distrokid.credits?.balance != null ? ` · crédits ${distrokid.credits.balance}` : ""}
                {distrokid.eta ? ` · ${distrokid.eta}` : ""}
              </p>
              {distrokid.account && (
                <p class="text-xs text-base-content/45">Compte : {distrokid.account}</p>
              )}
            </div>
            <a
              class="btn btn-secondary btn-sm gap-2"
              href={distrokid.dashboardUrl || "https://once.app/"}
              target="_blank"
              rel="noreferrer"
            >
              Ouvrir ONCE <ExternalLink size={14} />
            </a>
          </div>

          {distrokid.warning && <p class="text-sm text-warning">{distrokid.warning}</p>}

          <ul class="space-y-2">
            {checklist.map((item) => (
              <li key={item.label} class="flex items-start gap-2 text-sm">
                {item.ok ? (
                  <Check size={16} class="mt-0.5 text-success" />
                ) : (
                  <Circle size={16} class="mt-0.5 text-base-content/35" />
                )}
                <span>
                  <span class={item.ok ? "text-base-content/85" : "text-base-content/50"}>{item.label}</span>
                  {item.tip && <span class="block text-xs text-base-content/40">{item.tip}</span>}
                </span>
              </li>
            ))}
          </ul>

          {form && (
            <div class="grid gap-2 text-sm md:grid-cols-2">
              {[
                ["Artiste", form.artistName],
                ["Titre", form.trackTitle],
                ["Genre", `${form.genre} / ${form.subgenre || form.sub_genre || ""}`],
                ["Sortie", form.releaseDate],
                ["Explicit", form.explicitLyrics],
                ["Label", form.recordLabel],
                ["Langue", form.lyricsLanguage],
                ["Contient IA", form.containsAi || (distrokid?.containsAi ? "Yes" : "No")],
                ["Instrumental", form.isInstrumental || (distrokid?.isInstrumental ? "Yes" : "No")],
              ].map(([label, value]) => (
                <div key={label} class="border-b border-base-content/10 py-2">
                  <span class="block text-xs uppercase tracking-wider text-base-content/40">{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          )}

          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-outline btn-sm gap-1"
              onClick={() =>
                downloadJson(
                  `${distrokid.packageId || "release"}-metadata.json`,
                  distrokid.metadataDownload || distrokid,
                )
              }
            >
              <Download size={14} /> Métadonnées JSON
            </button>
            <button type="button" class="btn btn-outline btn-sm gap-1" onClick={copyFieldSheet}>
              <Copy size={14} /> Copier les champs
            </button>
            {liveArtwork && (
              <a class="btn btn-outline btn-sm gap-1" href={liveArtwork} download="cover.jpg">
                <Download size={14} /> Jaquette
              </a>
            )}
            {(distrokid.assets?.audioUrl || track?.audioUrl) && (
              <a
                class="btn btn-outline btn-sm gap-1"
                href={distrokid.assets?.audioUrl || track.audioUrl}
                download="track.mp3"
              >
                <Download size={14} /> Audio
              </a>
            )}
          </div>

          <p class="text-xs text-base-content/45">{distrokid.note}</p>
        </div>
      )}
    </section>
  );
}
