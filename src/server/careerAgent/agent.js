import { llmJson, requireTextLlm, resolveTextModel, isOllamaProvider } from "../llm.js";
import { buildCareerHeuristics, buildCareerSchedule } from "./heuristics.js";

function fallbackNextSingle(heuristics, artist) {
  const genre = artist?.profile?.genre || "pop";
  const mood = artist?.profile?.mood || "émotionnel";
  return {
    theme: heuristics.themeSeed,
    titleHint: "",
    angle: `${genre} · ${mood}`,
    why: heuristics.summary,
  };
}

/**
 * Agent carrière : heuristiques + LLM (Gemini ou Ollama).
 */
export async function runCareerAgent({ keys, artist, releases, stats }) {
  const heuristics = buildCareerHeuristics({ artist, releases, stats });
  const base = {
    updatedAt: new Date().toISOString(),
    source: "heuristics",
    model: null,
    verdict: heuristics.verdict,
    summary: heuristics.summary,
    nextSingle: fallbackNextSingle(heuristics, artist),
    actions: heuristics.actions,
    releaseFocus: heuristics.releaseFocus,
    cadence: heuristics.cadence,
    catalogue: heuristics.catalogue,
    schedule: heuristics.schedule,
  };

  try {
    requireTextLlm(keys);
  } catch {
    return base;
  }

  try {
    const data = await llmJson(
      keys,
      `Tu es le manager IA d'un artiste musical sur SONOZZ (distribution ONCE → Spotify, Unison publishing).
Décide la prochaine action de carrière. Réponds en français, JSON strict.

Artiste:
${JSON.stringify({
  name: artist?.name,
  slug: artist?.slug,
  genre: artist?.profile?.genre,
  mood: artist?.profile?.mood,
  city: artist?.profile?.city,
  bio: String(artist?.profile?.bio || "").slice(0, 400),
  influences: artist?.profile?.influences || [],
  language: artist?.profile?.language || "fr",
})}

Catalogue / stats (faits):
${JSON.stringify(heuristics.catalogue)}

Verdict heuristique imposé (ne le contredis que si les faits le justifient clairement): "${heuristics.verdict}"
Résumé heuristique: ${heuristics.summary}
Titres déjà sortis (évite les doublons thématiques): ${JSON.stringify(heuristics.catalogue.titles)}
Focus release: ${JSON.stringify(heuristics.releaseFocus)}
Agenda déjà calculé (ne le réécris pas): ${heuristics.schedule?.length || 0} étapes

JSON:
{
  "verdict": "produce" | "wait" | "promote" | "pivot" | "publish",
  "summary": "2 phrases max, direct, actionnable",
  "nextSingle": {
    "theme": "brief thème/paroles prêt à coller dans le studio (1 phrase riche)",
    "titleHint": "titre provisoire optionnel",
    "angle": "angle créatif court",
    "why": "pourquoi ce thème maintenant"
  },
  "actions": [
    { "priority": 1, "type": "produce|wait_distribution|promote|publish_unison|refresh_stats|submit_once|fix_release", "label": "court", "detail": "1 ligne" }
  ],
  "cadenceNote": "timing suggéré en 1 ligne"
}

Règles:
- Si verdict=wait → nextSingle.theme peut être préparé mais actions[0] = wait_distribution ou refresh_stats.
- Si verdict=publish → actions[0] = publish_unison.
- Thème original, cohérent avec l'artiste, PAS une copie des titres existants.
- Max 4 actions, triées par priority.`,
    );

    const verdict = ["produce", "wait", "promote", "pivot", "publish"].includes(data?.verdict)
      ? data.verdict
      : heuristics.verdict;

    const actions = Array.isArray(data?.actions) && data.actions.length
      ? data.actions
          .slice(0, 4)
          .map((a, i) => ({
            priority: Number(a.priority) || i + 1,
            type: String(a.type || "produce"),
            label: String(a.label || "Action").slice(0, 80),
            detail: String(a.detail || "").slice(0, 200),
            ...(heuristics.actions.find((h) => h.type === a.type)?.href
              ? { href: heuristics.actions.find((h) => h.type === a.type).href }
              : {}),
          }))
          .sort((a, b) => a.priority - b.priority)
      : heuristics.actions;

    const ns = data?.nextSingle || {};
    const merged = {
      ...base,
      source: isOllamaProvider(keys) ? "ollama+heuristics" : "gemini+heuristics",
      model: resolveTextModel(keys),
      verdict,
      summary: String(data?.summary || heuristics.summary).slice(0, 500),
      nextSingle: {
        theme: String(ns.theme || heuristics.themeSeed).slice(0, 280),
        titleHint: String(ns.titleHint || "").slice(0, 80),
        angle: String(ns.angle || "").slice(0, 160),
        why: String(ns.why || heuristics.summary).slice(0, 280),
      },
      actions,
      cadence: {
        ...heuristics.cadence,
        note: String(data?.cadenceNote || heuristics.cadence.note).slice(0, 200),
      },
    };
    // Recalcule l'agenda si le LLM a changé le verdict
    if (verdict !== heuristics.verdict) {
      merged.schedule = buildCareerSchedule({
        ...heuristics,
        verdict,
        summary: merged.summary,
        themeSeed: merged.nextSingle.theme,
        cadence: merged.cadence,
      });
    }
    return merged;
  } catch (e) {
    return {
      ...base,
      warning: e.message || "LLM indisponible — heuristiques seules",
    };
  }
}
