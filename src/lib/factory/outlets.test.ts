import { describe, expect, it } from 'vitest';

import { REVIEW_OUTLETS, factoryVideoUrl } from './outlets';

describe('REVIEW_OUTLETS', () => {
  it('lists the five outlets in the expected order', () => {
    expect(REVIEW_OUTLETS.map((outlet) => outlet.key)).toEqual([
      'facebook',
      'instagram',
      'tiktok',
      'ads',
      'daily_plan',
    ]);
  });

  it('marks only facebook as connected', () => {
    const connectedKeys = REVIEW_OUTLETS.filter((outlet) => outlet.connected).map(
      (outlet) => outlet.key,
    );

    expect(connectedKeys).toEqual(['facebook']);
  });

  it('starts every unconnected note with 未接通', () => {
    const unconnected = REVIEW_OUTLETS.filter((outlet) => !outlet.connected);

    expect(unconnected.length).toBeGreaterThan(0);
    for (const outlet of unconnected) {
      expect(outlet.note.startsWith('未接通')).toBe(true);
    }
  });
});

describe('factoryVideoUrl', () => {
  const supabaseUrl = 'https://example.supabase.co';

  it('returns an empty string for undefined, null, or empty paths', () => {
    expect(factoryVideoUrl(undefined, supabaseUrl)).toBe('');
    expect(factoryVideoUrl(null, supabaseUrl)).toBe('');
    expect(factoryVideoUrl('', supabaseUrl)).toBe('');
  });

  it('builds the exact public URL', () => {
    expect(factoryVideoUrl('clips/abc.mp4', supabaseUrl)).toBe(
      'https://example.supabase.co/storage/v1/object/public/content-factory/clips/abc.mp4',
    );
  });

  it('appends an encoded download query when a name is given', () => {
    expect(factoryVideoUrl('clips/abc.mp4', supabaseUrl, 'my video.mp4')).toBe(
      'https://example.supabase.co/storage/v1/object/public/content-factory/clips/abc.mp4?download=my%20video.mp4',
    );
  });

  it('does not append a query when no name is given', () => {
    expect(factoryVideoUrl('clips/abc.mp4', supabaseUrl)).not.toContain('?');
  });
});
