import { PageEnter, Pressable, Reveal, Stagger, HoverLift } from "./ui/Motion.jsx";

/**
 * Landing marketing — Motion (Preact) : hero, étapes, pricing.
 * Brand brass / OLED (design-system/sonozz/MASTER.md).
 */
export default function LandingHome({
  freeBullets = [],
  proBullets = [],
  publishBullets = [],
  plans = {},
}) {
  const freePrice = plans?.free?.priceLabel || "Gratuit";
  const proMonthly = plans?.pro?.priceMonthlyEur ?? "—";
  const publishPrice = plans?.publishPlus?.priceLabel || "Sur devis";

  return (
    <div class="min-h-full">
      <header class="sticky top-0 z-30 border-b border-base-content/10 bg-base-200/80 backdrop-blur-md">
        <div class="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-6 sm:py-4">
          <a href="/" class="inline-flex cursor-pointer items-center gap-3" aria-label="SONOZZ">
            <img
              src="/logo.png"
              alt=""
              class="h-10 w-10 rounded-xl object-cover shadow-md shadow-black/40"
              width="40"
              height="40"
            />
            <span class="font-display text-lg font-extrabold tracking-[0.08em] text-primary sm:text-xl">
              SONOZZ
            </span>
          </a>
          <nav class="flex items-center gap-2 sm:gap-3">
            <a href="/play" class="btn btn-ghost btn-sm cursor-pointer px-2 sm:px-3">
              Écouter
            </a>
            <a href="/login" class="btn btn-primary btn-sm cursor-pointer px-2 sm:px-3 shadow-md shadow-primary/20">
              Connexion
            </a>
          </nav>
        </div>
      </header>

      <section class="relative overflow-hidden">
        <div
          class="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/25 via-transparent to-secondary/20"
          aria-hidden="true"
        />
        <div
          class="pointer-events-none absolute -right-24 top-10 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
          aria-hidden="true"
        />
        <PageEnter class="relative mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-24 md:py-28">
          <p class="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-primary/90">
            Artiste IA · titres · publication
          </p>
          <h1 class="font-display max-w-3xl text-[1.85rem] font-extrabold leading-[1.1] tracking-tight text-base-content sm:text-5xl md:text-6xl">
            SONOZZ
          </h1>
          <p class="mt-3 max-w-2xl font-display text-xl font-semibold leading-snug text-base-content/85 sm:text-2xl md:text-3xl">
            Crée ton artiste, génère des titres, publie.
          </p>
          <p class="mt-5 max-w-2xl text-base text-base-content/65 sm:text-lg">
            Un flux en trois étapes — sans serveur à installer. Tu lances, tu génères, tu partages
            sur <span class="text-base-content/90">/play</span>.
          </p>
          <div class="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Pressable
              as="a"
              href="/signup"
              class="btn btn-primary btn-lg w-full cursor-pointer shadow-lg shadow-primary/30 sm:w-auto"
              scale={0.97}
            >
              Créer mon artiste
            </Pressable>
            <a
              href="/play"
              class="btn btn-outline btn-lg w-full cursor-pointer border-base-content/20 sm:w-auto"
            >
              Écouter le catalogue
            </a>
          </div>
        </PageEnter>
      </section>

      <section class="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
        <Reveal>
          <h2 class="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Trois étapes. C’est tout.
          </h2>
        </Reveal>
        <Stagger
          as="ol"
          class="mt-10 grid gap-5 sm:grid-cols-3"
          step={0.07}
          y={16}
          duration={0.36}
        >
          {[
            {
              n: "1",
              title: "Artiste",
              body: "Genre, nom, identité. Ton profil est prêt en minutes.",
            },
            {
              n: "2",
              title: "Titres",
              body: "Paroles, audio, jaquette. Relance ce qui ne te plaît pas.",
            },
            {
              n: "3",
              title: "Publie",
              body: "Lecteur public, ou mise en ligne stores sur demande.",
            },
          ].map((step) => (
            <HoverLift
              key={step.n}
              as="li"
              class="rounded-2xl border border-base-content/10 bg-base-200/50 p-6 shadow-sm shadow-black/10"
            >
              <span class="font-display text-3xl font-extrabold text-primary/80">{step.n}</span>
              <h3 class="mt-2 font-display text-lg font-bold">{step.title}</h3>
              <p class="mt-1.5 text-sm leading-relaxed text-base-content/65">{step.body}</p>
            </HoverLift>
          ))}
        </Stagger>
      </section>

      <section id="pricing" class="border-y border-base-content/10 bg-base-200/30">
        <div class="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
          <Reveal>
            <h2 class="font-display text-2xl font-bold tracking-tight sm:text-3xl">Offre simple</h2>
            <p class="mt-2 max-w-2xl text-sm text-base-content/60">
              1 crédit = 1 génération de titre. Quotas Free / Pro / Publish+ gérés depuis /admin.
            </p>
          </Reveal>
          <div class="mt-10 grid gap-5 lg:grid-cols-3">
            <HoverLift
              as="article"
              class="flex flex-col rounded-2xl border border-base-content/10 bg-base-100/80 p-6 shadow-sm"
            >
              <h3 class="font-display text-xl font-bold">Free</h3>
              <p class="mt-1 text-3xl font-extrabold">{freePrice}</p>
              <ul class="mt-4 flex-1 space-y-2 text-sm text-base-content/70">
                {freeBullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <a
                href="/signup"
                class="btn btn-outline btn-block mt-6 cursor-pointer border-base-content/20"
              >
                Commencer
              </a>
            </HoverLift>

            <HoverLift
              as="article"
              class="relative flex flex-col rounded-2xl border-2 border-primary/50 bg-gradient-to-b from-primary/15 to-base-100/90 p-6 shadow-lg shadow-primary/15"
              scale={1.02}
            >
              <span class="absolute -top-3 left-4 rounded-full bg-primary px-3 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary-content">
                Recommandé
              </span>
              <h3 class="font-display text-xl font-bold">Pro</h3>
              <p class="mt-1 text-3xl font-extrabold">
                {proMonthly}&nbsp;€
                <span class="text-base font-semibold text-base-content/50">/mois</span>
              </p>
              <ul class="mt-4 flex-1 space-y-2 text-sm text-base-content/70">
                {proBullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <Pressable
                as="a"
                href="/signup?next=%2Fbilling"
                class="btn btn-primary btn-block mt-6 cursor-pointer"
                scale={0.97}
              >
                Passer Pro
              </Pressable>
            </HoverLift>

            <HoverLift
              as="article"
              class="flex flex-col rounded-2xl border border-base-content/10 bg-base-100/80 p-6 shadow-sm"
            >
              <h3 class="font-display text-xl font-bold">Publish+</h3>
              <p class="mt-1 text-lg font-bold text-base-content/80">{publishPrice}</p>
              <ul class="mt-4 flex-1 space-y-2 text-sm text-base-content/70">
                {publishBullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <a
                href="/signup?next=%2Fbilling%3Fplan%3Dpublish_plus"
                class="btn btn-outline btn-block mt-6 cursor-pointer border-base-content/20"
              >
                Demander Publish+
              </a>
            </HoverLift>
          </div>
        </div>
      </section>

      <footer class="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-sm text-base-content/50">SONOZZ — artiste IA, titres, publication.</p>
          <div class="flex flex-wrap gap-4 text-sm">
            <a href="/play" class="link link-hover cursor-pointer">
              Lecteur
            </a>
            <a href="/login" class="link link-hover cursor-pointer">
              Studio
            </a>
            <a href="/legal/terms" class="link link-hover cursor-pointer">
              Conditions
            </a>
            <a href="/legal/privacy" class="link link-hover cursor-pointer">
              Confidentialité
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
