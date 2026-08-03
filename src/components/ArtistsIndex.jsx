import { useEffect, useState } from "preact/hooks";
import { ArrowLeft, UserRound } from "lucide-preact";

export default function ArtistsIndex() {
  const [artists, setArtists] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // Force sync depuis les projets existants
        const res = await fetch("/api/artists?sync=1");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Erreur");
        setArtists(data.artists || []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div class="mx-auto min-h-screen w-full max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <a href="/" class="btn btn-ghost btn-sm mb-8 gap-1">
        <ArrowLeft size={14} /> Studio
      </a>
      <h1 class="font-display mb-2 text-4xl font-extrabold tracking-tight md:text-5xl">Artistes</h1>
      <p class="mb-8 max-w-lg text-base-content/65">
        Chaque artiste a une page slug, un catalogue et des stats SONOZZ / ONCE.
      </p>

      {loading && <span class="loading loading-spinner" />}
      {error && <p class="text-error">{error}</p>}

      <ul class="space-y-3">
        {artists.map((a) => (
          <li key={a.slug}>
            <a
              href={`/artiste/${a.slug}`}
              class="flex items-center gap-4 border border-base-content/10 bg-base-200/40 p-3 transition hover:border-primary/40"
            >
              {a.profile?.imageUrl ? (
                <img src={a.profile.imageUrl} alt="" class="h-14 w-14 object-cover" />
              ) : (
                <div class="flex h-14 w-14 items-center justify-center bg-base-300">
                  <UserRound size={20} class="opacity-40" />
                </div>
              )}
              <div>
                <p class="font-display text-lg font-semibold">{a.name}</p>
                <p class="text-xs text-base-content/50">/{a.slug}</p>
              </div>
            </a>
          </li>
        ))}
      </ul>
      {!loading && artists.length === 0 && (
        <p class="text-sm text-base-content/55">Aucun artiste — génère un profil dans le studio puis sauvegarde.</p>
      )}
    </div>
  );
}
