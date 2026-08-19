import { useEffect, useState } from "preact/hooks";
import {
  Waves,
  UserRound,
  Settings2,
  Menu,
  X,
  Scale,
  Headphones,
  LogOut,
} from "lucide-preact";
import JobsDock, { JobsDockMobile } from "./JobsDock.jsx";
import { ensureKeysHydrated } from "../lib/keys.js";

const NAV = [
  { href: "/", id: "studio", label: "Studio", icon: Waves, hint: "Un morceau : paroles, audio, jaquette, stores" },
  { href: "/artistes", id: "artistes", label: "Artistes", icon: UserRound, hint: "Profils, catalogue et albums" },
  { href: "/play", id: "play", label: "Play", icon: Headphones },
  { href: "/parametres", id: "parametres", label: "Paramètres", icon: Settings2 },
];

/**
 * Réserve la hauteur réelle du lecteur (et de la bande Tâches sur mobile)
 * sans se faire écraser par les classes `py-*` de Tailwind.
 */
function BottomChromeSpacer({ includeJobs = false }) {
  if (!includeJobs) {
    return (
      <div
        class="pointer-events-none"
        style={{ height: "var(--sonozz-now-playing, 5.25rem)" }}
        aria-hidden="true"
      />
    );
  }
  return (
    <>
      <div
        class="pointer-events-none md:hidden"
        style={{
          height: "calc(var(--sonozz-jobs-dock, 0px) + var(--sonozz-now-playing, 5.25rem))",
        }}
        aria-hidden="true"
      />
      <div
        class="pointer-events-none hidden md:block"
        style={{ height: "var(--sonozz-now-playing, 5.25rem)" }}
        aria-hidden="true"
      />
    </>
  );
}

/**
 * Shell app avec sidebar (si connecté) ou bandeau logo public (écoute /play).
 * @param {{ active: 'studio' | 'artistes' | 'play' | 'parametres', children: any, title?: string, subtitle?: string, fillViewport?: boolean, actions?: any }} props
 */
export default function AppShell({ active, children, title, subtitle, fillViewport = false, actions }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // false jusqu’à confirmation — évite d’afficher la nav studio aux visiteurs
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        const ok = Boolean(d?.authenticated);
        setAuthed(ok);
        if (ok) void ensureKeysHydrated();
      })
      .catch(() => setAuthed(false));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.sonozzNav = authed ? "sidebar" : "";
    return () => {
      document.documentElement.dataset.sonozzNav = "";
    };
  }, [authed]);

  useEffect(() => {
    if (!fillViewport) return undefined;
    document.documentElement.dataset.sonozzFillViewport = "1";
    return () => {
      delete document.documentElement.dataset.sonozzFillViewport;
    };
  }, [fillViewport]);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    location.assign("/login");
  }

  const chromePad = {
    paddingBottom:
      "calc(var(--sonozz-jobs-dock, 0px) + var(--sonozz-now-playing, 5.25rem))",
  };

  if (!authed) {
    return (
      <div class={fillViewport ? "flex h-dvh flex-col overflow-hidden" : "min-h-screen"}>
        <header class="shrink-0 sticky top-0 z-30 border-b border-base-content/10 bg-base-200/90 backdrop-blur">
          <div class="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3 sm:px-6">
            <a href="/play" class="inline-flex items-center gap-3" aria-label="SONOZZ — Play">
              <img
                src="/logo.png"
                alt="SONOZZ"
                class="h-10 w-10 rounded-xl object-cover shadow-md shadow-black/30 sm:h-11 sm:w-11"
                width="44"
                height="44"
              />
              <span class="font-display text-lg font-bold tracking-tight text-base-content sm:text-xl">
                SONOZZ
              </span>
            </a>
          </div>
        </header>

        {(title || subtitle || actions) && (
          <div
            class={`mx-auto flex w-full max-w-4xl shrink-0 items-start justify-between gap-3 border-b border-base-content/10 px-4 sm:px-6 ${
              fillViewport ? "py-3" : "py-4 sm:py-6"
            }`}
          >
            <div class="min-w-0">
              {title && (
                <h1
                  class={`font-display font-extrabold tracking-tight ${
                    fillViewport ? "text-xl sm:text-2xl" : "text-2xl sm:text-3xl"
                  }`}
                >
                  {title}
                </h1>
              )}
              {subtitle && (
                <p class={`max-w-2xl text-sm text-base-content/60 ${fillViewport ? "mt-0.5 line-clamp-1" : "mt-1"}`}>
                  {subtitle}
                </p>
              )}
            </div>
            {actions ? <div class="shrink-0">{actions}</div> : null}
          </div>
        )}

        <div
          class={
            fillViewport
              ? "mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden px-3 pt-3 sm:px-6"
              : "mx-auto max-w-4xl px-3 py-4 sm:px-6 sm:py-6"
          }
          style={fillViewport ? chromePad : undefined}
        >
          {children}
          {!fillViewport && <BottomChromeSpacer />}
        </div>
      </div>
    );
  }

  return (
    <div class={fillViewport ? "flex h-dvh flex-col overflow-hidden md:flex-row" : "min-h-screen md:flex"}>
      <div class="sticky top-0 z-30 flex shrink-0 items-center justify-between border-b border-base-content/10 bg-base-200/90 px-4 py-3 backdrop-blur md:hidden">
        <a href="/" class="inline-flex items-center" aria-label="SONOZZ — Accueil">
          <img src="/logo.png" alt="SONOZZ" class="h-9 w-9 rounded-lg object-cover" width="36" height="36" />
        </a>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-square"
          aria-label={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {mobileOpen && (
        <div
          class="fixed inset-0 z-20 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
          role="presentation"
        />
      )}

      <aside
        class={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-base-content/10 bg-base-200/95 backdrop-blur transition-transform md:static md:h-full md:shrink-0 md:translate-x-0 md:bg-base-200/40 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div class="hidden border-b border-base-content/10 px-5 py-5 md:block">
          <a href="/" class="block" aria-label="SONOZZ — Accueil">
            <img
              src="/logo.png"
              alt="SONOZZ"
              class="w-full rounded-2xl object-cover shadow-md shadow-black/25"
              width="256"
              height="256"
            />
          </a>
        </div>

        <nav class="flex flex-col gap-1 p-3" aria-label="Navigation principale">
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <a
                key={item.id}
                href={item.href}
                title={item.hint || item.label}
                class={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition ${
                  isActive
                    ? "bg-primary/15 font-semibold text-primary"
                    : "text-base-content/70 hover:bg-base-content/5 hover:text-base-content"
                }`}
                onClick={() => setMobileOpen(false)}
              >
                <Icon size={18} />
                {item.label}
              </a>
            );
          })}
        </nav>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <div class="hidden md:block">
            <JobsDock />
          </div>
        </div>

        <div class="border-t border-base-content/10 p-3 text-xs text-base-content/45">
          <a href="/legal/privacy" class="flex items-center gap-2 px-3 py-1.5 hover:text-base-content">
            <Scale size={12} /> Confidentialité
          </a>
          <a href="/legal/terms" class="flex items-center gap-2 px-3 py-1.5 hover:text-base-content">
            <Scale size={12} /> Conditions
          </a>
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:text-base-content"
            onClick={logout}
          >
            <LogOut size={12} /> Déconnexion
          </button>
        </div>
      </aside>

      <div class={`min-w-0 flex-1 ${fillViewport ? "flex min-h-0 flex-col overflow-hidden" : ""}`}>
        {(title || subtitle || actions) && (
          <header
            class={`flex shrink-0 items-start justify-between gap-3 border-b border-base-content/10 px-4 md:px-8 ${
              fillViewport ? "py-3 sm:py-4" : "py-4 sm:py-6 md:py-8"
            }`}
          >
            <div class="min-w-0">
              {title && (
                <h1
                  class={`font-display font-extrabold tracking-tight ${
                    fillViewport
                      ? "text-xl sm:text-2xl"
                      : "text-2xl sm:text-3xl md:text-4xl"
                  }`}
                >
                  {title}
                </h1>
              )}
              {subtitle && (
                <p
                  class={`max-w-2xl text-sm text-base-content/60 md:text-base ${
                    fillViewport ? "mt-0.5 line-clamp-1" : "mt-1"
                  }`}
                >
                  {subtitle}
                </p>
              )}
            </div>
            {actions ? <div class="shrink-0">{actions}</div> : null}
          </header>
        )}
        <div
          class={
            fillViewport
              ? "flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-3 sm:px-4 md:px-8"
              : "px-3 py-4 sm:px-4 sm:py-6 md:px-8 md:py-8"
          }
          style={fillViewport ? chromePad : undefined}
        >
          {children}
          {!fillViewport && <BottomChromeSpacer includeJobs />}
        </div>
      </div>

      <JobsDockMobile />
    </div>
  );
}
