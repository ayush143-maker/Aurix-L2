import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCandidate, rankCandidates, textSimilarity, formatDuration } from '../lib/scoring.js';

const reference = {
  videoId: 'aaaaaaaaaaa',
  title: 'Kesariya',
  artist: 'Arijit Singh',
  uploaderName: 'Arijit Singh',
  duration: 268,
};

const officialVideo = {
  videoId: 'bbbbbbbbbbb',
  title: 'Kesariya - Brahmastra | Official Video',
  uploaderName: 'Sony Music India',
  uploaderVerified: true,
  duration: 271,
  views: 1000000,
};

const coverVideo = {
  videoId: 'ccccccccccc',
  title: 'Kesariya cover by Rahul',
  uploaderName: 'Rahul Music',
  uploaderVerified: false,
  duration: 268,
  views: 1000,
};

test('text similarity tolerates punctuation and official-video suffixes', () => {
  assert.ok(textSimilarity('Kesariya', 'Kesariya - Official Music Video') > 0.8);
});

test('duration formatting handles missing and normal values', () => {
  assert.equal(formatDuration(268), '4:28');
  assert.equal(formatDuration(0), 'Unknown duration');
});

test('candidate receives a bounded numeric match score and a breakdown', () => {
  const match = scoreCandidate(reference, officialVideo);
  assert.ok(match.score >= 0 && match.score <= 100);
  assert.equal(typeof match.breakdown.title, 'number');
  assert.equal(match.breakdown.versionPenalty, 0);
});

test('cover candidates receive a penalty and rank below a close official match', () => {
  const ranked = rankCandidates(reference, [coverVideo, officialVideo]);
  assert.equal(ranked[0].videoId, officialVideo.videoId);
  assert.equal(ranked[1].match.breakdown.versionPenalty, 30);
});

test('duplicate videos are removed by video ID', () => {
  const ranked = rankCandidates(reference, [officialVideo, { ...officialVideo, sourceFilters: ['music_videos'] }]);
  assert.equal(ranked.length, 1);
});
