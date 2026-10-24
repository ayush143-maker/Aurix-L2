import { rankCandidates, formatDuration } from './lib/scoring.js';
import { thumbnailCandidates } from './lib/thumbnails.js';

const byId = (id) => document.getElementById(id);
const form = byId('search-form');
const queryInput = byId('song-query');
const searchButton = byId('search-button');
const feedback = byId('feedback');
const resultsSection = byId('results-section');
const loadingState = byId('loading-state');
const loadingTitle = byId('loading-title');
const loadingCopy = byId('loading-copy');
const referenceContainer = byId('reference-tracks');
const videoContainer = byId('video-results');
const emptyVideos = byId('empty-videos');
const searchStats = byId('search-stats');
const sortSelect = byId('sort-select');
const formulaToggle = byId('formula-toggle');
const formulaDetail = byId('formula-detail');

let searchData = null;
let selectedTrackId = null;
let currentQuery = '';

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function thumbnailMarkup(item, glyph) {
  const candidates = thumbnailCandidates(item.videoId, item.thumbnail);
  if (!candidates.length) {
    return `<div class="reference-thumb-fallback" aria-hidden="true">${glyph}</div>`;
  }
  return `<img src="${escapeHtml(candidates[0])}" alt="" loading="lazy" decoding="async" data-fallbacks="${escapeHtml(JSON.stringify(candidates.slice(1)))}" data-fallback-glyph="${escapeHtml(glyph)}">`;
}

function bindThumbnailFallbacks(container) {
  container.querySelectorAll('img[data-fallbacks]').forEach((img) => {
    img.addEventListener('error', () => {
      let candidates = [];
      try {
        candidates = JSON.parse(img.dataset.fallbacks || '[]');
      } catch {
        candidates = [];
      }

      const next = candidates.shift();
      img.dataset.fallbacks = JSON.stringify(candidates);
      if (next) {
        img.src = next;
        return;
      }

      // Broken-image icons look like broken UI. Show a deliberate placeholder
      // only after every thumbnail source has failed.
      const placeholder = document.createElement('div');
      placeholder.className = 'reference-thumb-fallback';
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.textContent = img.dataset.fallbackGlyph || '▶';
      img.replaceWith(placeholder);
    });
  });
}

function showFeedback(message, type = 'warning') {
  feedback.className = `feedback ${type}`;
  feedback.textContent = message;
}

function hideFeedback() {
  feedback.className = 'feedback hidden';
  feedback.textContent = '';
}

function setLoading(isLoading) {
  searchButton.disabled = isLoading;
  searchButton.querySelector('.button-label').textContent = isLoading ? 'Searching…' : 'Find matches';
  loadingState.classList.toggle('hidden', !isLoading);
  if (isLoading) {
    resultsSection.classList.add('hidden');
    hideFeedback();
  }
}

function getSelectedTrack() {
  return searchData?.referenceTracks?.find((track) => track.videoId === selectedTrackId)
    || searchData?.referenceTracks?.[0]
    || null;
}

function renderStats() {
  const meta = searchData?.meta || {};
  searchStats.innerHTML = `
    <span class="stat-chip"><strong>${searchData.referenceTracks.length}</strong> references</span>
    <span class="stat-chip"><strong>${searchData.videoCandidates.length}</strong> videos</span>
    <span class="stat-chip"><strong>${meta.successfulSearches || 0}/5</strong> lookups</span>
  `;
}

function renderReferenceTracks() {
  const tracks = searchData?.referenceTracks || [];
  const selected = getSelectedTrack();
  selectedTrackId = selected?.videoId || null;

  if (!tracks.length) {
    referenceContainer.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;padding:26px 16px;text-align:left">
        <strong>No YT Music reference track found</strong>
        <p>Video candidates are still scored against the search text. Try adding the artist name for a better reference match.</p>
      </div>`;
    return;
  }

  referenceContainer.innerHTML = tracks.map((track, index) => {
    const isSelected = track.videoId === selectedTrackId;
    return `
      <button class="reference-card ${isSelected ? 'selected' : ''}" type="button" data-track-id="${escapeHtml(track.videoId)}" aria-pressed="${isSelected}" title="Use this as the reference track">
        <div class="reference-thumb">
          ${thumbnailMarkup(track, '♫')}
          <span class="selected-check" aria-hidden="true">✓</span>
        </div>
        <div class="reference-info">
          <div class="reference-title">${escapeHtml(track.title)}</div>
          <div class="reference-artist">${escapeHtml(track.artist || track.uploaderName || 'Artist not provided')}</div>
          <div class="reference-duration">${escapeHtml(formatDuration(track.duration))} <span>·</span> ${index === 0 ? 'Top result' : 'Alternate reference'}</div>
        </div>
      </button>`;
  }).join('');
  bindThumbnailFallbacks(referenceContainer);

  referenceContainer.querySelectorAll('[data-track-id]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedTrackId = button.dataset.trackId;
      renderReferenceTracks();
      renderVideoResults();
    });
  });
}

function scoreBreakdownMarkup(video) {
  const breakdown = video.match.breakdown;
  const entries = [
    ['title', 'Title similarity'],
    ['artist', 'Artist / channel'],
    ['duration', 'Duration'],
    ['official', 'Official-channel hints'],
    ['videoType', 'Music-video type'],
  ];
  const rows = entries.map(([key, label]) => {
    const score = breakdown[key];
    const shown = score === null ? 'N/A' : `${score}%`;
    const width = score === null ? 0 : score;
    const note = key === 'official'
      ? 'Verified/official-name hints; not proof of ownership.'
      : key === 'duration'
        ? 'Closeness to reference duration.'
        : key === 'artist'
          ? 'Reference artist vs. uploader/title.'
          : key === 'videoType'
            ? (breakdown.videoTypeReason || 'Whether this looks like the original music video rather than an audio upload.')
            : 'Normalized song-title overlap.';
    return `<div class="breakdown-item"><div class="breakdown-top"><span>${label}</span><strong>${shown}</strong></div><div class="breakdown-track"><span style="width:${width}%"></span></div><div class="breakdown-note">${note}</div></div>`;
  }).join('');
  const penalty = breakdown.versionPenalty > 0
    ? `<div class="penalty-note">−${breakdown.versionPenalty} points: ${escapeHtml(breakdown.versionLabel)}</div>`
    : `<div class="breakdown-note" style="margin-top:11px">No obvious version mismatch detected.</div>`;
  return `${rows}${penalty}<div class="breakdown-note" style="margin-top:10px">ISRC identity: not available in Piped search metadata; omitted from this score.</div>`;
}

function orderedVideos(track) {
  const ranked = rankCandidates(track, searchData.videoCandidates || []);
  const mode = sortSelect.value;
  if (mode === 'duration') {
    ranked.sort((a, b) => {
      const ref = Number(track.duration) || 0;
      const aGap = ref && a.duration ? Math.abs(ref - a.duration) : Number.MAX_SAFE_INTEGER;
      const bGap = ref && b.duration ? Math.abs(ref - b.duration) : Number.MAX_SAFE_INTEGER;
      return aGap - bGap || b.match.score - a.match.score;
    });
  } else if (mode === 'views') {
    ranked.sort((a, b) => (b.views || 0) - (a.views || 0));
  }
  return ranked;
}

function renderVideoResults() {
  if (!searchData) return;
  const track = getSelectedTrack() || {
    title: currentQuery,
    artist: '',
    duration: 0,
  };
  const ranked = orderedVideos(track);
  emptyVideos.classList.toggle('hidden', ranked.length > 0);
  videoContainer.innerHTML = ranked.map((video, index) => {
    const score = video.match.score;
    const official = video.uploaderVerified ? '<span class="micro-tag verified">✓ Verified channel</span>' : '';
    const typeLabel = video.match.breakdown.videoTypeLabel || 'Unclassified video';
    const typeTag = `<span class="micro-tag">${escapeHtml(typeLabel)}</span>`;
    const sources = (video.sourceFilters || []).map((source) => source === 'music_videos' ? 'YT Music video search' : source === 'videos' ? 'YouTube video search' : source).slice(0, 2);
    const sourceTags = sources.map((source) => `<span class="micro-tag">${escapeHtml(source)}</span>`).join('');
    const artist = video.uploaderName || 'Uploader not provided';
    const viewText = video.views ? `${Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(video.views)} views` : 'Views unavailable';
    return `
      <article class="video-card ${index === 0 && sortSelect.value === 'score' ? 'is-top' : ''}">
        <a class="video-thumbnail" href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(video.title)} on YouTube">
          ${thumbnailMarkup(video, '▶')}
          <span class="rank-tag">#${index + 1}</span><span class="video-duration">${escapeHtml(formatDuration(video.duration))}</span>
        </a>
        <div class="video-info">
          <div class="video-kicker">${typeTag}${sourceTags}${official}</div>
          <h3 class="video-title">${escapeHtml(video.title)}</h3>
          <div class="video-meta">${escapeHtml(artist)}<br>${escapeHtml(viewText)}${video.uploadedDate ? ` · ${escapeHtml(video.uploadedDate)}` : ''}</div>
        </div>
        <div class="video-actions">
          <div class="score-block"><span class="score-number">${score}<small style="font-size:13px;letter-spacing:0">%</small></span><span class="score-label">HEURISTIC MATCH</span><div class="score-bar"><span style="width:${score}%"></span></div><div class="match-verdict">${escapeHtml(video.match.verdict)}</div></div>
          <a class="open-video" href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer">Open video <span aria-hidden="true">↗</span></a>
        </div>
        <details class="score-details"><summary>Inspect score breakdown</summary><div class="breakdown-grid">${scoreBreakdownMarkup(video)}</div></details>
      </article>`;
  }).join('');
  bindThumbnailFallbacks(videoContainer);
}

function renderAll() {
  renderStats();
  renderReferenceTracks();
  renderVideoResults();
}

async function performSearch(query) {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) {
    showFeedback('Enter at least 2 characters for a song search.', 'error');
    return;
  }

  currentQuery = normalizedQuery;
  searchData = null;
  selectedTrackId = null;
  setLoading(true);
  loadingTitle.textContent = 'Searching Piped instances';
  loadingCopy.textContent = 'Finding YT Music references and collecting video candidates…';

  try {
    const response = await fetch(`/api/search?query=${encodeURIComponent(normalizedQuery)}`, {
      headers: { accept: 'application/json' },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `Search failed (${response.status}).`);

    searchData = {
      ...payload,
      referenceTracks: Array.isArray(payload.referenceTracks) ? payload.referenceTracks : [],
      videoCandidates: Array.isArray(payload.videoCandidates) ? payload.videoCandidates : [],
    };
    selectedTrackId = searchData.referenceTracks[0]?.videoId || null;
    resultsSection.classList.remove('hidden');
    renderAll();
    if (searchData.meta?.warnings?.length) {
      showFeedback(searchData.meta.warnings.join(' '), 'warning');
    } else {
      showFeedback(`Search complete for “${normalizedQuery}”. Select a reference track to re-rank the candidates.`, 'success');
    }
    if (!searchData.referenceTracks.length) {
      showFeedback('Piped returned video candidates but no YT Music song reference. The list is ranked against the search text only; try adding the artist name.', 'warning');
    }
  } catch (error) {
    resultsSection.classList.add('hidden');
    showFeedback(`${error.message || 'Something went wrong.'} The backend tries several Piped instances automatically. Open /api/health on this deployment to see whether Piped is reachable.`, 'error');
  } finally {
    setLoading(false);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  performSearch(queryInput.value);
});

document.querySelectorAll('[data-query]').forEach((button) => {
  button.addEventListener('click', () => {
    queryInput.value = button.dataset.query;
    performSearch(button.dataset.query);
  });
});

sortSelect.addEventListener('change', renderVideoResults);

formulaToggle.addEventListener('click', () => {
  const isOpen = formulaToggle.getAttribute('aria-expanded') === 'true';
  formulaToggle.setAttribute('aria-expanded', String(!isOpen));
  formulaDetail.classList.toggle('hidden', isOpen);
  formulaToggle.innerHTML = `How it works <span aria-hidden="true">${isOpen ? '＋' : '−'}</span>`;
});
