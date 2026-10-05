import { describe, it, expect } from 'vitest';
import {
  normalisePage,
  findQueryOverlap,
  summarisePagePairs,
  type QueryPageRow,
  type OverlapQuery,
} from '../query-overlap';

describe('normalisePage', () => {
  it('strips scheme and host from a full url', () => {
    expect(normalisePage('https://example.com/blog/post')).toBe('/blog/post');
  });

  it('strips a trailing slash', () => {
    expect(normalisePage('https://example.com/blog/post/')).toBe('/blog/post');
  });

  it('keeps the root path as a single slash', () => {
    expect(normalisePage('https://example.com/')).toBe('/');
  });

  it('strips query string and fragment', () => {
    expect(normalisePage('https://example.com/blog/post?utm=1#section')).toBe(
      '/blog/post',
    );
  });

  it('lowercases the path', () => {
    expect(normalisePage('https://example.com/Blog/Post')).toBe('/blog/post');
  });

  it('returns trimmed garbage input unchanged', () => {
    expect(normalisePage('  not a url  ')).toBe('not a url');
  });
});

describe('findQueryOverlap', () => {
  it('drops queries that only have a single page', () => {
    const rows: QueryPageRow[] = [
      { query: 'solo', page: 'https://example.com/a', clicks: 1, impressions: 100, position: 1 },
    ];
    expect(findQueryOverlap(rows)).toEqual([]);
  });

  it('drops pages below minPageImpressions', () => {
    const rows: QueryPageRow[] = [
      { query: 'q', page: 'https://example.com/a', clicks: 1, impressions: 100, position: 1 },
      { query: 'q', page: 'https://example.com/b', clicks: 1, impressions: 2, position: 5 },
    ];
    const result = findQueryOverlap(rows, { minPageImpressions: 3 });
    expect(result).toEqual([]);
  });

  it('merges duplicate pages after normalisation', () => {
    const rows: QueryPageRow[] = [
      { query: 'q', page: 'https://example.com/a', clicks: 1, impressions: 50, position: 2 },
      { query: 'q', page: 'https://example.com/a/', clicks: 2, impressions: 50, position: 4 },
      { query: 'q', page: 'https://example.com/b', clicks: 1, impressions: 30, position: 3 },
    ];
    const result = findQueryOverlap(rows);
    expect(result).toHaveLength(1);
    expect(result[0].pages).toHaveLength(2);
    const pageA = result[0].pages.find((p) => p.page === '/a');
    expect(pageA).toBeDefined();
    expect(pageA?.clicks).toBe(3);
    expect(pageA?.impressions).toBe(100);
  });

  it('computes an impression-weighted average position', () => {
    const rows: QueryPageRow[] = [
      { query: 'q', page: 'https://example.com/a', clicks: 1, impressions: 50, position: 2 },
      { query: 'q', page: 'https://example.com/a/', clicks: 2, impressions: 50, position: 4 },
      { query: 'q', page: 'https://example.com/b', clicks: 1, impressions: 30, position: 3 },
    ];
    const result = findQueryOverlap(rows);
    const pageA = result[0].pages.find((p) => p.page === '/a');
    expect(pageA?.position).toBeCloseTo(3);
  });

  it('keeps the first position when impressions are zero', () => {
    const rows: QueryPageRow[] = [
      { query: 'q', page: 'https://example.com/a', clicks: 0, impressions: 0, position: 7 },
      { query: 'q', page: 'https://example.com/a/', clicks: 0, impressions: 0, position: 9 },
      { query: 'q', page: 'https://example.com/b', clicks: 0, impressions: 0, position: 3 },
    ];
    const result = findQueryOverlap(rows, {
      minPageImpressions: 0,
      minTotalImpressions: 0,
    });
    const pageA = result[0].pages.find((p) => p.page === '/a');
    expect(pageA?.position).toBe(7);
  });

  it('sorts pages by impressions desc and queries by total impressions desc', () => {
    const rows: QueryPageRow[] = [
      { query: 'low', page: 'https://example.com/a', clicks: 1, impressions: 30, position: 1 },
      { query: 'low', page: 'https://example.com/b', clicks: 1, impressions: 30, position: 1 },
      { query: 'high', page: 'https://example.com/c', clicks: 1, impressions: 100, position: 1 },
      { query: 'high', page: 'https://example.com/d', clicks: 1, impressions: 50, position: 1 },
    ];
    const result = findQueryOverlap(rows);
    expect(result.map((r) => r.query)).toEqual(['high', 'low']);
    expect(result[0].pages.map((p) => p.page)).toEqual(['/c', '/d']);
  });

  it('caps the number of queries with maxQueries', () => {
    const rows: QueryPageRow[] = [];
    for (let i = 0; i < 5; i += 1) {
      rows.push({
        query: `q${i}`,
        page: `https://example.com/a${i}`,
        clicks: 1,
        impressions: 100 - i,
        position: 1,
      });
      rows.push({
        query: `q${i}`,
        page: `https://example.com/b${i}`,
        clicks: 1,
        impressions: 50,
        position: 1,
      });
    }
    const result = findQueryOverlap(rows, { maxQueries: 2 });
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.query)).toEqual(['q0', 'q1']);
  });

  it('treats queries case-insensitively', () => {
    const rows: QueryPageRow[] = [
      { query: 'Hello', page: 'https://example.com/a', clicks: 1, impressions: 50, position: 1 },
      { query: 'hello', page: 'https://example.com/b', clicks: 1, impressions: 50, position: 1 },
    ];
    const result = findQueryOverlap(rows);
    expect(result).toHaveLength(1);
    expect(result[0].query).toBe('hello');
    expect(result[0].pages).toHaveLength(2);
  });
});

describe('summarisePagePairs', () => {
  it('orders the pair alphabetically', () => {
    const overlaps: OverlapQuery[] = [
      {
        query: 'q',
        total_clicks: 1,
        total_impressions: 100,
        pages: [
          { page: '/z', clicks: 1, impressions: 60, position: 1 },
          { page: '/a', clicks: 1, impressions: 40, position: 1 },
        ],
      },
    ];
    const pairs = summarisePagePairs(overlaps);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].page_a).toBe('/a');
    expect(pairs[0].page_b).toBe('/z');
  });

  it('aggregates shared queries and impressions across overlaps', () => {
    const overlaps: OverlapQuery[] = [
      {
        query: 'q1',
        total_clicks: 1,
        total_impressions: 100,
        pages: [
          { page: '/a', clicks: 1, impressions: 60, position: 1 },
          { page: '/b', clicks: 1, impressions: 40, position: 1 },
        ],
      },
      {
        query: 'q2',
        total_clicks: 1,
        total_impressions: 50,
        pages: [
          { page: '/b', clicks: 1, impressions: 30, position: 1 },
          { page: '/a', clicks: 1, impressions: 20, position: 1 },
        ],
      },
    ];
    const pairs = summarisePagePairs(overlaps);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].shared_queries).toBe(2);
    expect(pairs[0].shared_impressions).toBe(150);
  });

  it('sorts by shared impressions desc and respects the limit', () => {
    const overlaps: OverlapQuery[] = [
      {
        query: 'q1',
        total_clicks: 1,
        total_impressions: 10,
        pages: [
          { page: '/a', clicks: 1, impressions: 6, position: 1 },
          { page: '/b', clicks: 1, impressions: 4, position: 1 },
        ],
      },
      {
        query: 'q2',
        total_clicks: 1,
        total_impressions: 200,
        pages: [
          { page: '/c', clicks: 1, impressions: 120, position: 1 },
          { page: '/d', clicks: 1, impressions: 80, position: 1 },
        ],
      },
    ];
    const pairs = summarisePagePairs(overlaps, 1);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].page_a).toBe('/c');
    expect(pairs[0].page_b).toBe('/d');
  });
});
