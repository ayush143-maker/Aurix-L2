import { pipedSearch } from '../lib/piped.js';
import { mergeStreams } from '../lib/piped.js';

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET');
    return sendJson(res, 405, { error: 'method_not_allowed', message: 'Use GET /api/search?query=...' });
  }

  const query = String(req.query?.query || req.query?.q || '').trim();
  if (query.length < 2) {
    return sendJson(res, 400, { error: 'invalid_query', message: 'Enter at least 2 characters to search.' });
  }
  if (query.length > 160) {
    return sendJson(res, 400, { error: 'query_too_long', message: 'Keep the song query under 160 characters.' });
  }

  const variants = [
    { key: 'musicSongs', query, filter: 'music_songs', role: 'reference' },
    { key: 'musicVideos', query, filter: 'music_videos', role: 'candidate' },
    { key: 'videosMain', query, filter: 'videos', role: 'candidate' },
    { key: 'videosOfficial', query: `${query} official video`, filter: 'videos', role: 'candidate' },
    { key: 'videosAudio', query: `${query} official audio`, filter: 'videos', role: 'candidate' },
  ];

  const settled = await Promise.allSettled(
    variants.map((variant) => pipedSearch(variant.query, variant.filter)),
  );
  const fulfilled = [];
  const failed = [];
  settled.forEach((result, index) => {
    const variant = variants[index];
    if (result.status === 'fulfilled') {
      fulfilled.push({ ...result.value, key: variant.key, role: variant.role });
    } else {
      failed.push({ key: variant.key, filter: variant.filter, message: result.reason?.message || 'Request failed' });
    }
  });

  const musicResults = fulfilled.find((group) => group.key === 'musicSongs');
  const musicVideoResults = fulfilled.find((group) => group.key === 'musicVideos');
  const referenceGroups = [musicResults, musicVideoResults].filter(Boolean);
  const referenceTracks = mergeStreams(referenceGroups).slice(0, 8);
  const videoGroups = fulfilled.filter((group) => group.role === 'candidate');
  const videoCandidates = mergeStreams(videoGroups);

  if (!fulfilled.length) {
    return sendJson(res, 502, {
      error: 'piped_unavailable',
      message: 'Piped API instances did not respond. Try again or configure a working instance in Vercel environment variables.',
      details: failed.map(({ key, message }) => ({ key, message })),
    });
  }

  const sources = [...new Set(fulfilled.map((result) => new URL(result.instance).host))];
  return sendJson(res, 200, {
    query,
    provider: 'Piped',
    referenceTracks,
    videoCandidates,
    meta: {
      successfulSearches: fulfilled.length,
      failedSearches: failed.length,
      sources,
      filters: fulfilled.map(({ key, filter, query: searchQuery, items }) => ({ key, filter, query: searchQuery, resultCount: items.length })),
      referenceMode: musicResults ? 'music_songs' : (musicVideoResults ? 'music_videos_fallback' : 'none'),
      warnings: [
        ...(referenceTracks.length ? [] : ['Piped returned no YT Music reference tracks for this query.']),
        ...(failed.length ? [`${failed.length} of ${variants.length} search lookups failed; results may be incomplete.`] : []),
      ],
    },
  });
}
