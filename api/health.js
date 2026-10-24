export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('allow', 'GET');
    res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
    return;
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify({ ok: true, app: 'aurix-trackmatch-lab', version: '0.1.0' }));
}
