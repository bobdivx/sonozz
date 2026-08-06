import { useEffect, useState } from "preact/hooks";
import { UserRound } from "lucide-preact";
import AppShell from "./AppShell.jsx";

export default function ArtistsIndex() {
  const [artists, setArtists] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/artists");
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
    <AppShell
      active="artistes"
      title="Artistes"
      subtitle="Chaque artiste a une page slug, un catalogue et des stats SONOZZ / ONCE."
    >
      <div class="mx-auto max-w-4xl space-y-6">
        <a
          href="/?step=2&mode=self"
          class="flex items-center gap-4 border border-primary/35 bg-primary/10 p-4 transition hover:border-primary/60"
        >
          <div class="flex h-14 w-14 items-center justify-center bg-primary/20 text-primary">
            <UserRound size={22} />
          </div>
          <div class="min-w-0 flex-1">
            <p class="font-display text-lg font-semibold">Créer mon profil artiste</p>
            <p class="text-sm text-base-content/60">
              Photos, âge, sexe, artistes aimés — les morceaux colleront à ton son.
            </p>
          </div>
        </a>

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
                  <p class="text-xs text-base-content/50">
                    /{a.slug}
                    {a.profile?.mode === "self" ? " · profil réel" : ""}
                    {a.profile?.recordLabel
                      ? ` · label ${a.profile.recordLabel}`
                      : ""}
                  </p>
                </div>
              </a>
            </li>
          ))}
        </ul>
        {!loading && artists.length === 0 && (
          <p class="text-base-content/55">
            Aucun artiste pour l’instant — crée ton profil ou lance un pipeline depuis le Studio.
          </p>
        )}
      </div>
    </AppShell>
  );
}
