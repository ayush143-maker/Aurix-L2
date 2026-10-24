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

Tests: node --test tests/*.test.js (21 passing in the full project test suite).
The percentage remains a heuristic ranking score; without direct audio fingerprinting, it cannot prove that video audio is bit-for-bit identical to the YT Music recording.
