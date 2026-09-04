const GENRE_MAP = [
  { match: /metal|hard.?rock/i, genre: "Metal", sub_genre: "Hard Rock" },
  { match: /punk|garage/i, genre: "Alternative", sub_genre: "Punk" },
  { match: /jazz/i, genre: "Jazz", sub_genre: "Contemporary Jazz" },
  { match: /blues/i, genre: "Blues", sub_genre: "Contemporary Blues" },
  { match: /funk|disco/i, genre: "R&B/Soul", sub_genre: "Funk" },
  { match: /gospel/i, genre: "Gospel", sub_genre: "Contemporary Gospel" },
  { match: /k-?pop|j-?pop/i, genre: "Pop", sub_genre: "K-Pop" },
  { match: /lo-?fi|chill|synthwave|retrowave/i, genre: "Electronic", sub_genre: "Electronica" },
  { match: /house|techno|edm|festival/i, genre: "Electronic", sub_genre: "Dance" },
  { match: /hyperpop|electro|electron/i, genre: "Electronic", sub_genre: "Electronica" },
  { match: /trap|cloud.?rap|boom.?bap|hip.?hop|drill|rap/i, genre: "Hip Hop/Rap", sub_genre: "Rap" },
  { match: /neo.?soul|quiet.?storm|r&b|rnb|soul/i, genre: "R&B/Soul", sub_genre: "Contemporary R&B" },
  { match: /amapiano|afro.?house|afro/i, genre: "Worldwide", sub_genre: "Afrobeats" },
  { match: /dancehall|reggae/i, genre: "Reggae/Dancehall", sub_genre: "Dancehall" },
  { match: /latin|reggaeton/i, genre: "Latin", sub_genre: "Reggaeton" },
  { match: /country|americana/i, genre: "Country", sub_genre: "Contemporary Country" },
  { match: /folk|acoustique/i, genre: "Folk", sub_genre: "Contemporary Folk" },
  { match: /world|fusion/i, genre: "Worldwide", sub_genre: "Worldbeat" },
  { match: /indie|alternative/i, genre: "Alternative", sub_genre: "Indie Pop" },
  { match: /rock/i, genre: "Rock", sub_genre: "Indie Rock" },
  { match: /chanson|variété|pop/i, genre: "Pop", sub_genre: "French Pop" },
];

export function mapGenre(style = "") {
  for (const item of GENRE_MAP) {
    if (item.match.test(style)) return { genre: item.genre, sub_genre: item.sub_genre };
  }
  return { genre: "Pop", sub_genre: "French Pop" };
}

export function releaseDateISO(daysAhead = 14) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

export function detectExplicit(lyricsText = "") {
  return /\b(fuck|shit|bitch|nigg|pute|encul|pd\b|salaud)/i.test(lyricsText);
}

export function statusHasStores(raw) {
  if (!raw || typeof raw !== "object") return false;
  const stores = raw.storeStatuses || raw.stores || raw.store_statuses || raw.distribution;
  return Array.isArray(stores) && stores.length > 0;
}

/**
 * Extrait UPC / ISRC depuis GET /releases/:id (champs variables selon version API).
 */
export function extractOnceIdentifiers(release = {}) {
  const upcRaw =
    release.upc ||
    release.upc_code ||
    release.barcode ||
    release.ean ||
    release.release?.upc ||
    null;
  const tracks = Array.isArray(release.tracks) ? release.tracks : [];
  const trackIsrcs = tracks.map((t, i) => {
    const isrc =
      t.isrc ||
      t.isrc_code ||
      t.recording_isrc ||
      t.identifiers?.isrc ||
      null;
    return {
      index: i + 1,
      title: t.title || `Piste ${i + 1}`,
      isrc: isrc ? String(isrc) : null,
    };
  });
  const isrc =
    trackIsrcs.find((t) => t.isrc)?.isrc ||
    release.isrc ||
    release.isrc_code ||
    null;

  const upc = upcRaw ? String(upcRaw) : null;
  const isPendingCode = (v) => !v || /pending|assign|n\/?a|null/i.test(String(v));

  return {
    upc,
    isrc,
    tracks: trackIsrcs,
    upcPending: isPendingCode(upc),
    isrcPending: isPendingCode(isrc),
  };
}

/**
 * Unison / Release Publishing : verrouillé tant qu'aucun store live + ISRC.
 */
export function publishingReadiness({ delivery = {}, identifiers = {} } = {}) {
  const statusBlob = `${delivery.spotifyStatus || ""} ${delivery.aggregateStatus || ""}`;
  const live =
    /live|distributed|delivered|success/i.test(statusBlob) || Boolean(delivery.spotifyUrl);
  const pendingDist = /pending|inspect|queued|process/i.test(statusBlob) && !live;
  const hasIsrc = Boolean(identifiers.isrc) && !identifiers.isrcPending;

  if (delivery.error) {
    return {
      status: "error",
      label: "Erreur statut",
      reason: delivery.error,
      canSubmitUnison: false,
    };
  }
  if (pendingDist || (!live && !hasIsrc)) {
    return {
      status: "locked",
      label: "Publishing verrouillé",
      reason: "Attendre livraison magasin + attribution ISRC",
      canSubmitUnison: false,
    };
  }
  if (live && !hasIsrc) {
    return {
      status: "awaiting_isrc",
      label: "Live — ISRC pending",
      reason: "Store live mais ISRC pas encore visible ; réessaie bientôt",
      canSubmitUnison: false,
    };
  }
  if (hasIsrc) {
    return {
      status: "ready",
      label: "Prêt Unison",
      reason: `ISRC ${identifiers.isrc} — ouvre Release Publishing sur ONCE`,
      canSubmitUnison: true,
    };
  }
  return {
    status: "unknown",
    label: "Statut inconnu",
    reason: "Rafraîchis les stats ONCE",
    canSubmitUnison: false,
  };
}

export function unwrapOnceStatus(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  if (raw.storeStatuses || raw.stores || raw.store_statuses || raw.distribution || raw.aggregateStatus) {
    return raw;
  }
  if (raw.data && typeof raw.data === "object") return unwrapOnceStatus(raw.data);
  if (raw.release && typeof raw.release === "object") return unwrapOnceStatus(raw.release);
  if (raw.result && typeof raw.result === "object") return unwrapOnceStatus(raw.result);
  return raw;
}

export function isOnceStoreLive(status = "") {
  return /live|distributed|delivered|success/i.test(String(status || ""));
}

/** Normalize GET /releases/:id/status into a stable shape for the hub. */
export function normalizeOnceDelivery(raw = {}) {
  const src = unwrapOnceStatus(raw);
  const storesRaw =
    src.storeStatuses || src.stores || src.store_statuses || src.distribution || [];
  const stores = (Array.isArray(storesRaw) ? storesRaw : []).map((s) => {
    const name = s.storeName || s.name || s.store || s.distributorName || "Store";
    const status = s.statusText || s.status || s.state || s.deliveryStatus || "—";
    const url = s.urlInStore || s.url || s.storeUrl || s.link || null;
    return { name, status, url, storeId: s.storeId ?? s.id ?? null };
  });
  const spotify = stores.find((s) => /spotify/i.test(s.name));
  const aggregate =
    src.aggregateStatus || src.status || src.aggregate_status || src.state || null;
  return {
    aggregateStatus: typeof aggregate === "string" ? aggregate : aggregate?.status || null,
    pending: Boolean(src.pending),
    fallback: Boolean(src.fallback),
    fallbackReason: src.fallbackReason || src.fallback_reason || null,
    stores,
    spotifyUrl: spotify?.url || null,
    spotifyStatus: spotify?.status || null,
  };
}

/** Normalize get_release_performance / get_performance_summary MCP payloads. */
export function normalizeOncePerformance(perf = {}) {
  const kpis = perf?.kpis || perf?.kpi || {};
  const totalRaw =
    kpis.totalStreams ??
    kpis.streams ??
    perf.totalStreams ??
    perf.streams ??
    null;
  const tracks = Array.isArray(perf?.tracks) ? perf.tracks : [];
  return {
    fromDate: perf.fromDate || kpis.fromDate || null,
    toDate: perf.toDate || kpis.toDate || null,
    totalStreams: totalRaw == null || Number.isNaN(Number(totalRaw)) ? 0 : Number(totalRaw),
    avgDailyStreams: kpis.avgDailyStreams ?? perf.avgDailyStreams ?? null,
    periodChangePct: kpis.periodChangePct ?? perf.periodChangePct ?? null,
    topStore: kpis.topStore || perf.topStore || null,
    topStores: Array.isArray(perf.topStores) ? perf.topStores : [],
    distributors: Array.isArray(perf.distributors) ? perf.distributors : [],
    tracks: tracks.map((t) => ({
      ...t,
      title: t.title || t.trackTitle || t.trackName || t.name || null,
      totalStreams:
        t.totalStreams ??
        t.streams ??
        t.streamsCount ??
        t.streamCount ??
        t.kpis?.totalStreams ??
        null,
    })),
    source: perf.source || "once-mcp",
  };
}
