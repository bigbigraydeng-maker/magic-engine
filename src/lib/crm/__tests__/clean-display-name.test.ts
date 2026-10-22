import { describe, expect, it } from 'vitest';

import {
  cleanDisplayName,
  hasLetterOrDigit,
  normaliseForCompare,
} from '../clean-display-name';

describe('cleanDisplayName — keeps usable names', () => {
  const keepCases: ReadonlyArray<readonly [string, string]> = [
    ['Brian', 'Brian'],
    ['Mr. A. Smith', 'Mr. A. Smith'],
    ['kay@home', 'kay@home'],
    ['+1 Bob', '+1 Bob'],
    ['8888', '8888'],
    ['007', '007'],
    ['Иван Петров', 'Иван Петров'],
    ['محمد علي', 'محمد علي'],
    ['สมชาย', 'สมชาย'],
    ['李小龙', '李小龙'],
    ['Chris B', 'Chris B'],
    ['  Bob   Lee ', 'Bob Lee'],
    ['WhatsApp Business', 'WhatsApp Business'],
  ];

  it.each(keepCases)('keeps %j as %j', (input, expected) => {
    expect(cleanDisplayName(input)).toBe(expected);
  });

  it('truncates a 100-character name to exactly 80 characters', () => {
    const long = 'a'.repeat(100);
    const result = cleanDisplayName(long);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(80);
    expect(result).toBe('a'.repeat(80));
  });
});

describe('cleanDisplayName — returns null for unusable input', () => {
  const nullCases: ReadonlyArray<string | null | undefined> = [
    null,
    undefined,
    '',
    '   ',
    'hayleyhailstone@icloud.com',
    'A@B.COM',
    "'a@b.com'",
    '"a@b.com"',
    '<a@b.com>',
    '+64 21 123 4567',
    '021-123-4567',
    '(09) 123 4567',
    '👍👍',
    '...',
    '-',
    '.',
    'N/A',
    'n/a',
    'null',
    'undefined',
    'Unknown',
    'Unknown Caller',
    'Facebook 用户',
    'Facebook user',
    '未留姓名',
    '\u200B\u200B',
    '\n\t',
  ];

  it.each(nullCases)('returns null for %j', (input) => {
    expect(cleanDisplayName(input)).toBeNull();
  });
});

describe('cleanDisplayName — strips embedded address parts', () => {
  const stripCases: ReadonlyArray<readonly [string, string]> = [
    ['Bob Lee <bob@x.com>', 'Bob Lee'],
    ['"Bob Lee" <bob@x.com>', 'Bob Lee'],
    ['bob@x.com (Bob)', 'Bob'],
    ['Bob\u200B Lee', 'Bob Lee'],
    ['Bob\r\nLee', 'Bob Lee'],
  ];

  it.each(stripCases)('strips %j to %j', (input, expected) => {
    expect(cleanDisplayName(input)).toBe(expected);
  });
});

describe('hasLetterOrDigit', () => {
  it('returns true for strings containing a Unicode letter or number', () => {
    expect(hasLetterOrDigit('Brian')).toBe(true);
    expect(hasLetterOrDigit('Иван')).toBe(true);
    expect(hasLetterOrDigit('محمد')).toBe(true);
    expect(hasLetterOrDigit('สมชาย')).toBe(true);
    expect(hasLetterOrDigit('李小龙')).toBe(true);
    expect(hasLetterOrDigit('123')).toBe(true);
    expect(hasLetterOrDigit('a')).toBe(true);
  });

  it('returns false for strings with no letter or number', () => {
    expect(hasLetterOrDigit('')).toBe(false);
    expect(hasLetterOrDigit('   ')).toBe(false);
    expect(hasLetterOrDigit('...')).toBe(false);
    expect(hasLetterOrDigit('-')).toBe(false);
    expect(hasLetterOrDigit('👍👍')).toBe(false);
    expect(hasLetterOrDigit('!@#$%^&*()')).toBe(false);
  });
});

describe('normaliseForCompare', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normaliseForCompare('Unknown')).toBe('unknown');
    expect(normaliseForCompare('Unknown Caller')).toBe('unknown caller');
    expect(normaliseForCompare('N/A')).toBe('n a');
    expect(normaliseForCompare('  Bob   Lee ')).toBe('bob lee');
    expect(normaliseForCompare('Mr. A. Smith')).toBe('mr a smith');
  });

  it('preserves Unicode letters and numbers', () => {
    expect(normaliseForCompare('Иван Петров')).toBe('иван петров');
    expect(normaliseForCompare('李小龙')).toBe('李小龙');
    expect(normaliseForCompare('Facebook 用户')).toBe('facebook 用户');
  });

  it('returns an empty string for punctuation-only input', () => {
    expect(normaliseForCompare('...')).toBe('');
    expect(normaliseForCompare('   ')).toBe('');
  });
});
