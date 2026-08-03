import { TrendingUp, Users, Sparkles } from "lucide-preact";

function displayScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 0;
  if (n > 0 && n <= 1) return Math.round(n * 100);
  return Math.max(0, Math.min(100, Math.round(n)));
}

export default function TrendsStep({ trends, artist, loading, onAnalyze }) {
  const hasArtist = Boolean(artist?.name);
  const artistName = artist?.name;

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Déterminer les tendances</h2>
        <p class="max-w-xl text-base-content/70">
          {hasArtist
            ? `Positionnement de ${artistName} face aux charts Deezer + analyse Gemini (+ stats catalogue / Spotify si dispo).`
            : "Charts Deezer en live + analyse Gemini (+ Spotify si configuré)."}
        </p>
      </header>

      <button class="btn btn-primary gap-2" onClick={onAnalyze} disabled={loading}>
        {loading ? <span class="loading loading-spinner loading-sm" /> : <TrendingUp size={18} />}
        {loading
          ? "Analyse en cours…"
          : hasArtist
            ? `Analyser le marché pour ${artistName}`
            : "Lancer l'analyse du marché"}
      </button>

      {trends && (
        <div class="space-y-5 animate-rise">
          {trends.forArtist?.name && (
            <p class="text-xs uppercase tracking-wider text-base-content/45">
              Analyse pour {trends.forArtist.name}
            </p>
          )}
          <p class="text-sm text-primary/90">{trends.opportunity}</p>

          <ul class="space-y-3">
            {(trends.rising || []).map((item) => {
              const score = displayScore(item.score);
              return (
              <li key={item.tag} class="grid gap-2 border-b border-base-content/10 pb-3 last:border-0">
                <div class="flex items-center justify-between gap-3">
                  <span class="font-medium">{item.tag}</span>
                  <span class="font-display text-primary">{score}%</span>
                </div>
                <div class="h-1.5 overflow-hidden rounded-full bg-base-300">
                  <div class="progress-fill h-full rounded-full bg-primary" style={{ width: `${score}%` }} />
                </div>
                <span class="text-xs text-base-content/55">{item.note}</span>
              </li>
              );
            })}
          </ul>

          {!hasArtist && trends.audience && (
            <div class="flex flex-wrap gap-4 text-sm text-base-content/75">
              <span class="inline-flex items-center gap-2">
                <Users size={16} class="text-secondary" /> {trends.audience.age} · {trends.audience.listening}
              </span>
              <span class="inline-flex items-center gap-2">
                <Sparkles size={16} class="text-accent" /> {(trends.audience.platforms || []).join(" · ")}
              </span>
            </div>
          )}

          {!hasArtist && trends.charts?.topTracks?.length > 0 && (
            <div>
              <h3 class="mb-2 font-display text-sm font-semibold uppercase tracking-wider text-base-content/45">
                Top Deezer
              </h3>
              <ul class="space-y-1 text-sm text-base-content/70">
                {trends.charts.topTracks.map((t) => (
                  <li key={`${t.title}-${t.artist}`}>
                    {t.title} <span class="text-base-content/40">— {t.artist}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
