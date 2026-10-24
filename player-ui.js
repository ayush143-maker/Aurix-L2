const videoRoot = document.getElementById('video-results');
const referenceRoot = document.getElementById('reference-tracks');
const resultsRoot = document.getElementById('results-section');
const MAX_RESULTS = 7;

function safeVideoId(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.hostname === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || '';
    if (parsed.hostname.endsWith('youtube.com') || parsed.hostname.endsWith('youtube-nocookie.com')) {
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v') || '';
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live'].includes(parts[0])) return parts[1] || '';
    }
  } catch {}
  return '';
}

function mountPlayer(container, id, title, externalUrl) {
  const frame = document.createElement('iframe');
  frame.className = 'inline-player';
  frame.title = title || 'YouTube player';
  frame.loading = 'lazy';
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&playsinline=1&rel=0';
  container.replaceChildren(frame);
  container.classList.add('is-playing');
  if (externalUrl) {
    const caption = document.createElement('div');
    caption.className = 'player-caption';
    const note = document.createElement('span');
    note.textContent = 'Playing inside TrackMatch';
    const link = document.createElement('a');
    link.href = externalUrl;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = 'Watch on YouTube ↗';
    caption.append(note, link);
    container.parentElement?.append(caption);
  }
}

function addInlinePlayers() {
  if (videoRoot) {
    const cards = [...videoRoot.querySelectorAll('.video-card')];
    cards.forEach((card, index) => {
      card.hidden = index >= MAX_RESULTS;
      if (index >= MAX_RESULTS) return;
      const thumb = card.querySelector('.video-thumbnail');
      if (!thumb || thumb.dataset.playerReady) return;
      const id = safeVideoId(thumb.getAttribute('href') || '');
      if (!id || !/^[a-zA-Z0-9_-]{6,20}$/.test(id)) return;
      thumb.dataset.playerReady = 'true';
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'play-inline';
      play.setAttribute('aria-label', 'Play video inside TrackMatch');
      play.innerHTML = '<span aria-hidden="true">▶</span>';
      play.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        mountPlayer(thumb, id, card.querySelector('.video-title')?.textContent || 'YouTube video', thumb.href);
      });
      thumb.append(play);
    });
  }

  if (referenceRoot) {
    referenceRoot.querySelectorAll('.reference-card').forEach((card) => {
      if (card.dataset.audioPlayerReady) return;
      const id = card.dataset.trackId;
      const thumb = card.querySelector('.reference-thumb');
      if (!id || !thumb || !/^[a-zA-Z0-9_-]{6,20}$/.test(id)) return;
      card.dataset.audioPlayerReady = 'true';
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'play-inline reference-play';
      play.setAttribute('aria-label', 'Play reference track inside TrackMatch');
      play.innerHTML = '<span aria-hidden="true">▶</span>';
      play.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        mountPlayer(thumb, id, card.querySelector('.reference-title')?.textContent || 'Reference track', 'https://www.youtube.com/watch?v=' + encodeURIComponent(id));
      });
      thumb.append(play);
    });
  }
}

if (videoRoot) new MutationObserver(addInlinePlayers).observe(videoRoot, { childList: true, subtree: true });
if (referenceRoot) new MutationObserver(addInlinePlayers).observe(referenceRoot, { childList: true, subtree: true });
if (resultsRoot) new MutationObserver(addInlinePlayers).observe(resultsRoot, { childList: true, subtree: true });
addInlinePlayers();
