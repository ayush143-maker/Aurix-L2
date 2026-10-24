const BASE_WEIGHTS = Object.freeze({
  title: 38,
  artist: 31,
  duration: 15,
  official: 16,
});

const TITLE_NOISE = new Set([
  'official', 'music', 'video', 'audio', 'lyrics', 'lyric', 'hd', 'hq', '4k',
  'visualizer', 'visualiser', 'topic', 'youtube', 'yt', 'full', 'song', 'mv',
  'high', 'quality', 'remastered', 'remaster', 'explicit', 'version', 'original',
]);

const VERSION_RULES = [
  { label: 'Cover / karaoke / reaction', penalty: 22, regex: /\b(cover|karaoke|reaction|fan\s?made|fanmade)\b/i },
  { label: 'Remix / altered audio', penalty: 16, regex: /\b(remix|mashup|nightcore|slowed|sped\s?up|speed\s?up|reverb|bass\s?boosted|8d|instrumental)\b/i },
  { label: 'Live / performance', penalty: 11, regex: /\b(live|concert|performance|acoustic version)\b/i },
  { label: 'Lyrics / visualizer', penalty: 6, regex: /\b(lyric video|lyrics|visualizer|visualiser)\b/i },
  { label: 'Short-form clip', penalty: 12, regex: /\b(shorts?|#shorts)\b/i },
];

const OFFICIAL_HINTS = [
  'official', 'vevo', 'records', 'recordings', 'sony music', 'universal music', 'entertainment',
  't-series', 'saregama', 'zee music', 'sony music', 'universal music',
  'warner records', 'atlantic records', 'republic records', 'tips official',
  'speed records', 'aditya music', 'think music', 'lahari music', 'mrt music',
];

export function normalizeText(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTokens(value = '') {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token && !TITLE_NOISE.has(token));
}

function tokenSimilarity(a, b) {
  const aTokens = titleTokens(a);
  const bTokens = titleTokens(b);
  if (!aTokens.length || !bTokens.length) return null;

  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  const intersection = [...aSet].filter((token) => bSet.has(token)).length;
  if (!intersection) return 0;

  const union = new Set([...aSet, ...bSet]).size;
  const jaccard = intersection / union;
  const targetCoverage = intersection / aSet.size;
  return Math.min(1, (jaccard * 0.42) + (targetCoverage * 0.58));
}

function editSimilarity(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return null;
  if (left === right) return 1;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const saved = previous[j];
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + cost,
      );
      diagonal = saved;
    }
  }
  return 1 - (previous[right.length] / Math.max(left.length, right.length));
}

export function textSimilarity(a, b) {
  if (!a || !b) return null;
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return null;
  if (left === right) return 1;

  const tokens = tokenSimilarity(left, right);
  const edit = editSimilarity(left, right);
  if (tokens === null) return edit;
  if (edit === null) return tokens;
  return Math.max(0, Math.min(1, Math.max(tokens, (tokens * 0.72) + (edit * 0.28))));
}

function artistSimilarity(track, video) {
  const artist = track.artist || track.uploaderName || track.uploader || '';
  if (!artist.trim()) return null;

  const channel = video.uploaderName || video.uploader || '';
  const byTitle = video.title || '';
  const channelScore = textSimilarity(artist, channel);
  const titleScore = textSimilarity(artist, byTitle);
  const normalizedArtist = normalizeText(artist);
  const normalizedTitle = normalizeText(byTitle);
  const exactInTitle = normalizedArtist && normalizedTitle.includes(normalizedArtist) ? 1 : 0;
  return Math.max(channelScore ?? 0, titleScore ?? 0, exactInTitle);
}

function durationSimilarity(trackDuration, videoDuration) {
  const reference = Number(trackDuration);
  const candidate = Number(videoDuration);
  if (!Number.isFinite(reference) || !Number.isFinite(candidate) || reference <= 0 || candidate <= 0) {
    return null;
  }
  const tolerance = Math.max(18, reference * 0.14);
  return Math.max(0, 1 - (Math.abs(reference - candidate) / tolerance));
}

function officialChannelSignal(video) {
  const channel = String(video.uploaderName || video.uploader || '').toLowerCase();
  const looksOfficial = OFFICIAL_HINTS.some((hint) => channel.includes(hint));
  const verified = video.uploaderVerified === true || video.verified === true;

  if (looksOfficial && verified) return 1;
  if (looksOfficial) return 0.85;
  if (verified) return 0.65;
  if (/\s-\s*topic$/i.test(channel)) return 0.7;
  return 0.2;
}

function versionPenalty(track, video) {
  const refText = `${track.title || ''} ${track.artist || track.uploaderName || ''}`;
  const candidateText = `${video.title || ''} ${video.uploaderName || ''}`;

  // Do not punish a candidate for a version type explicitly present in the selected reference.
  for (const rule of VERSION_RULES) {
    if (rule.regex.test(candidateText) && !rule.regex.test(refText)) {
      return { label: rule.label, penalty: rule.penalty };
    }
  }
  return { label: 'No obvious version mismatch', penalty: 0 };
}

export function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return 'Unknown duration';
  const rounded = Math.round(value);
  const minutes = Math.floor(rounded / 60);
  const remainder = String(rounded % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

/**
 * Score a YouTube candidate against a selected Piped YT Music result.
 * Percent is a deterministic heuristic—not a statistical probability.
 * ISRC is not part of this prototype because Piped search results do not expose it.
 */
export function scoreCandidate(track, video) {
  const title = textSimilarity(track.title, video.title);
  const artist = artistSimilarity(track, video);
  const duration = durationSimilarity(track.duration, video.duration);
  const official = officialChannelSignal(video);

  const signals = [
    { key: 'title', label: 'Title similarity', value: title, weight: BASE_WEIGHTS.title },
    { key: 'artist', label: 'Artist / channel match', value: artist, weight: BASE_WEIGHTS.artist },
    { key: 'duration', label: 'Duration similarity', value: duration, weight: BASE_WEIGHTS.duration },
    { key: 'official', label: 'Official-channel hints', value: official, weight: BASE_WEIGHTS.official },
  ];
  const available = signals.filter((signal) => signal.value !== null);
  const activeWeight = available.reduce((sum, signal) => sum + signal.weight, 0) || 1;
  const signalScore = available.reduce((sum, signal) => sum + (signal.value * signal.weight), 0) / activeWeight;
  const version = versionPenalty(track, video);
  const score = Math.round(Math.max(0, Math.min(100, (signalScore * 100) - version.penalty)));

  const breakdown = {};
  for (const signal of signals) {
    breakdown[signal.key] = signal.value === null ? null : Math.round(signal.value * 100);
  }
  breakdown.versionPenalty = version.penalty;
  breakdown.versionLabel = version.label;
  breakdown.activeSignals = available.map((signal) => signal.key);

  let verdict = 'Low match';
  if (score >= 82) verdict = 'Strong match';
  else if (score >= 62) verdict = 'Possible match';

  return { score, verdict, breakdown };
}

export function rankCandidates(track, candidates = []) {
  const seen = new Set();
  return candidates
    .filter((candidate) => {
      const key = candidate.videoId || candidate.url || candidate.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((candidate) => ({ ...candidate, match: scoreCandidate(track, candidate) }))
    .sort((a, b) => b.match.score - a.match.score);
}
