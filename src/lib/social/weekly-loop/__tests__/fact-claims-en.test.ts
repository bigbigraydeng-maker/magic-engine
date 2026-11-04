import { describe, expect, it } from 'vitest';
import { extractFactClaims } from '../fact-claims-en';
import type { FactClaim } from '../fact-claims-en';

const of = (text: string, kind: FactClaim['kind']) =>
  extractFactClaims(text).filter((c) => c.kind === kind);

describe('durations', () => {
  it('parses "10 days"', () => {
    const claims = of('10 days', 'duration_days');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'duration_days', days: 10 });
  });

  it('parses "10-day"', () => {
    const claims = of('10-day', 'duration_days');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'duration_days', days: 10 });
  });

  it('parses "27 DAYS"', () => {
    const claims = of('27 DAYS', 'duration_days');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'duration_days', days: 27 });
  });

  it('parses "Ten days"', () => {
    const claims = of('Ten days', 'duration_days');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'duration_days', days: 10 });
  });

  it('parses "Twenty-seven days from the harbour"', () => {
    const claims = of('Twenty-seven days from the harbour', 'duration_days');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'duration_days', days: 27 });
  });

  it('parses "fifteen days"', () => {
    const claims = of('fifteen days', 'duration_days');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'duration_days', days: 15 });
  });

  it('parses "Sixteen days"', () => {
    const claims = of('Sixteen days', 'duration_days');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'duration_days', days: 16 });
  });

  it('parses "twenty seven days"', () => {
    const claims = of('twenty seven days', 'duration_days');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'duration_days', days: 27 });
  });

  it('parses "Thirty days"', () => {
    const claims = of('Thirty days', 'duration_days');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'duration_days', days: 30 });
  });

  it('yields zero duration claims for "7-10 days"', () => {
    expect(of('7-10 days', 'duration_days')).toHaveLength(0);
  });

  it('yields zero duration claims for "Day 1 starts"', () => {
    expect(of('Day 1 starts', 'duration_days')).toHaveLength(0);
  });

  it('returns the matched substring as text', () => {
    const claims = of('Ten days', 'duration_days');
    expect(claims).toHaveLength(1);
    expect(claims[0].text).toBe('Ten days');
  });
});

describe('stars', () => {
  it('parses "5-star"', () => {
    const claims = of('5-star', 'hotel_stars');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'hotel_stars', stars: [5] });
  });

  it('parses "4-5 star"', () => {
    const claims = of('4-5 star', 'hotel_stars');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'hotel_stars', stars: [4, 5] });
  });

  it('parses "4–5 star" with en dash', () => {
    const claims = of('4\u20135 star', 'hotel_stars');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'hotel_stars', stars: [4, 5] });
  });

  it('parses "4-5 STAR HOTELS"', () => {
    const claims = of('4-5 STAR HOTELS', 'hotel_stars');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'hotel_stars', stars: [4, 5] });
  });

  it('parses "a 3 star hotel"', () => {
    const claims = of('a 3 star hotel', 'hotel_stars');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'hotel_stars', stars: [3] });
  });

  it('yields zero star claims for "$5 star"', () => {
    expect(of('$5 star', 'hotel_stars')).toHaveLength(0);
  });
});

describe('money', () => {
  it('parses "NZD $2,450"', () => {
    const claims = of('NZD $2,450', 'money');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      kind: 'money',
      amount: 2450,
      text: 'NZD $2,450',
    });
  });

  it('parses "NZ$10,899"', () => {
    const claims = of('NZ$10,899', 'money');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'money', amount: 10899 });
  });

  it('parses "$1,895"', () => {
    const claims = of('$1,895', 'money');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'money', amount: 1895 });
  });

  it('parses "From NZ$7,349 per person"', () => {
    const claims = of('From NZ$7,349 per person', 'money');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'money', amount: 7349 });
  });

  it('treats "NZ$7,3XX" as a masked price with no money claim', () => {
    const text = 'NZ$7,3XX';
    const masked = of(text, 'masked_price');
    expect(masked).toHaveLength(1);
    expect(of(text, 'money')).toHaveLength(0);
  });
});

describe('dates', () => {
  it('parses "25 March 2027"', () => {
    const claims = of('25 March 2027', 'date');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      kind: 'date',
      iso: '2027-03-25',
      monthDay: '03-25',
    });
  });

  it('parses "8 May 2027"', () => {
    const claims = of('8 May 2027', 'date');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'date', iso: '2027-05-08' });
  });

  it('parses "16 Oct 2027"', () => {
    const claims = of('16 Oct 2027', 'date');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'date', iso: '2027-10-16' });
  });

  it('parses "Departs 8 May and 16 Oct 2027" with shared year', () => {
    const claims = of('Departs 8 May and 16 Oct 2027', 'date');
    expect(claims).toHaveLength(2);
    expect(claims.map((c) => (c.kind === 'date' ? c.iso : null))).toEqual([
      '2027-05-08',
      '2027-10-16',
    ]);
  });

  it('parses "ALSO DEPARTS 16 SEPT 2027"', () => {
    const claims = of('ALSO DEPARTS 16 SEPT 2027', 'date');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'date', iso: '2027-09-16' });
  });

  it('parses "3rd June" without a year', () => {
    const claims = of('3rd June', 'date');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      kind: 'date',
      iso: null,
      monthDay: '06-03',
    });
  });

  it('yields zero date claims for "31 Foo 2027"', () => {
    expect(of('31 Foo 2027', 'date')).toHaveLength(0);
  });
});

describe('cruise', () => {
  it('parses "the 5-star Victoria Yangtze River Cruise"', () => {
    const claims = of('the 5-star Victoria Yangtze River Cruise', 'cruise_name');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'cruise_name', name: 'Victoria' });
  });

  it('yields zero cruise claims for "a Huangpu River night cruise"', () => {
    expect(of('a Huangpu River night cruise', 'cruise_name')).toHaveLength(0);
  });

  it('yields zero cruise claims for "5-STAR YANGTZE CRUISE"', () => {
    expect(of('5-STAR YANGTZE CRUISE', 'cruise_name')).toHaveLength(0);
  });

  it('parses "a Three Gorges cruise"', () => {
    const claims = of('a Three Gorges cruise', 'cruise_name');
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ kind: 'cruise_name', name: 'Gorges' });
  });
});

describe('ordering and robustness', () => {
  it('returns claims in text order for a combined sentence', () => {
    const text = 'Ten days, 5-star hotels, NZ$2,450, 8 May 2027';
    const kinds = extractFactClaims(text).map((c) => c.kind);
    expect(kinds).toEqual(['duration_days', 'hotel_stars', 'money', 'date']);
  });

  it('returns an empty array for an empty string', () => {
    expect(extractFactClaims('')).toEqual([]);
  });
});
