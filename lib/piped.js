const DEFAULT_BASE = 'https://pipedapi.kavin.rocks';
const DEFAULT_FALLBACKS = [
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.nosebs.ru',
];

function cleanBase(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getPipedInstances(env = process.env) {
  const primary = cleanBase(env.PIPED_BASE_URL || DEFAULT_BASE) || DEFAULT_BASE;
  const configuredFallbacks = typeof env.PIPED_FALLBACK_URLS === 'string'
    ? env.PIPED_FALLBACK_URLS.split(',').map((item) => cleanBase(item.trim())).filter(Boolean)
    : DEFAULT_FALLBACKS;
  return [...new Set([primary, ...configuredFallbacks.filter((value) => value !== primary)])];
}

function timeoutMs(env = process.env) {
  const supplied = Number.parseInt(env.PIPED_TIMEOUT_MS || '1900', 10);
  if (!Number.isFinite(supplied)) return 1900;
  return Math.max(800, Math.min(3000, supplied));
}

export async function pipedSearch(query, filter, options = {}) {
  const env = options.env || process.env;
  const instances = options.instances || getPipedInstances(env);
  const timeout = options.timeoutMs || timeoutMs(env);
  let lastError = null;

  for (const instance of instances) {
    const endpoint = new URL('/search', instance);
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('filter', filter);

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        lastError = new Error(`Piped returned HTTP ${response.status} for filter=${filter}`);
        continue;
      }
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.items)) {
        lastError = new Error(`Piped returned an unexpected response for filter=${filter}`);
        continue;
      }
      return {
        items: payload.items,
        instance,
        filter,
        query,
        corrected: Boolean(payload.corrected),
        suggestion: payload.suggestion || null,
      };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(abortTimer);
    }
  }

  throw new Error(`Unable to reach configured Piped instances for ${filter}. ${lastError?.message || ''}`.trim());
}

function safeHttpsUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, 'https://www.youtube.com');
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function getVideoId(value = '') {
  if (!value) return null;
  try {
    const parsed = new URL(value, 'https://www.youtube.com');
    const fromQuery = parsed.searchParams.get('v');
    if (fromQuery && /^[A-Za-z0-9_-]{11}$/.test(fromQuery)) return fromQuery;
    const shortMatch = parsed.pathname.match(/\/([A-Za-z0-9_-]{11})(?:\/|$)/);
    if (shortMatch) return shortMatch[1];
  } catch {
    // Try the simple fallback matcher below for partial API URLs.
  }
  const match = String(value).match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/);
  return match?.[1] || null;
}

export function normalizeStream(item, sourceFilter = 'videos') {
  if (!item || typeof item !== 'object') return null;
  if (item.type && !['stream', 'musicSong', 'musicVideo', 'video'].includes(item.type)) return null;

  const rawUrl = item.url || item.videoUrl || '';
  const videoId = getVideoId(rawUrl);
  if (!videoId || !item.title) return null;

  return {
    videoId,
    title: String(item.title),
    uploaderName: String(item.uploaderName || item.uploader || item.artist || ''),
    artist: String(item.artist || item.uploaderName || item.uploader || ''),
    duration: Number(item.duration) || 0,
    thumbnail: safeHttpsUrl(item.thumbnail || item.thumbnailUrl || ''),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    uploadedDate: String(item.uploadedDate || item.uploadDate || ''),
    views: Number(item.views) || 0,
    uploaderVerified: Boolean(item.uploaderVerified || item.verified),
    isShort: Boolean(item.isShort),
    sourceFilters: [sourceFilter],
  };
}

export function mergeStreams(groups = []) {
  const merged = new Map();
  for (const group of groups) {
    const items = Array.isArray(group?.items) ? group.items : [];
    for (const rawItem of items) {
      const stream = normalizeStream(rawItem, group.filter || 'videos');
      if (!stream) continue;
      const existing = merged.get(stream.videoId);
      if (existing) {
        existing.sourceFilters = [...new Set([...existing.sourceFilters, ...stream.sourceFilters])];
        if (!existing.thumbnail && stream.thumbnail) existing.thumbnail = stream.thumbnail;
        if (!existing.uploaderName && stream.uploaderName) existing.uploaderName = stream.uploaderName;
        if (!existing.duration && stream.duration) existing.duration = stream.duration;
        existing.uploaderVerified = existing.uploaderVerified || stream.uploaderVerified;
      } else {
        merged.set(stream.videoId, stream);
      }
    }
  }
  return [...merged.values()];
}
