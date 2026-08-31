import { useEffect, useRef, useState } from "preact/hooks";
import {
  Waves,
  UserRound,
  Settings2,
  Menu,
  X,
  Scale,
  Headphones,
  LogOut,
  Search,
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

function initialsFromEmail(email) {
  const local = String(email || "").split("@")[0] || "";
  const parts = local.split(/[._\-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }
  return (local.slice(0, 2) || "?").toUpperCase();
}

function TopHeader({
  email,
  search,
  onSearchChange,
  onSearchSubmit,
  mobileOpen,
  onToggleMobile,
  showMobileMenu,
}) {
  const inputRef = useRef(null);

  return (
    <header class="sticky top-0 z-40 shrink-0 border-b border-base-content/10 bg-base-200/90 backdrop-blur-md">
      <div class="flex h-14 items-center gap-3 px-3 sm:h-16 sm:gap-4 sm:px-5 md:px-6">
        {showMobileMenu && (
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-square md:hidden"
            aria-label={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
            onClick={onToggleMobile}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        )}

        <a
          href="/"
          class="shrink-0 font-display text-lg font-extrabold tracking-[0.08em] text-primary sm:text-xl"
          aria-label="SONOZZ — Accueil"
        >
          SONOZZ
        </a>

        <form
          class="mx-auto flex min-w-0 max-w-xl flex-1"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            onSearchSubmit?.(search);
          }}
        >
          <label class="relative flex w-full items-center">
            <span class="pointer-events-none absolute left-3 text-base-content/40">
              <Search size={16} />
            </span>
            <input
              ref={inputRef}
              type="search"
              name="q"
              value={search}
              placeholder="Rechercher titres, artistes…"
              class="input input-sm h-9 w-full rounded-full border-base-content/10 bg-base-300/80 pl-9 pr-3 text-sm placeholder:text-base-content/40 focus:border-primary/40 focus:outline-none sm:h-10 sm:input-md"
              onInput={(e) => onSearchChange?.(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  onSearchChange?.("");
                  e.currentTarget.blur();
                }
              }}
            />
          </label>
        </form>

        <a
          href="/parametres"
          class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/20 text-xs font-bold text-primary ring-2 ring-base-content/10 transition hover:ring-primary/40 sm:h-10 sm:w-10 sm:text-sm"
          title={email || "Paramètres"}
          aria-label="Compte et paramètres"
        >
          {email ? initialsFromEmail(email) : <UserRound size={16} />}
        </a>
      </div>
    </header>
  );
}

/**
 * Shell app avec top header (logo · recherche · avatar) + sidebar (si connecté)
 * ou bandeau logo public (écoute /play).
 * @param {{ active: 'studio' | 'artistes' | 'play' | 'parametres', children: any, title?: string, subtitle?: string, fillViewport?: boolean, actions?: any }} props
 */
export default function AppShell({ active, children, title, subtitle, fillViewport = false, actions }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        const ok = Boolean(d?.authenticated);
        setAuthed(ok);
        setEmail(d?.email || null);
        if (ok) void ensureKeysHydrated();
      })
      .catch(() => setAuthed(false));
  }, []);

  useEffect(() => {
    if (typeof location === "undefined") return;
    try {
      const q = new URLSearchParams(location.search).get("q") || "";
      setSearch(q);
    } catch {
      /* ignore */
    }
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

  function submitSearch(value) {
    const q = String(value || "").trim();
    const url = new URL("/play", location.origin);
    if (q) url.searchParams.set("q", q);
    location.assign(url.pathname + url.search);
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
              <span class="font-display text-lg font-extrabold tracking-[0.08em] text-primary sm:text-xl">
                SONOZZ
              </span>
            </a>
            <form
              class="ml-auto flex min-w-0 max-w-xs flex-1 sm:max-w-sm"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch(search);
              }}
            >
              <label class="relative flex w-full items-center">
                <span class="pointer-events-none absolute left-3 text-base-content/40">
                  <Search size={14} />
                </span>
                <input
                  type="search"
                  value={search}
                  placeholder="Rechercher…"
                  class="input input-sm h-9 w-full rounded-full border-base-content/10 bg-base-300/80 pl-9 text-sm"
                  onInput={(e) => setSearch(e.currentTarget.value)}
                />
              </label>
            </form>
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
    <div class={fillViewport ? "flex h-dvh flex-col overflow-hidden" : "flex min-h-screen flex-col"}>
      <TopHeader
        email={email}
        search={search}
        onSearchChange={setSearch}
        onSearchSubmit={submitSearch}
        mobileOpen={mobileOpen}
        onToggleMobile={() => setMobileOpen((v) => !v)}
        showMobileMenu
      />

      <div class={`relative flex min-h-0 flex-1 ${fillViewport ? "overflow-hidden" : ""}`}>
        {mobileOpen && (
          <div
            class="fixed inset-0 z-20 bg-black/60 md:hidden"
            style={{ top: "var(--sonozz-top-header, 3.5rem)" }}
            onClick={() => setMobileOpen(false)}
            role="presentation"
          />
        )}

        <aside
          class={`fixed left-0 z-20 flex w-64 flex-col border-r border-base-content/10 bg-base-200/95 backdrop-blur transition-transform md:static md:z-auto md:h-auto md:translate-x-0 md:bg-base-200/40 md:pb-[length:var(--sonozz-now-playing,5.5rem)] ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          style={{
            top: "var(--sonozz-top-header, 3.5rem)",
            bottom: "var(--sonozz-now-playing, 5.5rem)",
          }}
        >
          <nav class="flex flex-col gap-1 p-3 pt-4" aria-label="Navigation principale">
            {NAV.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <a
                  key={item.id}
                  href={item.href}
                  title={item.hint || item.label}
                  class={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
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
            <div
              class={`flex shrink-0 items-start justify-between gap-3 px-4 md:px-8 ${
                fillViewport ? "py-3 sm:py-4" : "pb-2 pt-5 sm:pt-6 md:pt-7"
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
            </div>
          )}
          <div
            class={
              fillViewport
                ? "flex min-h-0 flex-1 flex-col overflow-hidden px-3 pt-2 sm:px-4 md:px-8"
                : "px-3 py-4 sm:px-4 sm:py-5 md:px-8 md:py-6"
            }
            style={fillViewport ? chromePad : undefined}
          >
            {children}
            {!fillViewport && <BottomChromeSpacer includeJobs />}
          </div>
        </div>
      </div>

      <JobsDockMobile />
    </div>
  );
}
