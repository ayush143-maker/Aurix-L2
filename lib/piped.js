const DEFAULT_BASE = 'https://pipedapi.kavin.rocks';

// The public Piped network changes over time. Keep several known API hosts as
// fallbacks; these are fallbacks, not a guarantee that every host is online.
const DEFAULT_FALLBACKS = [
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.nosebs.ru',
  'https://pipedapi-libre.kavin.rocks',
  'https://piped-api.privacy.com.de',
  'https://pipedapi.adminforge.de',
  'https://api.piped.yt',
  'https://pipedapi.drgns.space',
  'https://pipedapi.owo.si',
  'https://api.piped.private.coffee',
  'https://pipedapi.darkness.services',
  'https://pipedapi.orangenet.cc',
  'https://piped-api.codespace.cz',
  'https://pipedapi.reallyaweso.me',
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
    : [];

  // Configured hosts are tried first, but do not accidentally remove the
  // built-in recovery hosts just because an environment variable is present.
  return [...new Set([
    primary,
    ...configuredFallbacks,
    ...DEFAULT_FALLBACKS.map(cleanBase).filter(Boolean),
  ])];
}

function timeoutMs(env = process.env) {
  const supplied = Number.parseInt(env.PIPED_TIMEOUT_MS || '2200', 10);
  if (!Number.isFinite(supplied)) return 2200;
  return Math.max(800, Math.min(3000, supplied));
}

async function requestInstance(instance, query, filter, timeout) {
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
      throw new Error(`${new URL(instance).host} returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.items)) {
      throw new Error(`${new URL(instance).host} returned an unexpected search response`);
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
    const reason = error?.name === 'AbortError' ? 'request timed out' : (error?.message || 'request failed');
    throw new Error(`${new URL(instance).host}: ${reason}`);
  } finally {
    clearTimeout(abortTimer);
  }
}

function bestResult(settled) {
  const successes = settled
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  if (!successes.length) return null;
  return successes.sort((a, b) => b.items.length - a.items.length)[0];
}

export async function pipedSearch(query, filter, options = {}) {
  const env = options.env || process.env;
  const allInstances = options.instances || getPipedInstances(env);
  const timeout = options.timeoutMs || timeoutMs(env);
  const preferred = cleanBase(options.preferredInstance || '');
  const instances = [...new Set([
    ...(preferred ? [preferred] : []),
    ...allInstances.map(cleanBase).filter(Boolean),
  ])];
  const emptyResults = [];
  const failures = [];
  const batchSize = 4;

  // When the reference-track lookup has already found a healthy host, try it
  // alone first for the remaining queries. This avoids spamming every public
  // instance during a normal search while retaining automatic failover.
  let startAt = 0;
  if (preferred && instances[0] === preferred) {
    try {
      const result = await requestInstance(preferred, query, filter, timeout);
      if (result.items.length) return result;
      emptyResults.push(result);
      startAt = 1;
    } catch (error) {
      failures.push(error.message);
      startAt = 1;
    }
  }

  // Race small batches instead of serially waiting on every dead host. If a
  // batch has results, use the response with the most candidates in that batch.
  for (let start = startAt; start < instances.length; start += batchSize) {
    const batch = instances.slice(start, start + batchSize);
    const settled = await Promise.allSettled(
      batch.map((instance) => requestInstance(instance, query, filter, timeout)),
    );
    for (const result of settled) {
      if (result.status === 'rejected') failures.push(result.reason?.message || 'request failed');
      else if (!result.value.items.length) emptyResults.push(result.value);
    }
    const best = bestResult(settled);
    if (best?.items.length) return best;
    if (best && best.items.length === 0) emptyResults.push(best);
  }

  // A healthy API returning zero matches is different from all hosts failing.
  if (emptyResults.length) return emptyResults[0];
  const summary = failures.slice(-4).join('; ') || 'no healthy instance responded';
  throw new Error(`Could not reach any of ${instances.length} configured Piped API instances. ${summary}`);
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
