// Vercel Serverless Function: proxy for the public AniLiberty API v1.
const API = 'https://aniliberty.top/api/v1';

function normalizeRelease(release) {
  if (!release || typeof release !== 'object' || Array.isArray(release)) return release;

  const apiName = release.name;
  const names = release.names && typeof release.names === 'object' ? release.names : {};
  const localizedName = apiName && typeof apiName === 'object' ? apiName : {};
  const russianName =
    names.ru ||
    names.main ||
    localizedName.main ||
    (typeof apiName === 'string' ? apiName : '');
  const englishName = names.en || names.english || localizedName.english || '';
  const episodes = Array.isArray(release.episodes) ? release.episodes : [];

  const playerList = episodes.map((episode) => ({
    ...episode,
    episode: episode.ordinal ?? episode.episode ?? episode.id,
    hls: {
      fhd: episode.hls_1080 || episode.hls?.fhd,
      hd: episode.hls_720 || episode.hls?.hd,
      sd: episode.hls_480 || episode.hls?.sd,
    },
  }));

  return {
    ...release,
    names: {
      ...names,
      ru: russianName,
      main: names.main || localizedName.main || russianName,
      en: englishName,
    },
    code: release.code || release.alias,
    ...(episodes.length > 0 ? { player: release.player || { list: playerList } } : {}),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { action, query, id, code } = req.query || {};
  let url;

  if (action === 'search') {
    const q = String(query || '').trim().slice(0, 160);
    if (!q) return res.status(400).json({ error: 'Missing query' });
    url = `${API}/app/search/releases?query=${encodeURIComponent(q)}`;
  } else if (action === 'title') {
    const releaseId = String(id || code || '').trim().slice(0, 160);
    if (!releaseId) return res.status(400).json({ error: 'Missing id or code' });
    url = `${API}/anime/releases/${encodeURIComponent(releaseId)}`;
  } else {
    return res.status(400).json({ error: 'Use action=search or action=title' });
  }

  try {
    const upstream = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'ANIWorld/1.0' },
    });
    const body = await upstream.text();

    if (upstream.ok) {
      try {
        const data = JSON.parse(body);
        const normalized = action === 'search' && Array.isArray(data)
          ? data.map(normalizeRelease)
          : normalizeRelease(data);
        return res.status(upstream.status).json(normalized);
      } catch (_) {
        // Preserve a successful non-JSON upstream body as-is.
      }
    }

    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    );
    return res.status(upstream.status).send(body);
  } catch (err) {
    return res.status(502).json({
      error: 'Upstream AniLiberty API is unreachable',
      detail: String(err && err.message || err).slice(0, 300),
    });
  }
};
