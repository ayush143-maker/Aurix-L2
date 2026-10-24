Aurix TrackMatch Lab — original music video matching update

Replace these files in the existing repository:
- api/search.js
- lib/scoring.js
- app.js
- tests/scoring.test.js
- tests/api.test.js

Key behavior changes:
- YT Music music_songs results remain the reference-track metadata source.
- Candidate searches are based on the reference track's title + artist.
- Official Audio search query is removed; official music video queries are used instead.
- Scoring explicitly classifies original music videos vs audio-only, lyric/visualizer, cover/remix/live/short-form results.
- Audio-only results are capped at 35/100 so they cannot win on title/artist/duration alone.
- The score breakdown now shows the video-type signal and explanation.

Tests: node --test tests/*.test.js (24 passing in the full project test suite).
The percentage remains a heuristic ranking score; without direct audio fingerprinting, it cannot prove that video audio is bit-for-bit identical to the YT Music recording.

New ranking rule in this update:
- Log-scaled view count is the highest-weight individual signal (35% base weight).
- Among relevant, non-copy music-video candidates, the highest-view result is ordered first; match score breaks view-count ties.
- Audio-only, lyric/visualizer, cover, remix, live and short-form uploads are put in a lower tier and retain hard score caps, so they cannot win merely because they have more views.
- Score breakdown now shows the view-count signal and explains when view counts are missing.
