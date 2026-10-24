const videoRoot = document.getElementById('video-results');
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

function addInlinePlayers() {
  if (!videoRoot) return;
  const cards = [...videoRoot.querySelectorAll('.video-card')];
  cards.forEach((card, index) => {
    card.hidden = index >= MAX_RESULTS;
    if (index >= MAX_RESULTS) return;
    const thumb = card.querySelector('.video-thumbnail');
    if (!thumb || thumb.dataset.playerReady) return;
    const id = safeVideoId(thumb.getAttribute('href') || '');
    if (!id || !/^[a-zA-Z0-9_-]{6,20}$/.test(id)) return;
    thumb.dataset.playerReady = 'true';
    thumb.classList.add('inline-play-ready');
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'play-inline';
    play.setAttribute('aria-label', 'Play video inside TrackMatch');
    play.innerHTML = '<span aria-hidden="true">▶</span>';
    play.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const frame = document.createElement('iframe');
      frame.className = 'inline-player';
      frame.title = 'YouTube video player';
      frame.loading = 'lazy';
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&playsinline=1&rel=0';
      thumb.replaceChildren(frame);
      thumb.classList.add('is-playing');
      const existing = card.querySelector('.player-caption');
      if (!existing) {
        const caption = document.createElement('div');
        caption.className = 'player-caption';
        caption.innerHTML = '<span>Playing inside TrackMatch</span><a href="' + thumb.href.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '" target="_blank" rel="noreferrer">Watch on YouTube ↗</a>';
        const info = card.querySelector('.video-info');
        if (info) info.append(caption);
      }
    });
    thumb.append(play);
  });
}

if (videoRoot) {
  new MutationObserver(addInlinePlayers).observe(videoRoot, { childList: true, subtree: true });
  addInlinePlayers();
}
if (resultsRoot) new MutationObserver(addInlinePlayers).observe(resultsRoot, { childList: true, subtree: true });
