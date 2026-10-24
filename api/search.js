import { pipedSearch, mergeStreams, getPipedInstances } from '../lib/piped.js';

const SEARCH_CACHE_TTL_MS = 45_000;
const MAX_SEARCH_CACHE_ENTRIES = 30;
const searchCache = new Map();
const SEARCH_CACHE_CONTROL = 'public, max-age=0, s-maxage=45, stale-while-revalidate=120';

function sendJson(res, statusCode, payload, cacheControl = 'no-store') {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', cacheControl);
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET');
    return sendJson(res, 405, { error: 'method_not_allowed', message: 'Use GET /api/search?query=...' });
  }
  const query = String(req.query?.query || req.query?.q || '').trim().replace(/\s+/g, ' ');
  if (query.length < 2) return sendJson(res, 400, { error: 'invalid_query', message: 'Enter at least 2 characters for a song search.' });
  if (query.length > 160) return sendJson(res, 400, { error: 'query_too_long', message: 'Keep the song query under 160 characters.' });

  const cacheKey = query.toLocaleLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    searchCache.delete(cacheKey);
    searchCache.set(cacheKey, cached);
    return sendJson(res, 200, cached.payload, SEARCH_CACHE_CONTROL);
  }
  if (cached) searchCache.delete(cacheKey);

  // Start the reference and candidate lookups together; healthy primary hosts
  // can return all four result groups without a serial setup wait.
  const preferredInstance = getPipedInstances()[0];
  const variants = [
    { key: 'musicVideos', query, filter: 'music_videos', role: 'candidate' },
    { key: 'videosMain', query, filter: 'videos', role: 'candidate' },
    { key: 'videosOfficial', query: `${query} official music video`, filter: 'videos', role: 'candidate' },
  ];
  const settled = await Promise.allSettled([
    pipedSearch(query, 'music_songs', { preferredInstance }),
    ...variants.map((variant) => pipedSearch(variant.query, variant.filter, { preferredInstance })),
  ]);
  const fulfilled = [], failed = [];
  const [referenceSettled, ...candidateSettled] = settled;
  if (referenceSettled.status === 'fulfilled') {
    fulfilled.push({ ...referenceSettled.value, key: 'musicSongs', role: 'reference' });
  } else {
    failed.push({ key: 'musicSongs', filter: 'music_songs', message: referenceSettled.reason?.message || 'Reference search failed' });
  }
  candidateSettled.forEach((result, index) => {
    const variant = variants[index];
    if (result.status === 'fulfilled') fulfilled.push({ ...result.value, key: variant.key, role: variant.role });
    else failed.push({ key: variant.key, filter: variant.filter, message: result.reason?.message || 'Request failed' });
  });

  const musicResults = fulfilled.find((group) => group.key === 'musicSongs');
  const referenceTracks = mergeStreams([musicResults].filter(Boolean)).slice(0, 8);
  const videoGroups = fulfilled.filter((group) => group.role === 'candidate');
  const videoCandidates = mergeStreams(videoGroups);
  if (!fulfilled.length) {
    return sendJson(res, 502, {
      error: 'piped_unavailable',
      message: 'No Piped API instance could be reached from this deployment. The app tried its configured and built-in fallback hosts; their status can change. Check the API diagnostics and retry.',
      details: failed.map(({ key, message }) => ({ key, message })),
    });
  }

  const sources = [...new Set(fulfilled.map((result) => new URL(result.instance).host))];
  const responsePayload = {
    query, provider: 'Piped', referenceTracks, videoCandidates,
    meta: {
      successfulSearches: fulfilled.length, failedSearches: failed.length, sources,
      filters: fulfilled.map(({ key, filter, query: searchQuery, items }) => ({ key, filter, query: searchQuery, resultCount: items.length })),
      referenceMode: musicResults ? 'music_songs' : 'none',
      rankingMode: 'original_music_video',
      targetDescription: 'YT Music track metadata is the reference; original music videos are ranked above audio-only, lyric, and visualizer uploads.',
      warnings: [
        ...(referenceTracks.length ? [] : ['Piped returned no YT Music reference tracks for this query.']),
        ...(failed.length ? [`${failed.length} of ${variants.length + 1} search lookups failed; results may be incomplete.`] : []),
      ],
    },
  };
  searchCache.set(cacheKey, { payload: responsePayload, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
  while (searchCache.size > MAX_SEARCH_CACHE_ENTRIES) searchCache.delete(searchCache.keys().next().value);
  return sendJson(res, 200, responsePayload, SEARCH_CACHE_CONTROL);
}