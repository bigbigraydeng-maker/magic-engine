import { describe, it, expect } from 'vitest';

import {
  isValidIsoDate,
  formatDepartureDisplay,
  daysBetween,
  todayIso,
  parseDepartureDisplay,
} from '../dates';

describe('isValidIsoDate', () => {
  it('accepts real calendar dates in strict YYYY-MM-DD form', () => {
    expect(isValidIsoDate('2027-05-13')).toBe(true);
    expect(isValidIsoDate('2027-03-01')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
  });

  it('rejects impossible calendar dates', () => {
    expect(isValidIsoDate('2027-02-30')).toBe(false);
    expect(isValidIsoDate('2027-13-01')).toBe(false);
    expect(isValidIsoDate('2027-02-29')).toBe(false);
    expect(isValidIsoDate('2027-04-31')).toBe(false);
  });

  it('rejects malformed strings', () => {
    expect(isValidIsoDate('')).toBe(false);
    expect(isValidIsoDate('13/05/2027')).toBe(false);
    expect(isValidIsoDate('2027-5-3')).toBe(false);
    expect(isValidIsoDate(' 2027-05-13')).toBe(false);
    expect(isValidIsoDate('2027-05-13 ')).toBe(false);
    expect(isValidIsoDate('2027-05-13T00:00:00Z')).toBe(false);
  });
});

describe('formatDepartureDisplay', () => {
  it('formats a valid ISO date as "D Month YYYY"', () => {
    expect(formatDepartureDisplay('2027-05-13')).toBe('13 May 2027');
    expect(formatDepartureDisplay('2027-03-01')).toBe('1 March 2027');
  });

  it('does not zero-pad the day', () => {
    expect(formatDepartureDisplay('2027-01-09')).toBe('9 January 2027');
  });

  it('throws on invalid input', () => {
    expect(() => formatDepartureDisplay('2027-02-30')).toThrow(
      'invalid ISO date: 2027-02-30',
    );
    expect(() => formatDepartureDisplay('')).toThrow('invalid ISO date: ');
  });
});

describe('daysBetween', () => {
  it('returns the absolute whole number of calendar days', () => {
    expect(daysBetween('2027-05-13', '2027-05-31')).toBe(18);
    expect(daysBetween('2027-05-31', '2027-05-13')).toBe(18);
  });

  it('returns 0 for the same date', () => {
    expect(daysBetween('2027-05-13', '2027-05-13')).toBe(0);
  });

  it('handles month-end and leap-year boundaries', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1);
  });

  it('throws on invalid input', () => {
    expect(() => daysBetween('2027-02-30', '2027-05-13')).toThrow(
      'invalid ISO date: 2027-02-30',
    );
    expect(() => daysBetween('2027-05-13', 'nope')).toThrow(
      'invalid ISO date: nope',
    );
  });
});

describe('todayIso', () => {
  it('returns the calendar date in Pacific/Auckland by default', () => {
    const now = new Date('2027-05-12T13:00:00Z');
    expect(todayIso(now)).toBe('2027-05-13');
  });

  it('resolves the day boundary differently across time zones', () => {
    const now = new Date('2027-05-12T13:00:00Z');
    expect(todayIso(now, 'Pacific/Auckland')).toBe('2027-05-13');
    expect(todayIso(now, 'America/Los_Angeles')).toBe('2027-05-12');
  });

  it('handles a UTC instant just before the Auckland day boundary', () => {
    const now = new Date('2027-05-12T11:59:00Z');
    expect(todayIso(now, 'Pacific/Auckland')).toBe('2027-05-12');
    expect(todayIso(now, 'UTC')).toBe('2027-05-12');
  });
});

describe('parseDepartureDisplay', () => {
  it('round-trips the display format used by the website', () => {
    expect(parseDepartureDisplay('13 May 2027')).toBe('2027-05-13');
    expect(parseDepartureDisplay('1 March 2027')).toBe('2027-03-01');
    expect(parseDepartureDisplay(formatDepartureDisplay('2027-11-05'))).toBe('2027-11-05');
  });

  it('rejects text that is not exactly "D Month YYYY"', () => {
    expect(parseDepartureDisplay('25 August')).toBeNull();
    expect(parseDepartureDisplay('31 February 2027')).toBeNull();
    expect(parseDepartureDisplay('13 Mayy 2027')).toBeNull();
    expect(parseDepartureDisplay('2027-05-13')).toBeNull();
    expect(parseDepartureDisplay('')).toBeNull();
  });
});
