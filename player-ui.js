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

function getOrCreateMainPlayer() {
  let stage = document.getElementById('main-player-stage');
  if (stage) return stage;
  stage = document.createElement('section');
  stage.id = 'main-player-stage';
  stage.className = 'main-player-stage';
  stage.setAttribute('aria-label', 'Selected video player');
  stage.innerHTML = '<div class="main-player-frame"><div class="main-player-placeholder"><span>▶</span><p>Choose a song or video to play it here</p></div></div><div class="main-player-meta"><div><span class="main-player-kicker">NOW PLAYING</span><h3 class="main-player-title">Nothing playing yet</h3></div><a class="main-player-external" target="_blank" rel="noreferrer" hidden>Watch on YouTube ↗</a></div>';
  const hero = document.querySelector('.hero');
  const feedback = document.getElementById('feedback');
  if (resultsRoot && resultsRoot.parentNode) {
    resultsRoot.parentNode.insertBefore(stage, resultsRoot);
  } else if (feedback && feedback.parentNode) {
    feedback.parentNode.insertBefore(stage, feedback.nextSibling);
  } else if (hero) {
    hero.after(stage);
  }
  return stage;
}

function playInMainStage(id, title, externalUrl) {
  if (!id || !/^[a-zA-Z0-9_-]{6,20}$/.test(id)) return;
  const stage = getOrCreateMainPlayer();
  const frameWrap = stage.querySelector('.main-player-frame');
  const titleNode = stage.querySelector('.main-player-title');
  const external = stage.querySelector('.main-player-external');
  const frame = document.createElement('iframe');
  frame.className = 'main-player-iframe';
  frame.title = title || 'YouTube player';
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&playsinline=1&rel=0';
  frameWrap.replaceChildren(frame);
  titleNode.textContent = title || 'Selected video';
  if (externalUrl) {
    external.href = externalUrl;
    external.hidden = false;
  } else {
    external.hidden = true;
  }
  stage.classList.add('is-active');
  stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function makePlayButton(label, id, title, url) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'play-inline';
  button.setAttribute('aria-label', label);
  button.innerHTML = '<span aria-hidden="true">▶</span>';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    playInMainStage(id, title, url);
  });
  return button;
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
      thumb.append(makePlayButton('Play video in large player above', id,
        card.querySelector('.video-title')?.textContent || 'YouTube video', thumb.href));
    });
  }

  if (referenceRoot) {
    const cards = [...referenceRoot.querySelectorAll('.reference-card')];
    cards.forEach((card, index) => {
      card.hidden = index >= MAX_RESULTS;
      if (index >= MAX_RESULTS) return;
      if (card.dataset.audioPlayerReady) return;
      const id = card.dataset.trackId;
      const thumb = card.querySelector('.reference-thumb');
      if (!id || !thumb || !/^[a-zA-Z0-9_-]{6,20}$/.test(id)) return;
      card.dataset.audioPlayerReady = 'true';
      thumb.append(makePlayButton('Play reference track in large player above', id,
        card.querySelector('.reference-title')?.textContent || 'Reference track',
        'https://www.youtube.com/watch?v=' + encodeURIComponent(id)));
    });
  }
}

if (videoRoot) new MutationObserver(addInlinePlayers).observe(videoRoot, { childList: true, subtree: true });
if (referenceRoot) new MutationObserver(addInlinePlayers).observe(referenceRoot, { childList: true, subtree: true });
addInlinePlayers();
