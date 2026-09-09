import { useEffect, useState } from "preact/hooks";
import { Heart, Plus, Sparkles, UserRound, X, AudioWaveform } from "lucide-preact";
import AppShell from "./AppShell.jsx";
import { PageHeader, AlertBanner, EmptyState, ChoiceCard } from "./ui/index.js";
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
    <AppShell active="artistes">
      <div class="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Catalogue"
          title="Tes artistes"
          description="Ouvre une fiche pour le profil, le catalogue et les albums. Un morceau s’écrit dans le Studio."
          actions={
            <>
              <button
                type="button"
                class="btn btn-ghost gap-2 rounded-full border border-base-content/15"
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
                class="btn btn-primary gap-2 rounded-full px-5"
                aria-label="Ajouter un artiste"
                onClick={() => setPickerOpen(true)}
              >
                <Plus size={18} />
                <span class="hidden sm:inline">Ajouter</span>
              </button>
            </>
          }
        />

        <div class="space-y-8">
          {timbreMsg ? <AlertBanner tone="info">{timbreMsg}</AlertBanner> : null}
          {error ? <AlertBanner tone="error">{error}</AlertBanner> : null}

          {loading && (
            <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  class="h-72 animate-pulse rounded-3xl bg-base-300/50"
                />
              ))}
            </div>
          )}

          {!loading && artists.length > 0 && (
            <ul class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
                        <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-5 pt-16">
                          <p class="font-display text-xl font-bold text-white">{a.name}</p>
                          <p class="mt-1 text-xs text-white/70">
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
            <EmptyState
              title="Aucun artiste pour l’instant"
              description="Ajoute un profil — réel ou fictionnel — puis lance des titres depuis le Studio."
              action={
                <button
                  type="button"
                  class="btn btn-primary gap-2 rounded-full px-6"
                  onClick={() => setPickerOpen(true)}
                >
                  <Plus size={18} />
                  Ajouter un artiste
                </button>
              }
            />
          )}
        </div>
      </div>

      {pickerOpen && (
        <dialog class="modal modal-open z-[100]" open>
          <div class="modal-box max-w-md space-y-5 rounded-3xl">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h3 class="font-display text-xl font-semibold">Nouveau profil</h3>
                <p class="mt-1 text-sm text-base-content/60">
                  Identité d’un côté, style musical de l’autre.
                </p>
              </div>
              <button
                type="button"
                class="btn btn-ghost btn-circle shrink-0"
                aria-label="Fermer"
                onClick={() => setPickerOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div class="grid gap-3">
              <ChoiceCard
                href="/artiste/nouveau?mode=self"
                icon={<Heart size={18} />}
                title="C’est moi"
                description="Ton identité réelle — photos et voix."
                active
              />
              <ChoiceCard
                href="/artiste/nouveau"
                icon={<Sparkles size={18} />}
                title="Artiste fictionnel"
                description="Identité et style inventés."
              />
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
