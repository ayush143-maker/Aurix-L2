const BASE_WEIGHTS = Object.freeze({
  // View count is the strongest single ranking signal among relevant candidates.
  // Type/identity penalties below still stop audio-only, cover and remix uploads
  // from winning merely because they have substantial views.
  views: 35,
  title: 20,
  artist: 15,
  duration: 6,
  official: 8,
  videoType: 16,
});

const TITLE_NOISE = new Set([
  'official', 'music', 'video', 'audio', 'lyrics', 'lyric', 'hd', 'hq', '4k',
  'visualizer', 'visualiser', 'topic', 'youtube', 'yt', 'full', 'song', 'mv',
  'high', 'quality', 'remastered', 'remaster', 'explicit', 'version', 'original',
]);

const AUDIO_ONLY = /\b(official\s+audio|audio\s+only|audio\s+track|official\s+soundtrack|art\s+track)\b/i;
const LYRIC_OR_VISUALIZER = /\b(lyric\s+video|lyrics?|visuali[sz]er|visuali[sz]er\s+video|karaoke)\b/i;
const ORIGINAL_VIDEO = /\b(official\s+(?:music\s+)?video|music\s+video|official\s+mv|video\s+official)\b/i;
const COVER_OR_COPY = /\b(cover|karaoke|reaction|fan\s?made|fanmade|tribute)\b/i;
const ALTERED_AUDIO = /\b(remix|mashup|nightcore|slowed|sped\s?up|speed\s?up|reverb|bass\s?boosted|8d|instrumental)\b/i;
const LIVE_PERFORMANCE = /\b(live|concert|performance|acoustic version|acoustic session)\b/i;
const SHORT_FORM = /\b(shorts?|#shorts)\b/i;

const OFFICIAL_HINTS = [
  'official', 'vevo', 'records', 'recordings', 'sony music', 'universal music', 'entertainment',
  't-series', 'saregama', 'zee music', 'warner records', 'atlantic records', 'republic records',
  'tips official', 'speed records', 'aditya music', 'think music', 'lahari music', 'mrt music',
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
  return normalizeText(value).split(' ').filter((token) => token && !TITLE_NOISE.has(token));
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
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + cost);
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
  if (!Number.isFinite(reference) || !Number.isFinite(candidate) || reference <= 0 || candidate <= 0) return null;
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

function classifyVideo(video) {
  const title = String(video.title || '');
  const channel = String(video.uploaderName || video.uploader || '');
  const sourceFilters = Array.isArray(video.sourceFilters) ? video.sourceFilters : [];

  // Explicit audio uploads must not win simply because the title/artist/duration match.
  if (AUDIO_ONLY.test(title) || /\s-\s*topic$/i.test(channel) || /\bart\s+track\b/i.test(title)) {
    return { score: 0.02, label: 'Audio upload', kind: 'audio', reason: 'Audio/Art Track result, not the original music video.' };
  }
  if (LYRIC_OR_VISUALIZER.test(title)) {
    return { score: 0.12, label: 'Lyrics / visualizer', kind: 'lyrics', reason: 'Lyrics or visualizer result; not the original music video.' };
  }
  if (COVER_OR_COPY.test(title)) {
    return { score: 0.08, label: 'Cover / fan upload', kind: 'cover', reason: 'Cover, karaoke, tribute, or fan-made result.' };
  }
  if (ALTERED_AUDIO.test(title)) {
    return { score: 0.08, label: 'Remix / altered', kind: 'remix', reason: 'Remixed or altered-audio result.' };
  }
  if (LIVE_PERFORMANCE.test(title)) {
    return { score: 0.18, label: 'Live performance', kind: 'live', reason: 'Live/performance version rather than the studio music video.' };
  }
  if (SHORT_FORM.test(title) || video.isShort) {
    return { score: 0.05, label: 'Short-form clip', kind: 'short', reason: 'Short-form clip rather than the full music video.' };
  }
  if (ORIGINAL_VIDEO.test(title)) {
    return { score: 1, label: 'Official music video', kind: 'official-video', reason: 'Title explicitly identifies a music video/official video.' };
  }
  if (/\bvevo\b/i.test(channel)) {
    return { score: 0.92, label: 'Artist / VEVO video', kind: 'vevo-video', reason: 'VEVO channel cue; title has no audio-only marker.' };
  }
  if (sourceFilters.includes('music_videos')) {
    return { score: 0.86, label: 'YT Music video', kind: 'music-video', reason: 'Returned by Piped’s music_videos search.' };
  }
  if (video.uploaderVerified || video.verified || OFFICIAL_HINTS.some((hint) => channel.toLowerCase().includes(hint))) {
    return { score: 0.72, label: 'Likely official video', kind: 'likely-official', reason: 'Official/verified channel cue; confirm the actual video.' };
  }
  return { score: 0.48, label: 'Unclassified video', kind: 'unknown', reason: 'No clear official music-video or audio-only markers.' };
}

function versionPenalty(track, video, classification) {
  const refText = `${track.title || ''} ${track.artist || track.uploaderName || ''}`;
  const candidateText = `${video.title || ''} ${video.uploaderName || ''}`;
  if (classification.kind === 'audio') return { label: 'Audio upload is not the target video', penalty: 38 };
  if (classification.kind === 'lyrics') return { label: 'Lyrics / visualizer is not the original music video', penalty: 25 };
  if (classification.kind === 'cover') return { label: 'Cover / fan upload', penalty: 30 };
  if (classification.kind === 'remix') return { label: 'Remix / altered audio', penalty: 24 };
  if (classification.kind === 'live') return { label: 'Live / performance version', penalty: 19 };
  if (classification.kind === 'short') return { label: 'Short-form clip', penalty: 24 };
  // Don't punish an explicitly labeled reference version if it is itself the intended version.
  if (ALTERED_AUDIO.test(candidateText) && !ALTERED_AUDIO.test(refText)) return { label: 'Remix / altered audio', penalty: 24 };
  return { label: 'No obvious version mismatch', penalty: 0 };
}

function viewCountSimilarity(viewCount, maxViewCount = 0) {
  const views = Number(viewCount);
  if (!Number.isFinite(views) || views <= 0) return null;

  // Log scaling avoids letting a billion-view video overwhelm every other
  // feature simply because raw view counts span several orders of magnitude.
  // Relative-to-results scaling guarantees the highest-view relevant result
  // receives the strongest views signal in this candidate set.
  const referenceMax = Number(maxViewCount) > 0 ? Number(maxViewCount) : 1_000_000_000;
  const logViews = Math.log1p(views);
  const relative = Math.max(0, Math.min(1, logViews / Math.log1p(Math.max(views, referenceMax))));
  const absolute = Math.max(0, Math.min(1, logViews / Math.log1p(1_000_000_000)));
  return Math.round((0.7 * relative + 0.3 * absolute) * 100) / 100;
}

export function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return 'Unknown duration';
  const rounded = Math.round(value);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

/**
 * Rank a YouTube candidate against a YouTube Music reference track.
 * The objective is the original music video, not a second audio-only upload.
 * The score is a heuristic ranking signal, not a probability of audio identity.
 */
export function scoreCandidate(track, video, options = {}) {
  const title = textSimilarity(track.title, video.title);
  const artist = artistSimilarity(track, video);
  const duration = durationSimilarity(track.duration, video.duration);
  const official = officialChannelSignal(video);
  const videoType = classifyVideo(video);
  const views = viewCountSimilarity(video.views, options.maxViews);
  const signals = [
    { key: 'views', value: views, weight: BASE_WEIGHTS.views },
    { key: 'title', value: title, weight: BASE_WEIGHTS.title },
    { key: 'artist', value: artist, weight: BASE_WEIGHTS.artist },
    { key: 'duration', value: duration, weight: BASE_WEIGHTS.duration },
    { key: 'official', value: official, weight: BASE_WEIGHTS.official },
    { key: 'videoType', value: videoType.score, weight: BASE_WEIGHTS.videoType },
  ];
  const available = signals.filter((signal) => signal.value !== null);
  const activeWeight = available.reduce((sum, signal) => sum + signal.weight, 0) || 1;
  const signalScore = available.reduce((sum, signal) => sum + (signal.value * signal.weight), 0) / activeWeight;
  const version = versionPenalty(track, video, videoType);
  let score = Math.round(Math.max(0, Math.min(100, (signalScore * 100) - version.penalty)));
  if (videoType.kind === 'audio') score = Math.min(score, 35);
  if (['lyrics', 'cover', 'remix', 'live', 'short'].includes(videoType.kind)) score = Math.min(score, 55);

  const breakdown = {};
  for (const signal of signals) breakdown[signal.key] = signal.value === null ? null : Math.round(signal.value * 100);
  breakdown.viewsCount = Number(video.views) || 0;
  breakdown.viewsNote = views === null
    ? 'Piped did not provide a usable view count; views were excluded from this score.'
    : 'Log-scaled view count, weighted most heavily among individual match signals.';
  breakdown.videoTypeLabel = videoType.label;
  breakdown.videoTypeReason = videoType.reason;
  breakdown.videoTypeKind = videoType.kind;
  breakdown.versionPenalty = version.penalty;
  breakdown.versionLabel = version.label;
  breakdown.activeSignals = available.map((signal) => signal.key);

  let verdict = 'Low match';
  if (score >= 82) verdict = 'Strong music-video match';
  else if (score >= 62) verdict = 'Possible music-video match';
  return { score, verdict, breakdown };
}

export function rankCandidates(track, candidates = []) {
  const seen = new Set();
  const unique = candidates.filter((candidate) => {
      const key = candidate.videoId || candidate.url || candidate.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const maxViews = unique.reduce((maximum, candidate) => {
    const views = Number(candidate.views);
    return Number.isFinite(views) && views > maximum ? views : maximum;
  }, 0);
  const scored = unique.map((candidate) => ({
    ...candidate,
    match: scoreCandidate(track, candidate, { maxViews }),
  }));

  const rankingTier = (candidate) => {
    const breakdown = candidate.match.breakdown;
    const kind = breakdown.videoTypeKind;
    // These versions must never win just because a copy has an unusually high
    // view count. Their score caps remain in scoreCandidate as a second guard.
    if (['audio', 'lyrics', 'cover', 'remix', 'live', 'short'].includes(kind)) return 0;

    if (['official-video', 'vevo-video', 'music-video', 'likely-official'].includes(kind)) return 2;
    const titleScore = breakdown.title ?? 0;
    const artistScore = breakdown.artist;
    // A strongly matching, otherwise unclassified upload remains a plausible
    // music-video candidate: views can help identify the original MV.
    if (titleScore >= 45 && (artistScore === null || artistScore >= 30)) return 2;
    return 1;
  };

  return scored.sort((a, b) => {
    // Main rule: among relevant, non-copy music-video candidates, show the
    // most-viewed result first. Version penalties/caps and relevance tiers are
    // applied before views, so a viral remix/audio upload cannot win on views.
    const tierDifference = rankingTier(b) - rankingTier(a);
    if (tierDifference) return tierDifference;
    const viewDifference = (Number(b.views) || 0) - (Number(a.views) || 0);
    if (viewDifference) return viewDifference;
    return b.match.score - a.match.score;
  });
}
