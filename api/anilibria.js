// Vercel Serverless Function: proxy for AniLibria API.
// Only fixed upstream endpoints are allowed; arbitrary URLs are never fetched.
const API = 'https://api.anilibria.tv/v3';
module.exports = async function handler(req, res) {
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
    url = `${API}/title/search?search=${encodeURIComponent(q)}&limit=10`;
  } else if (action === 'title') {
    if (id) url = `${API}/title?id=${encodeURIComponent(String(id).slice(0, 100))}`;
    else if (code) url = `${API}/title?code=${encodeURIComponent(String(code).slice(0, 160))}`;
    else return res.status(400).json({ error: 'Missing id or code' });
  } else {
    return res.status(400).json({ error: 'Use action=search or action=title' });
  }
  try {
    const upstream = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'ANIWorld/1.0' } });
    const body = await upstream.text();
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    return res.status(upstream.status).send(body);
  } catch (err) {
    return res.status(502).json({ error: 'Upstream AniLibria API is unreachable', detail: String(err && err.message || err).slice(0, 300) });
  }
};
