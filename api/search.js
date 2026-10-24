import { pipedSearch, mergeStreams } from '../lib/piped.js';

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

  // Establish the reference track and a working API host first. Video searches
  // then reuse that host where possible and fail over only when needed.
  let referenceResult = null;
  let referenceError = null;
  try {
    referenceResult = await pipedSearch(query, 'music_songs');
  } catch (error) {
    referenceError = error?.message || 'Reference search failed';
  }

  // Use YouTube Music metadata to enrich the video queries. Searching only a
  // bare title often returns Official Audio uploads; the target here is the
  // original music video for the selected recording.
  const seedGroups = referenceResult ? [{ items: referenceResult.items, filter: 'music_songs' }] : [];
  const seedTrack = mergeStreams(seedGroups)[0] || null;
  const seedTitle = String(seedTrack?.title || query).trim();
  const seedArtist = String(seedTrack?.artist || seedTrack?.uploaderName || '').trim();
  const enrichedQuery = [seedArtist, seedTitle].filter(Boolean).join(' ').trim() || query;

  const variants = [
    { key: 'musicVideos', query: enrichedQuery, filter: 'music_videos', role: 'candidate' },
    { key: 'videosMain', query: enrichedQuery, filter: 'videos', role: 'candidate' },
    { key: 'videosOfficial', query: `${enrichedQuery} official music video`, filter: 'videos', role: 'candidate' },
    { key: 'videosArtist', query: `${seedArtist ? `${seedArtist} ` : ''}${seedTitle} official video`, filter: 'videos', role: 'candidate' },
  ];

  const settled = await Promise.allSettled(
    variants.map((variant) => pipedSearch(variant.query, variant.filter, {
      preferredInstance: referenceResult?.instance,
    })),
  );
  const fulfilled = [];
  const failed = [];

  if (referenceResult) fulfilled.push({ ...referenceResult, key: 'musicSongs', role: 'reference' });
  else failed.push({ key: 'musicSongs', filter: 'music_songs', message: referenceError || 'Reference search failed' });

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
  // Keep the reference list sourced from YT Music song metadata only. YouTube
  // music videos belong in the candidate set, not as substitute audio references.
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
      referenceMode: musicResults ? 'music_songs' : 'none',
      rankingMode: 'original_music_video',
      targetDescription: 'YT Music track metadata is the reference; original music videos are ranked above audio-only, lyric, and visualizer uploads.',
      warnings: [
        ...(referenceTracks.length ? [] : ['Piped returned no YT Music reference tracks for this query.']),
        ...(failed.length ? [`${failed.length} of ${variants.length + 1} search lookups failed; results may be incomplete.`] : []),
      ],
    },
  });
}
