import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYoutubeUrl, isValidYoutubeUrl } from '../src/lib/youtube.js';

test('accepte les formes watch, youtu.be et shorts', () => {
  const cases = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ'],
    ['http://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=10', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ', 'dQw4w9WgXcQ'],
  ];
  for (const [input, expected] of cases) {
    const parsed = parseYoutubeUrl(input);
    assert.ok(parsed, `devrait accepter ${input}`);
    assert.equal(parsed.id, expected);
    assert.equal(parsed.url, `https://www.youtube.com/watch?v=${expected}`);
  }
});

test('rejette tout le reste', () => {
  const rejected = [
    '',
    '   ',
    'pas une url',
    'https://vimeo.com/123456',
    'https://evil.com/youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQextra',
    'https://www.youtube.com/playlist?list=PL1234567890',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://www.youtube.com/',
    'https://youtu.be/',
    null,
    undefined,
    42,
  ];
  for (const input of rejected) {
    assert.equal(parseYoutubeUrl(input), null, `devrait rejeter ${String(input)}`);
    assert.equal(isValidYoutubeUrl(input), false);
  }
});
