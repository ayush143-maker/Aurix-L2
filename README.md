# Aurix TrackMatch Lab

A standalone, deployable prototype for experimenting with matching a YouTube Music song to likely corresponding YouTube videos before integrating the matching engine into Aurix.

**Current version:** `0.1.1` · Static HTML/CSS/JS + Vercel Node.js serverless functions · No frontend framework or npm runtime dependencies.

## What it does

1. The user enters a song name (artist can be included for better results).
2. `/api/search` calls Piped search with `music_songs`, `music_videos`, and `videos` filters.
3. The UI presents YT Music reference candidates. The user picks the intended recording/version.
4. Video candidates are ranked locally against that selected reference. Each result exposes an overall percentage and per-signal breakdown.
5. Results link to the canonical YouTube watch page in a new tab.

This is a **matching research tool**, not a playback/downloader implementation. Its percentage is a deterministic heuristic, not the probability that two videos contain identical audio.

## Repository layout

```text
aurix-trackmatch-lab/
├── api/
│   ├── health.js          # GET /api/health
│   └── search.js          # GET /api/search?query=...
├── lib/
│   ├── piped.js           # Piped API calls, fallback instances, result normalisation
│   └── scoring.js         # Matching weights, penalties, ranking, duration formatting
├── tests/
│   └── scoring.test.js   # Unit tests for scoring and duplicate removal
├── index.html             # Responsive web UI
├── styles.css             # Dark responsive styling
├── app.js                 # Search flow, reference selection, breakdown rendering
├── package.json
├── vercel.json
├── .env.example
└── .gitignore
```

## Scoring model in v0.1

| Signal | Base weight | What it compares |
|---|---:|---|
| Title similarity | 38% | Normalised title tokens and text similarity |
| Artist / channel | 31% | Reference artist against the candidate's uploader and title |
| Duration | 15% | Duration difference against a tolerance band |
| Official-channel hints | 16% | Verified-channel metadata and known official/label naming clues |
| Version mismatch | Penalty | Cover, karaoke, remix, altered audio, live, lyric/visualizer or short-form indicators |

Piped's standard search result shape does not expose an ISRC field in the search item schema, so this prototype cannot safely use ISRC identity matching. The remaining metadata weights (25/20/10/10 from the original 100-point formula after omitting the unavailable 35-point ISRC signal) are renormalised to 38/31/15/16. Other missing score signals are excluded and the available weights are normalised. This makes comparisons possible but less conclusive when metadata is missing.

### Interpreting the percentages

- `82–100`: strong heuristic match
- `62–81`: possible match
- Below `62`: low match

These are display bands chosen for iteration, not empirically validated thresholds. Tune them against a manually labelled test set before production use. A verified uploader or an official-sounding channel name is only a hint, not proof that the upload is the artist's official recording.

## Run locally

Requires Node.js 20 or later. The front-end has no build step.

```bash
npm test
npx vercel dev
```

Open the local URL printed by Vercel. Avoid opening `index.html` directly from the file system, because the app calls `/api/search` and needs the serverless endpoint.

You can also deploy from the Vercel dashboard by importing this repository. The project uses a root `index.html` for the static UI and root-level `api/` functions for the server.

## Vercel deployment

1. Create a new GitHub repository named `aurix-trackmatch-lab` and upload/push the contents of this folder.
2. In Vercel, choose **Add New → Project**, import that repository and deploy. No framework or build command is required.
3. The default Piped host is `https://pipedapi.kavin.rocks`; `lib/piped.js` includes several documented public API fallbacks. The host list is best-effort because community-operated instances can disappear or rate-limit requests.
4. If the default public instance is unavailable, add/update the environment variables below under **Project → Settings → Environment Variables**, then redeploy.

| Variable | Required | Purpose |
|---|---|---|
| `PIPED_BASE_URL` | No | Primary Piped API base URL, e.g. `https://pipedapi.kavin.rocks` |
| `PIPED_FALLBACK_URLS` | No | Comma-separated HTTPS fallback API base URLs |
| `PIPED_TIMEOUT_MS` | No | Per-instance timeout in ms (code clamps to 800–3000) |

Use API **base URLs**, not frontend URLs. Public Piped instances are community operated and may become slow, unavailable or change. The public instance list is maintained upstream; check it before choosing a fallback: <https://github.com/TeamPiped/documentation/blob/main/content/docs/public-instances/index.md>. Do not assume the sample fallback hosts are always healthy.

### Smoke-test endpoints after deploy

```text
https://YOUR-DEPLOYMENT.vercel.app/api/health
https://YOUR-DEPLOYMENT.vercel.app/api/search?query=Kesariya
```

The search endpoint returns JSON with `referenceTracks`, `videoCandidates` and lookup diagnostics in `meta`.

## API design

### `GET /api/search?query=Song%20Artist`

The server first searches `music_songs` to establish the reference-track source. It then searches `music_videos`, broad `videos`, `official video`, and `official audio` candidates. The first healthy Piped instance is reused for follow-up lookups; failed or empty lookups automatically fall back across small batches of additional public instances. This avoids making users configure a new host whenever one default instance goes offline.

Results are de-duplicated by YouTube video ID. The frontend re-scores locally when the user selects a different reference track or changes the result order. This keeps the ranking model portable for later Aurix integration.

### `GET /api/health`

Runs a real Piped search probe and returns whether the Vercel function and a Piped API instance are reachable. This is the first diagnostic endpoint to open when searching fails.

## Testing

```bash
npm test
```

The unit tests cover text similarity, duration formatting, bounded scores, version penalties, ordering, and duplicate removal. They do not require internet access. A real Piped smoke test needs a working network and public instance.

## Current limitations / next iteration

- Piped public instances are community operated and not a guaranteed SLA. The API now tries multiple fallbacks and `/api/health` probes live Piped connectivity, but a total upstream outage can still prevent search results; the UI displays this rather than inventing candidates.
- YT Music search may not return an artist or duration for every item.
- No audio fingerprint comparison, ISRC lookup, video-stream probing or guarantee of identical master/edition is performed.
- Query variants and score weights need evaluation against a labelled collection of songs where the correct video is known.
- The first version limits candidate count and does not fetch subsequent search pages.
- There is no persistent database, analytics or user account system.

## References

- Piped API docs: <https://docs.piped.video/docs/api-documentation/>
- Piped OpenAPI search filter enum and `/search` schema: <https://github.com/TeamPiped/OpenAPI/blob/main/swagger.yaml>
- Piped public instance list: <https://github.com/TeamPiped/documentation/blob/main/content/docs/public-instances/index.md>
- Vercel Functions: <https://vercel.com/docs/functions>
- Vercel project configuration: <https://vercel.com/docs/project-configuration/vercel-json>
