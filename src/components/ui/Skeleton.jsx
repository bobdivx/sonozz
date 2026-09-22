/**
 * Skeleton shimmer — chargement catalogue (UI/UX Pro Max : loader only).
 */
export function Skeleton({ class: className = "" }) {
  return <div class={`sonozz-shimmer rounded-2xl bg-base-300/60 ${className}`} aria-hidden="true" />;
}

export function ArtistCardSkeletons({ count = 3 }) {
  return (
    <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} class="overflow-hidden rounded-3xl border border-base-content/10 bg-base-300/30">
          <Skeleton class="aspect-[4/5] w-full rounded-none" />
          <div class="space-y-2 p-4">
            <Skeleton class="h-4 w-2/3" />
            <Skeleton class="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TrackRowSkeletons({ count = 6 }) {
  return (
    <ul class="space-y-2" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} class="flex items-center gap-3 rounded-xl px-2 py-2">
          <Skeleton class="h-12 w-12 shrink-0 rounded-lg" />
          <div class="min-w-0 flex-1 space-y-2">
            <Skeleton class="h-3.5 w-3/5" />
            <Skeleton class="h-3 w-2/5" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function StepPanelSkeleton() {
  return (
    <div class="space-y-4" aria-busy="true" aria-label="Chargement de l’étape">
      <Skeleton class="h-8 w-48" />
      <Skeleton class="h-4 w-full max-w-md" />
      <Skeleton class="h-40 w-full" />
      <div class="flex gap-3">
        <Skeleton class="h-10 w-28 rounded-full" />
        <Skeleton class="h-10 w-28 rounded-full" />
      </div>
    </div>
  );
}

export function PlayHomeSkeleton() {
  return (
    <div class="mx-auto w-full max-w-5xl space-y-8" aria-busy="true" aria-label="Chargement">
      <Skeleton class="h-10 w-40" />
      <Skeleton class="h-[5.5rem] w-full rounded-2xl" />
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} class="h-[4.75rem] w-full rounded-md" />
        ))}
      </div>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} class="flex flex-col items-center gap-2">
            <Skeleton class="h-20 w-20 rounded-full" />
            <Skeleton class="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
