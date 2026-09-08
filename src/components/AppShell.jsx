import { useEffect, useState } from "preact/hooks";
import {
  Waves,
  UserRound,
  Settings2,
  Menu,
  X,
  Headphones,
  LogOut,
  Search,
  Scale,
} from "lucide-preact";
import JobsDock, { JobsDockMobile } from "./JobsDock.jsx";
import { ensureKeysHydrated } from "../lib/keys.js";

const NAV = [
  { href: "/studio", id: "studio", label: "Studio", icon: Waves },
  { href: "/artistes", id: "artistes", label: "Artistes", icon: UserRound },
  { href: "/play", id: "play", label: "Play", icon: Headphones },
  { href: "/admin", id: "admin", label: "Admin", icon: Settings2, adminOnly: true },
  { href: "/parametres", id: "parametres", label: "Paramètres", icon: Settings2, adminOnly: true },
  { href: "/compte", id: "compte", label: "Compte", icon: UserRound, memberOnly: true },
];

function initialsFromEmail(email) {
  const local = String(email || "").split("@")[0] || "";
  const parts = local.split(/[._\-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }
  return (local.slice(0, 2) || "?").toUpperCase();
}

export default function AppShell({
  active,
  children,
  title,
  subtitle,
  fillViewport = false,
  actions,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState(null);
  const [canManageSettings, setCanManageSettings] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        const ok = Boolean(d?.authenticated);
        setAuthed(ok);
        setEmail(d?.email || null);
        setCanManageSettings(Boolean(d?.canManageSettings));
        if (ok && d?.canManageSettings) void ensureKeysHydrated();
      })
      .catch(() => setAuthed(false));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.sonozzNav = authed ? "sidebar" : "";
    return () => {
      document.documentElement.dataset.sonozzNav = "";
    };
  }, [authed]);

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

  const accountHref = canManageSettings ? "/parametres?section=compte" : "/compte";
  const navItems = NAV.filter((item) => {
    if (item.adminOnly && !canManageSettings) return false;
    if (item.memberOnly && canManageSettings) return false;
    return true;
  });

  if (!authed) {
    return (
      <div class={fillViewport ? "flex h-dvh flex-col overflow-hidden" : "min-h-screen"}>
        <header class="shrink-0 sticky top-0 z-30 border-b border-base-content/10 bg-base-200/90 backdrop-blur">
          <div class="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3 sm:px-6">
            <a href="/play" class="font-display text-lg font-extrabold tracking-[0.08em] text-primary sm:text-xl">
              SONOZZ
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
          <div class="mx-auto flex w-full max-w-4xl shrink-0 items-start justify-between gap-3 border-b border-base-content/10 px-4 py-4 sm:px-6">
            <div class="min-w-0">
              {title && <h1 class="font-display text-2xl font-extrabold tracking-tight">{title}</h1>}
              {subtitle && <p class="mt-1 max-w-2xl text-sm text-base-content/60">{subtitle}</p>}
            </div>
            {actions ? <div class="shrink-0">{actions}</div> : null}
          </div>
        )}
        <div class="mx-auto max-w-4xl px-3 py-4 sm:px-6 sm:py-6">{children}</div>
      </div>
    );
  }

  return (
    <div class={fillViewport ? "flex h-dvh flex-col overflow-hidden" : "flex min-h-screen flex-col"}>
      <header class="sticky top-0 z-40 shrink-0 border-b border-base-content/10 bg-base-200/90 backdrop-blur-md">
        <div class="flex h-14 items-center gap-2 px-2 sm:h-16 sm:gap-4 sm:px-5 md:px-6">
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-square shrink-0 md:hidden"
            aria-label={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={mobileOpen}
            aria-controls="sonozz-mobile-nav"
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <a
            href="/studio"
            class="shrink-0 font-display text-lg font-extrabold tracking-[0.08em] text-primary sm:text-xl"
            aria-label="SONOZZ — Studio"
          >
            SONOZZ
          </a>
          <form
            class="mx-auto flex min-w-0 max-w-[9.5rem] flex-1 sm:max-w-md md:max-w-xl"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              submitSearch(search);
            }}
          >
            <label class="relative flex w-full items-center">
              <span class="pointer-events-none absolute left-3 text-base-content/40">
                <Search size={16} />
              </span>
              <input
                type="search"
                name="q"
                value={search}
                placeholder="Rechercher titres, artistes…"
                class="input input-sm h-9 w-full rounded-full border-base-content/10 bg-base-300/80 pl-9 pr-3 text-sm placeholder:text-base-content/40 focus:border-primary/40 focus:outline-none sm:h-10 sm:input-md"
                onInput={(e) => setSearch(e.currentTarget.value)}
              />
            </label>
          </form>
          <a
            href={accountHref}
            class="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/20 text-xs font-bold text-primary ring-2 ring-base-content/10 transition hover:ring-primary/40 sm:h-10 sm:w-10 sm:text-sm"
            title={email || "Compte"}
            aria-label="Compte"
          >
            {email ? initialsFromEmail(email) : <UserRound size={16} />}
          </a>
        </div>
      </header>

      <div class={`relative flex min-h-0 flex-1 ${fillViewport ? "overflow-hidden" : ""}`}>
        {mobileOpen && (
          <div
            class="fixed inset-0 z-40 bg-black/60 md:hidden"
            style={{ top: "var(--sonozz-top-header, 3.5rem)" }}
            onClick={() => setMobileOpen(false)}
            role="presentation"
          />
        )}

        <aside
          id="sonozz-mobile-nav"
          class={`fixed left-0 z-50 flex w-[min(16rem,85vw)] flex-col border-r border-base-content/10 bg-base-200 shadow-xl transition-transform md:static md:z-auto md:h-auto md:w-64 md:translate-x-0 md:bg-base-200/40 md:shadow-none ${
            mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
          }`}
          style={{
            top: "var(--sonozz-top-header, 3.5rem)",
            bottom: "var(--sonozz-now-playing, 5.5rem)",
            maxHeight:
              "calc(100dvh - var(--sonozz-top-header, 3.5rem) - var(--sonozz-now-playing, 5.5rem))",
          }}
        >
          <nav class="flex flex-col gap-1 p-3 pt-4" aria-label="Navigation principale">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <a
                  key={item.id}
                  href={item.href}
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
            <div class="flex shrink-0 items-start justify-between gap-3 px-4 pb-2 pt-5 md:px-8 md:pt-7">
              <div class="min-w-0">
                {title && (
                  <h1 class="font-display text-2xl font-extrabold tracking-tight sm:text-3xl md:text-4xl">
                    {title}
                  </h1>
                )}
                {subtitle && (
                  <p class="mt-1 max-w-2xl text-sm text-base-content/60 md:text-base">{subtitle}</p>
                )}
              </div>
              {actions ? <div class="shrink-0">{actions}</div> : null}
            </div>
          )}
          <div class="px-3 py-4 sm:px-4 sm:py-5 md:px-8 md:py-6">{children}</div>
        </div>
      </div>

      <JobsDockMobile />
    </div>
  );
}
