import { describe, expect, it } from 'vitest';

import { resolveFirstName } from '@/lib/crm/email-templates/first-name';

describe('resolveFirstName', () => {
  it.each<[string, string | null]>([
    ['Lisa Zhang', 'Lisa'],
    ['Mr John Smith', 'John'],
    ['Dr. Jane Doe', 'Jane'],
    ['Mr', null],
    ['Mrs.', null],
    ['123', null],
    ['Guest', null],
    ['tracey1ray', null],
    ['JOHN SMITH', 'John'],
    ['mary-ann lee', 'Mary-Ann'],
    ["o'brien pat", "O'Brien"],
    ['McDonald Ann', 'McDonald'],
    ['😀 Sam', 'Sam'],
    ['Sam 😀', 'Sam'],
    ['', null],
    ['   ', null],
    ['info@ctstours.co.nz', null],
    ['Lisa lisa@x.com', null],
    ['李明', '李明'],
    ['Zhang Wei', 'Zhang'],
    ['J', null],
    ['a_b', null],
    ['Unknown User', null],
    ['Ｌｉｓａ Ｚ', 'Lisa'],
  ])('resolves %j to %j', (input, expected) => {
    expect(resolveFirstName(input)).toBe(expected);
  });

  it.each<[string | null | undefined, string | null]>([
    [null, null],
    [undefined, null],
  ])('resolves %j to %j', (input, expected) => {
    expect(resolveFirstName(input)).toBe(expected);
  });

  it('returns null for a 41-character name', () => {
    const longName = 'a'.repeat(41);
    expect(resolveFirstName(longName)).toBeNull();
  });
});
