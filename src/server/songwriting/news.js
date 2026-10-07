/**
 * Actualité récente via flux RSS publics (sans clé API), côté serveur.
 * Cache mémoire 30 min. Filtre les drames (morts, attentats…) pour ne pas
 * exploiter de tragédies dans des chansons.
 */

const FEEDS = {
  fr: [
    { source: "Le Monde", url: "https://www.lemonde.fr/rss/une.xml" },
    { source: "RFI", url: "https://www.rfi.fr/fr/rss" },
    { source: "Google Actualités", url: "https://news.google.com/rss?hl=fr&gl=FR&ceid=FR:fr" },
  ],
  en: [
    { source: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml" },
    { source: "Google News", url: "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en" },
  ],
  es: [{ source: "Google Noticias", url: "https://news.google.com/rss?hl=es&gl=ES&ceid=ES:es" }],
  it: [{ source: "Google News", url: "https://news.google.com/rss?hl=it&gl=IT&ceid=IT:it" }],
  de: [{ source: "Google News", url: "https://news.google.com/rss?hl=de&gl=DE&ceid=DE:de" }],
  pt: [{ source: "Google Notícias", url: "https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419" }],
};

const TTL_MS = 30 * 60 * 1000;
const cache = new Map();

/** Sujets à ne jamais transformer en chanson (victimes réelles, violences). */
const TRAGEDY_RE =
  /(?<![\p{L}\p{N}])(mort|morts|morte|tu[ée]e?s?|d[ée]c[èe]s|d[ée]c[ée]d[ée]|meurtre|assassin\p{L}*|attentat|terroris\p{L}*|viol(?:s|[ée]e?s?|ences?)?|f[ée]minicide|suicide|noy[ée]|crash|victimes?|massacre|otage|bless[ée]s|p[ée]dophil\p{L}*|agression|incendie mortel|guerre|bombard\p{L}*|frappes?|missiles?|g[ée]nocide|famine|traumatism\p{L}*|ex[ée]cution|couloir de la mort|7-octobre|killed|dead|death|dies|died|murder|rape|terror\p{L}*|shooting|hostage|victims?|suicide|massacre|abuse|stabbing|war|airstrikes?|bombing|genocide|famine|execution|death row)(?![\p{L}\p{N}])/iu;

function decodeEntities(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]) : "";
}

/** Parse minimal RSS 2.0 (title / description / pubDate). */
export function parseRssItems(xml, source = "") {
  const items = [];
  const re = /<item[\s>][\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(String(xml || ""))) && items.length < 40) {
    const block = m[0];
    let title = tag(block, "title");
    if (!title) continue;
    // Google News suffixe « - Média »
    const dash = title.lastIndexOf(" - ");
    if (dash > 20) {
      const tail = title.slice(dash + 3);
      if (tail.length <= 40 && tail.split(/\s+/).length <= 5) title = title.slice(0, dash);
    }
    title = title
      .replace(/^(?:\(\d+\)\s*)?(?:en direct|direct|live(?: map| updates)?)\s*[:.,\-–]\s*/i, "")
      .trim();
    items.push({
      title: title.slice(0, 240),
      summary: tag(block, "description").slice(0, 300),
      date: tag(block, "pubDate"),
      source,
    });
  }
  return items;
}

export function isSafeNewsItem(item) {
  const blob = `${item?.title || ""} ${item?.summary || ""}`;
  if (!item?.title) return false;
  if (TRAGEDY_RE.test(blob)) return false;
  if (/^(en direct|direct|live)\b/i.test(item.title) && item.title.length < 30) return false;
  return true;
}

async function fetchFeed(feed, timeoutMs = 4000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(feed.url, {
      signal: ac.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SonozzNews/1.0)" },
    });
    if (!res.ok) return [];
    return parseRssItems(await res.text(), feed.source);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/**
 * Titres d’actu récents et « sûrs » pour une langue.
 * @returns {Promise<{ title: string, summary: string, date: string, source: string }[]>}
 */
export async function fetchNewsHeadlines(lang = "fr", { limit = 12 } = {}) {
  const code = FEEDS[String(lang || "fr").slice(0, 2)] ? String(lang).slice(0, 2) : "fr";
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items.slice(0, limit);
  const lists = await Promise.all(FEEDS[code].map((f) => fetchFeed(f)));
  const seen = new Set();
  const items = [];
  // Entrelace les sources pour la diversité
  for (let i = 0; i < 40; i++) {
    for (const list of lists) {
      const it = list[i];
      if (!it || !isSafeNewsItem(it)) continue;
      const key = it.title.toLowerCase().slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(it);
    }
  }
  if (items.length) cache.set(code, { at: Date.now(), items });
  return items.slice(0, limit);
}
