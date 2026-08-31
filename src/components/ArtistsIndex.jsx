import { useEffect, useState } from "preact/hooks";
import { Heart, Plus, Sparkles, UserRound, X, AudioWaveform } from "lucide-preact";
import AppShell from "./AppShell.jsx";
import { listArtistImageUrl } from "../lib/artistPhotos.js";
import { api } from "../lib/apiClient.js";

function artistMissingTimbre(a) {
  const p = a?.profile || {};
  return !(
    p.voiceSample?.songGenTimbre ||
    p.voiceSample?.analyzedTimbre ||
    p.styleLock?.timbre
  );
}

const AUTO_TIMBRE_KEY = "sonozz.timbre.autobackfill.v1";

export default function ArtistsIndex() {
  const [artists, setArtists] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [timbreBusy, setTimbreBusy] = useState(false);
  const [timbreMsg, setTimbreMsg] = useState("");

  async function reloadArtists() {
    const res = await fetch("/api/artists");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Erreur");
    setArtists(data.artists || []);
    return data.artists || [];
  }

  async function backfillTimbres({ silent = false } = {}) {
    if (timbreBusy) return;
    setTimbreBusy(true);
    if (!silent) setTimbreMsg("");
    try {
      const res = await api.backfillArtistTimbres({ limit: 80 });
      const r = res?.report || {};
      const msg =
        `Timbres mis à jour : ${r.analyzed || 0} complété(s)` +
        (r.locked ? `, ${r.locked} déjà OK` : "") +
        (r.failed ? `, ${r.failed} échec(s)` : "") +
        ".";
      setTimbreMsg(msg);
      await reloadArtists();
      try {
        sessionStorage.setItem(AUTO_TIMBRE_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
    } catch (e) {
      if (!silent) setTimbreMsg(e.message || "Backfill timbre impossible");
    } finally {
      setTimbreBusy(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const list = await reloadArtists();
        const missing = list.filter(artistMissingTimbre).length;
        let recentlyDone = false;
        try {
          const t = Number(sessionStorage.getItem(AUTO_TIMBRE_KEY) || 0);
          recentlyDone = t > 0 && Date.now() - t < 6 * 60 * 60 * 1000;
        } catch {
          /* ignore */
        }
        if (missing > 0 && !recentlyDone) {
          setTimbreMsg(
            `${missing} artiste(s) sans timbre — complément automatique…`,
          );
          // Laisse l’UI peindre puis lance le backfill (synthèse profil / audio).
          window.setTimeout(() => {
            void backfillTimbres({ silent: true });
          }, 400);
        }
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
      actions={
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="btn btn-ghost gap-2"
            disabled={timbreBusy || loading}
            title="Complète les timbres absents (profil IA, ou audio existant)"
            onClick={() => void backfillTimbres()}
          >
            {timbreBusy ? (
              <span class="loading loading-spinner loading-sm" />
            ) : (
              <AudioWaveform size={18} />
            )}
            <span class="hidden sm:inline">Compléter les timbres</span>
          </button>
          <button
            type="button"
            class="btn btn-primary gap-2"
            aria-label="Ajouter un artiste"
            onClick={() => setPickerOpen(true)}
          >
            <Plus size={18} />
            <span class="hidden sm:inline">Ajouter</span>
          </button>
        </div>
      }
    >
      <div class="mx-auto max-w-5xl space-y-8">
        {timbreMsg ? <p class="text-sm text-base-content/70">{timbreMsg}</p> : null}
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
                          {a.profile?.voiceSample?.songGenTimbre ||
                          a.profile?.voiceSample?.analyzedTimbre ||
                          a.profile?.styleLock?.timbre
                            ? ` · timbre « ${
                                a.profile.voiceSample?.songGenTimbre ||
                                a.profile.voiceSample?.analyzedTimbre ||
                                a.profile.styleLock?.timbre
                              } »`
                            : " · timbre à figer"}
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
            Aucun artiste pour l’instant — appuie sur Ajouter, puis choisis le type de profil.
          </p>
        )}
      </div>

      {pickerOpen && (
        <dialog class="modal modal-open z-[100]" open>
          <div class="modal-box max-w-md">
            <div class="mb-4 flex items-start justify-between gap-3">
              <h3 class="font-display text-lg font-semibold">Nouveau profil</h3>
              <button
                type="button"
                class="btn btn-ghost btn-sm btn-circle shrink-0"
                aria-label="Fermer"
                onClick={() => setPickerOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p class="mb-4 text-sm text-base-content/60">
              Identité d’un côté, style musical de l’autre.
            </p>
            <div class="space-y-3">
              <a
                href="/artiste/nouveau?mode=self"
                class="flex items-center gap-4 rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/20 via-accent/10 to-secondary/15 p-4 transition hover:border-primary/60"
              >
                <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/25 text-primary">
                  <Heart size={20} />
                </div>
                <div class="min-w-0">
                  <p class="font-display font-semibold">C’est moi</p>
                  <p class="text-sm text-base-content/60">Ton identité réelle.</p>
                </div>
              </a>
              <a
                href="/artiste/nouveau"
                class="flex items-center gap-4 rounded-2xl border border-base-content/10 bg-base-200/40 p-4 transition hover:border-primary/40"
              >
                <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-base-content/10 text-base-content/70">
                  <Sparkles size={20} />
                </div>
                <div class="min-w-0">
                  <p class="font-display font-semibold">Artiste fictionnel</p>
                  <p class="text-sm text-base-content/60">Identité et style inventés.</p>
                </div>
              </a>
            </div>
          </div>
          <form method="dialog" class="modal-backdrop">
            <button type="submit" onClick={() => setPickerOpen(false)}>
              Fermer
            </button>
          </form>
        </dialog>
      )}
    </AppShell>
  );
}
