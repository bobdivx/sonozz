export async function fetchDeezerCharts() {
  const res = await fetch("https://api.deezer.com/chart/0");
  if (!res.ok) throw new Error(`Deezer HTTP ${res.status}`);
  const data = await res.json();

  const tracks = (data.tracks?.data || []).slice(0, 12).map((t) => ({
    title: t.title,
    artist: t.artist?.name,
    preview: t.preview,
    rank: t.position || t.rank,
    link: t.link,
  }));

  const artists = (data.artists?.data || []).slice(0, 8).map((a) => ({
    name: a.name,
    fans: a.nb_fan,
    picture: a.picture_medium,
  }));

  const albums = (data.albums?.data || []).slice(0, 6).map((a) => ({
    title: a.title,
    artist: a.artist?.name,
    cover: a.cover_medium,
  }));

  return { tracks, artists, albums, source: "Deezer Chart" };
}
