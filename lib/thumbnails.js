const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function safeHttpsUrl(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

/**
 * Return resilient thumbnail candidates for a YouTube video.
 * Prefer YouTube's own stable thumbnail host over Piped proxy URLs, which may
 * be offline even when the video search result itself is valid.
 */
export function thumbnailCandidates(videoId, providerThumbnail = '') {
  const candidates = [];
  if (typeof videoId === 'string' && VIDEO_ID_PATTERN.test(videoId)) {
    candidates.push(
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/default.jpg`,
    );
  }

  const providerUrl = safeHttpsUrl(providerThumbnail);
  if (providerUrl) candidates.push(providerUrl);

  return [...new Set(candidates)];
}
