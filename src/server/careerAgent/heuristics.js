function isLiveStatus(status = "") {
  return /live|distributed|delivered|success/i.test(String(status));
}

function isPendingStatus(status = "") {
  return /pending|inspect|queued|process|submitted/i.test(String(status));
}

function isFailStatus(status = "") {
  return /fail|error|reject/i.test(String(status));
}

function addDays(isoOrDate, days) {
  const d = new Date(isoOrDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Heuristiques métier avant Gemini — décisions utiles même sans clé / quota.
 */
export function buildCareerHeuristics({ artist, releases = [], stats = {} } = {}) {
  const delivery = stats.delivery || {};
  const releaseStreams = stats.releaseStreams || {};
  const streams = stats.streams || {};
  const totalStreams = Number(streams.totalStreams) || 0;

  const enriched = releases.map((r) => {
    const d = r.releaseId ? delivery[r.releaseId] : null;
    const s = r.releaseId ? releaseStreams[r.releaseId] : null;
    const spotify = d?.spotifyStatus || "";
    const aggregate = d?.aggregateStatus || "";
    const statusBlob = `${r.onceStatus || ""} ${spotify} ${aggregate}`;
    const publishing = d?.publishing || null;
    const identifiers = d?.identifiers || null;
    return {
      ...r,
      delivery: d,
      streams: s,
      publishing,
      identifiers,
      live: isLiveStatus(statusBlob) || Boolean(d?.spotifyUrl),
      pending: isPendingStatus(statusBlob) && !isLiveStatus(statusBlob),
      failed: isFailStatus(statusBlob) || Boolean(d?.error),
      streamCount: Number(s?.totalStreams) || 0,
      unisonReady: Boolean(publishing?.canSubmitUnison),
      dashboardUrl: d?.dashboardUrl || (r.releaseId ? `https://beta.once.app/releases/${r.releaseId}` : null),
    };
  });

  const live = enriched.filter((r) => r.live);
  const pending = enriched.filter((r) => r.pending);
  const failed = enriched.filter((r) => r.failed);
  const unisonReady = enriched.filter((r) => r.unisonReady);
  const withAudio = enriched.filter((r) => r.hasAudio);
  const submitted = enriched.filter(
    (r) => r.onceStatus === "submitted" || r.distributed,
  );

  let verdict = "produce";
  let summary = "";
  /** @type {{ priority: number, type: string, label: string, detail: string, href?: string }[]} */
  const actions = [];
  let releaseFocus = null;
  let suggestedDaysUntilNext = 10;
  let themeSeed = "Nouveau single — même univers, angle frais";

  if (enriched.length === 0) {
    verdict = "produce";
    summary = "Aucun titre en catalogue : priorité absolue = premier single.";
    themeSeed = `${artist?.profile?.mood || artist?.profile?.genre || "pop"} — premier single signature`;
    actions.push({
      priority: 1,
      type: "produce",
      label: "Créer le premier single",
      detail: "Paroles → MiniMax → jaquette → ONCE.",
    });
    suggestedDaysUntilNext = 0;
  } else if (unisonReady.length > 0) {
    const focus = unisonReady[0];
    verdict = "publish";
    summary = `ISRC prêt sur « ${focus.trackTitle || focus.title} » (${focus.identifiers?.isrc}). Soumets Unison / Release Publishing maintenant.`;
    releaseFocus = {
      id: focus.id,
      releaseId: focus.releaseId,
      title: focus.trackTitle || focus.title,
      reason: focus.publishing?.reason || "Unison prêt",
      dashboardUrl: focus.dashboardUrl,
      isrc: focus.identifiers?.isrc || null,
      upc: focus.identifiers?.upc || null,
    };
    actions.push({
      priority: 1,
      type: "publish_unison",
      label: "Soumettre à Unison",
      detail: focus.publishing?.reason || "Ouvre Release Publishing sur ONCE",
      href: focus.dashboardUrl,
    });
    actions.push({
      priority: 2,
      type: "promote",
      label: "Lancer la vague de posts",
      detail: "Hooks J0 / J+2 / J+5 dès que Unison est soumis.",
    });
    themeSeed = `Suite de « ${focus.trackTitle || focus.title} » — même univers, nouveau hook`;
    suggestedDaysUntilNext = 12;
  } else if (pending.length > 0) {
    const focus = pending[0];
    verdict = "wait";
    summary = `« ${focus.trackTitle || focus.title} » est encore en inspection / livraison. Pas de nouveau single tant qu'un store n'est pas live (ISRC requis pour Unison).`;
    releaseFocus = {
      id: focus.id,
      releaseId: focus.releaseId,
      title: focus.trackTitle || focus.title,
      reason: focus.publishing?.label || "Distribution en cours",
      dashboardUrl: focus.dashboardUrl,
      isrc: focus.identifiers?.isrc || null,
      upc: focus.identifiers?.upc || null,
      publishingStatus: focus.publishing?.status || "locked",
    };
    actions.push({
      priority: 1,
      type: "wait_distribution",
      label: "Attendre la livraison magasin",
      detail: "Surveille Spotify / Apple (souvent 24–72 h). Rafraîchis les stats ONCE.",
      href: focus.dashboardUrl,
    });
    actions.push({
      priority: 2,
      type: "refresh_stats",
      label: "Rafraîchir statut ONCE",
      detail: "Dès qu'un store est live, l'ISRC apparaît et Unison peut être soumis.",
    });
    suggestedDaysUntilNext = 7;
  } else if (failed.length > 0 && live.length === 0) {
    const focus = failed[0];
    verdict = "pivot";
    summary = `Livraison en échec sur « ${focus.trackTitle || focus.title} ». Corrige la release avant d'enchaîner.`;
    releaseFocus = {
      id: focus.id,
      releaseId: focus.releaseId,
      title: focus.trackTitle || focus.title,
      reason: focus.delivery?.error || "Échec distribution",
      dashboardUrl: focus.dashboardUrl,
    };
    actions.push({
      priority: 1,
      type: "fix_release",
      label: "Corriger / resoumettre la release",
      detail: "Ouvre le projet studio ou le dashboard ONCE pour voir l'erreur.",
      href: focus.dashboardUrl,
    });
    suggestedDaysUntilNext = 3;
  } else if (live.length > 0 && totalStreams < 50) {
    const focus = live[0];
    verdict = "promote";
    summary = `Catalogue live mais peu de streams (${totalStreams} / 30 j). Pousse le titre live avant un nouveau single.`;
    releaseFocus = {
      id: focus.id,
      releaseId: focus.releaseId,
      title: focus.trackTitle || focus.title,
      reason: "Besoin de traction",
      dashboardUrl: focus.dashboardUrl,
      isrc: focus.identifiers?.isrc || null,
      upc: focus.identifiers?.upc || null,
    };
    themeSeed = `Suite émotionnelle de « ${focus.trackTitle || focus.title} » — même vibe, hook plus immédiat`;
    if (focus.publishing?.status === "awaiting_isrc") {
      actions.push({
        priority: 1,
        type: "refresh_stats",
        label: "Vérifier l'ISRC",
        detail: "Live mais ISRC encore pending — rafraîchis bientôt.",
      });
    }
    actions.push({
      priority: actions.length + 1,
      type: "promote",
      label: "Diffuser clips / hooks",
      detail: "3 shorts TikTok ancrés sur le refrain, J0 / J+2 / J+5.",
    });
    actions.push({
      priority: actions.length + 1,
      type: "publish_unison",
      label: "Soumettre Unison si ISRC prêt",
      detail: "Release Publishing dès qu'UPC/ISRC ne sont plus Pending.",
      href: focus.dashboardUrl,
    });
    actions.push({
      priority: actions.length + 1,
      type: "produce",
      label: "Préparer le prochain single (brouillon)",
      detail: "Tu peux écrire le thème maintenant ; sort après traction minimale.",
    });
    suggestedDaysUntilNext = 14;
  } else if (live.length > 0) {
    const top =
      [...live].sort((a, b) => b.streamCount - a.streamCount)[0] || live[0];
    verdict = "produce";
    summary = `Traction OK (${totalStreams} streams / 30 j). Enchaîne un single #${enriched.length + 1} dans le même univers.`;
    releaseFocus = {
      id: top.id,
      releaseId: top.releaseId,
      title: top.trackTitle || top.title,
      reason: "Meilleur signal catalogue",
      dashboardUrl: top.dashboardUrl,
      isrc: top.identifiers?.isrc || null,
    };
    themeSeed = `Écho de « ${top.trackTitle || top.title} » — même persona, nouveau conflit émotionnel`;
    actions.push({
      priority: 1,
      type: "produce",
      label: "Lancer le prochain single",
      detail: "Même artiste, thème frais, pipeline paroles → audio → ONCE.",
    });
    actions.push({
      priority: 2,
      type: "promote",
      label: "Garder le titre live en rotation",
      detail: "1 post/semaine tant que le nouveau n'est pas out.",
    });
    suggestedDaysUntilNext = 10;
  } else if (withAudio.length > 0 && submitted.length === 0) {
    const focus = withAudio[0];
    verdict = "pivot";
    summary = "Audio prêt mais pas soumis ONCE. Distribue avant de créer un autre titre.";
    releaseFocus = {
      id: focus.id,
      title: focus.trackTitle || focus.title,
      reason: "Soumission ONCE manquante",
    };
    actions.push({
      priority: 1,
      type: "submit_once",
      label: "Soumettre sur ONCE",
      detail: "Étape Release du studio (crédits + audio + jaquette).",
    });
    suggestedDaysUntilNext = 2;
  } else {
    verdict = "produce";
    summary = "Catalogue amorcé — continue le rythme de sortie.";
    actions.push({
      priority: 1,
      type: "produce",
      label: "Créer le prochain single",
      detail: "Pipeline studio A→Z.",
    });
  }

  const titles = enriched
    .map((r) => r.trackTitle || r.title)
    .filter(Boolean)
    .slice(0, 8);

  const heuristics = {
    verdict,
    summary,
    themeSeed,
    actions,
    releaseFocus,
    cadence: {
      suggestedDaysUntilNext,
      note:
        verdict === "wait"
          ? "Bloqué sur la distribution — pas de cadence forcée."
          : verdict === "publish"
            ? "Priorité Unison aujourd'hui, puis promo."
            : `Cible indicative : prochain single sous ~${suggestedDaysUntilNext} j.`,
    },
    catalogue: {
      total: enriched.length,
      live: live.length,
      pending: pending.length,
      failed: failed.length,
      unisonReady: unisonReady.length,
      titles,
      totalStreams30d: totalStreams,
    },
  };

  heuristics.schedule = buildCareerSchedule(heuristics);
  return heuristics;
}

/**
 * Agenda opportuniste (pas un cron) — guide J0 → Unison → posts → prochain single.
 */
export function buildCareerSchedule(heuristics) {
  const today = new Date().toISOString().slice(0, 10);
  const title = heuristics.releaseFocus?.title || "titre en cours";
  const href = heuristics.releaseFocus?.dashboardUrl || null;
  /** @type {{ date: string, dayOffset: number, type: string, title: string, detail: string, status: string, href?: string }[]} */
  const items = [];

  const push = (dayOffset, type, itemTitle, detail, status = "todo", itemHref = href) => {
    items.push({
      date: addDays(today, dayOffset),
      dayOffset,
      type,
      title: itemTitle,
      detail,
      status,
      ...(itemHref ? { href: itemHref } : {}),
    });
  };

  if (heuristics.verdict === "wait") {
    push(0, "watch", `Surveiller livraison — ${title}`, "Inspection stores ; ISRC pending", "active");
    push(1, "refresh_stats", "Rafraîchir ONCE", "Vérifier Spotify / Apple / ISRC");
    push(3, "publish_unison", "Unison dès ISRC", "Release Publishing si store live", "todo");
    push(3, "promote", "Teaser / hook #1", "Short ancré sur le refrain");
    push(5, "promote", "Hook #2", "Angle différent (visuel / lyric)");
    push(7, "promote", "Hook #3", "CTA écoute Spotify");
    push(
      heuristics.cadence?.suggestedDaysUntilNext || 10,
      "produce",
      "Prochain single",
      heuristics.themeSeed,
      "todo",
      null,
    );
  } else if (heuristics.verdict === "publish") {
    push(0, "publish_unison", `Soumettre Unison — ${title}`, "ISRC prêt", "active");
    push(0, "promote", "Post live #1", "Annonce sortie + lien Spotify");
    push(2, "promote", "Hook #2", "Clip / lyric highlight");
    push(5, "promote", "Hook #3", "Relance communauté");
    push(
      heuristics.cadence?.suggestedDaysUntilNext || 12,
      "produce",
      "Prochain single",
      heuristics.themeSeed,
      "todo",
      null,
    );
  } else if (heuristics.verdict === "promote") {
    push(0, "promote", `Vague promo — ${title}`, "3 hooks sur 5 jours", "active");
    push(0, "promote", "Hook #1", "Refrain / visual signature");
    push(2, "promote", "Hook #2", "Angle émotion / story");
    push(5, "promote", "Hook #3", "CTA playlist / save");
    push(
      heuristics.cadence?.suggestedDaysUntilNext || 14,
      "produce",
      "Prochain single",
      heuristics.themeSeed,
      "todo",
      null,
    );
  } else if (heuristics.verdict === "pivot") {
    push(0, "fix_release", `Corriger — ${title}`, heuristics.summary, "active");
    push(2, "produce", "Reprendre le rythme", heuristics.themeSeed, "todo", null);
  } else {
    push(0, "produce", "Produire le prochain single", heuristics.themeSeed, "active", null);
    push(2, "submit_once", "Soumettre ONCE", "Crédits + jaquette + audio");
    push(5, "promote", "Teaser pré-sortie", "1 short mystère");
  }

  return items;
}
