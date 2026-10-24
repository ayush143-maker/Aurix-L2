import test from 'node:test';
import assert from 'node:assert/strict';
import { getVideoId, normalizeStream, mergeStreams, getPipedInstances } from '../lib/piped.js';

test('extracts a YouTube video ID from a relative Piped watch URL', () => {
  assert.equal(getVideoId('/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('normalizes a Piped stream item into a canonical YouTube result', () => {
  const item = normalizeStream({
    type: 'stream',
    title: 'Example song',
    url: '/watch?v=dQw4w9WgXcQ',
    thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    duration: 210,
    uploaderName: 'Example Artist',
    uploaderVerified: true,
  }, 'videos');
  assert.equal(item.videoId, 'dQw4w9WgXcQ');
  assert.equal(item.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(item.duration, 210);
  assert.equal(item.uploaderVerified, true);
});

test('drops non-stream search results and de-duplicates by video ID', () => {
  const normalized = normalizeStream({ type: 'channel', name: 'Not a video', url: '/channel/UC123' }, 'videos');
  assert.equal(normalized, null);
  const merged = mergeStreams([
    { filter: 'videos', items: [{ type: 'stream', title: 'A', url: '/watch?v=dQw4w9WgXcQ', duration: 10 }] },
    { filter: 'music_videos', items: [{ type: 'stream', title: 'A', url: '/watch?v=dQw4w9WgXcQ', duration: 10 }] },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sourceFilters, ['videos', 'music_videos']);
});

test('accepts HTTPS configured instance hosts only', () => {
  const hosts = getPipedInstances({
    PIPED_BASE_URL: 'https://piped.example.test/path',
    PIPED_FALLBACK_URLS: 'http://not-secure.example.test,https://fallback.example.test',
  });
  assert.deepEqual(hosts, ['https://piped.example.test', 'https://fallback.example.test']);
});
