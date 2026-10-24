import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from './thread-store';
import { sanitizeVideos, videoCacheKey } from './topic-videos.service';

describe('message cursor', () => {
  it('round-trips a timestamp and id', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const cursor = encodeCursor('2026-10-22T10:00:00.123Z', id);
    expect(decodeCursor(cursor)).toEqual({ createdAt: '2026-10-22T10:00:00.123Z', id });
  });

  it('rejects anything forged or garbled', () => {
    for (const bad of ['', 'nonsense', Buffer.from("x|'; DROP TABLE x").toString('base64url'), Buffer.from('2026-01-01|not-a-uuid').toString('base64url')]) {
      expect(() => decodeCursor(bad)).toThrow(BadRequestException);
    }
  });
});

describe('sanitizeVideos', () => {
  it('keeps real YouTube ids, drops duplicates and junk, and keeps one video (the best) by default', () => {
    const vids = sanitizeVideos([
      { videoId: 'dQw4w9WgXcQ', title: 'Quadratics', channel: 'Edu', duration: '10:01', thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hq.jpg' },
      { videoId: 'dQw4w9WgXcQ', title: 'dup' },
      { videoId: 'javascript:alert(1)' },
      { videoId: 'short' },
      null,
      ...Array.from({ length: 10 }, (_, i) => ({ videoId: `abcdefghij${i}`, title: `v${i}` })),
    ], 6);
    expect(vids).toHaveLength(6);
    expect(sanitizeVideos([{ videoId: 'dQw4w9WgXcQ' }, { videoId: 'abcdefghij0' }])).toHaveLength(1);
    expect(vids[0]).toEqual({
      videoId: 'dQw4w9WgXcQ', title: 'Quadratics', channel: 'Edu', duration: '10:01',
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hq.jpg',
    });
  });

  it('replaces a thumbnail from any other host', () => {
    const [v] = sanitizeVideos([{ videoId: 'dQw4w9WgXcQ', thumbnailUrl: 'https://evil.example/x.jpg' }]);
    expect(v.thumbnailUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });

  it('copes with a non-array', () => {
    expect(sanitizeVideos(undefined)).toEqual([]);
  });
});

describe('videoCacheKey', () => {
  it('is the same for the same focus in any order or case', () => {
    expect(videoCacheKey('t1', ['Roots', 'discriminant'])).toBe(videoCacheKey('t1', [' DISCRIMINANT', 'roots']));
    expect(videoCacheKey('t1', [])).toBe('best1:t1:/:');
  });

  it('differs by class and board, so each gets its own best video', () => {
    expect(videoCacheKey('t1', [], 'Class 10', 'CBSE')).not.toBe(videoCacheKey('t1', [], 'Class 10', 'ICSE'));
    expect(videoCacheKey('t1', [], 'Class 9', 'CBSE')).not.toBe(videoCacheKey('t1', [], 'Class 10', 'CBSE'));
  });
});
