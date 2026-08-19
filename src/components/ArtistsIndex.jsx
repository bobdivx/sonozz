import { useEffect, useState } from "preact/hooks";
import { Plus, UserRound } from "lucide-preact";
import AppShell from "./AppShell.jsx";
import { listArtistImageUrl } from "../lib/artistPhotos.js";

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
      title="Tes artistes"
      subtitle="Ouvre une fiche pour le profil, le catalogue et les albums. Un morceau s’écrit dans le Studio."
    >
      <div class="mx-auto max-w-5xl space-y-8">
        <div class="space-y-4">
        <a
          href="/artiste/nouveau?mode=self"
          class="group flex items-center gap-4 overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-r from-primary/20 via-accent/10 to-secondary/15 p-4 transition hover:border-primary/60 sm:p-5"
        >
          <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/25 text-primary transition group-hover:scale-105">
            <Plus size={26} />
          </div>
          <div class="min-w-0 flex-1">
            <p class="font-display text-lg font-semibold sm:text-xl">Profil artiste</p>
            <p class="text-sm text-base-content/60">
              Identité (toi) d’un côté, style musical de l’autre.
            </p>
          </div>
        </a>
        <a
          href="/artiste/nouveau"
          class="flex items-center gap-4 rounded-3xl border border-base-content/10 bg-base-200/40 p-4 transition hover:border-primary/40 sm:p-5"
        >
          <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-base-content/10 text-base-content/70">
            <UserRound size={24} />
          </div>
          <div class="min-w-0 flex-1">
            <p class="font-display text-lg font-semibold">Profil artiste fictionnel</p>
            <p class="text-sm text-base-content/60">
              Identité et style musical séparés — ensuite un titre (Studio) ou un album (fiche).
            </p>
          </div>
        </a>
        </div>

        {loading && (
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                class="h-64 animate-pulse rounded-3xl bg-base-300/50"
              />
            ))}
          </div>
        )}
        {error && <p class="text-error">{error}</p>}

        {!loading && artists.length > 0 && (
          <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {artists.map((a) => {
              const photo =
                a.profile?.imageUrl || listArtistImageUrl(a.slug, a.profile, a.updatedAt);
              return (
                <li key={a.slug}>
                  <a
                    href={`/artiste/${a.slug}`}
                    class="group block overflow-hidden rounded-3xl border border-base-content/10 bg-base-300/40 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-xl hover:shadow-black/20"
                  >
                    <div class="relative aspect-[4/5] bg-base-300">
                      {photo ? (
                        <img
                          src={photo}
                          alt=""
                          class="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div class="flex h-full items-center justify-center">
                          <UserRound size={36} class="opacity-30" />
                        </div>
                      )}
                      <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-4 pt-16">
                        <p class="font-display text-xl font-bold text-white">{a.name}</p>
                        <p class="mt-0.5 text-xs text-white/70">
                          {a.profile?.mode === "self" ? "Profil réel" : "Artiste SONOZZ"}
                          {a.profile?.genre ? ` · ${a.profile.genre}` : ""}
                        </p>
                      </div>
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && artists.length === 0 && (
          <p class="rounded-2xl border border-dashed border-base-content/15 px-5 py-10 text-center text-base-content/55">
            Aucun artiste pour l’instant — crée un profil ici. Les titres s’écrivent dans le Studio ;
            les albums se lancent sur la fiche.
          </p>
        )}
      </div>
    </AppShell>
  );
}
