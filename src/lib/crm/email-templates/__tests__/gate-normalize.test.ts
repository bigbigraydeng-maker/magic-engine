import { describe, expect, it } from 'vitest';

import { normalizeForCheck } from '@/lib/crm/email-templates/gates/normalize';

const CASES: ReadonlyArray<readonly [string, string]> = [
  ['Visa-Free', 'visa-free'],
  ['visa\u2011free', 'visa-free'],
  ['vi\u200Bsa-free', 'visa-free'],
  ['visa-\nfree', 'visa-free'],
  ['visa - free', 'visa-free'],
  ['ｖｉｓａ ｆｒｅｅ', 'visa free'],
  ['visa&#8209;free', 'visa-free'],
  ['visa&#x2011;free', 'visa-free'],
  ['visa%2Dfree', 'visa-free'],
  ['a&amp;#45;b', 'a-b'],
  ['ctstours.co.nz%2Fx', 'ctstours.co.nz/x'],
  ['caf%C3%A9', 'café'],
  ['%ZZ', '%zz'],
  ['&#xZZ;', '&#xzz;'],
  ['a\u00A0\u00A0 b\n\tc', 'a b c'],
];

describe('normalizeForCheck', () => {
  it.each(CASES)('normalises %j to %j', (input, expected) => {
    expect(normalizeForCheck(input)).toBe(expected);
  });

  it.each(CASES)('is idempotent for %j', (input) => {
    const once = normalizeForCheck(input);
    expect(normalizeForCheck(once)).toBe(once);
  });
});
