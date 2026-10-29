// Runtime public configuration for the browser client.
// Only a Supabase publishable/anon key is exposed here; never expose service-role keys.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ configured: false, error: 'Method not allowed' });
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const publishableKey = String(
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || ''
  ).trim();

  if (!/^https:\/\/[a-z0-9.-]+$/i.test(supabaseUrl) || !publishableKey) {
    return res.status(200).json({
      configured: false,
      message: 'База данных ANIWorld ещё не подключена к этому окружению.'
    });
  }

  return res.status(200).json({ configured: true, supabaseUrl, publishableKey });
}
