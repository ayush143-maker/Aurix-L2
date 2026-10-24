import { pipedSearch } from '../lib/piped.js';

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  res.setHeader('access-control-allow-headers', 'Accept, Content-Type');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET');
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
    return;
  }

  const startedAt = Date.now();
  try {
    const result = await pipedSearch('Levitating', 'music_songs');
    res.statusCode = 200;
    res.end(JSON.stringify({
      ok: true,
      app: 'aurix-trackmatch-lab',
      version: '0.1.1',
      piped: {
        reachable: true,
        instance: new URL(result.instance).host,
        sampleResults: result.items.length,
      },
      elapsedMs: Date.now() - startedAt,
    }));
  } catch (error) {
    res.statusCode = 503;
    res.end(JSON.stringify({
      ok: false,
      app: 'aurix-trackmatch-lab',
      version: '0.1.1',
      error: 'piped_unavailable',
      message: 'The Vercel function is running, but no configured Piped API instance answered the test search.',
      details: error?.message || 'Unknown Piped API error',
      elapsedMs: Date.now() - startedAt,
    }));
  }
}
