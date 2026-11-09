import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  isUuid,
  normalizeRecipient,
  pickRecipient,
  sanitizeBody,
  sanitizeSubject,
} from '../validate';

describe('isUuid', () => {
  it('accepts canonical uuids', () => {
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isUuid('123E4567-E89B-12D3-A456-426614174000')).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(isUuid('')).toBe(false);
    expect(isUuid('123e4567e89b12d3a456426614174000')).toBe(false);
    expect(isUuid('123e4567-e89b-12d3-a456-42661417400')).toBe(false);
    expect(isUuid('123e4567-e89b-12d3-a456-4266141740000')).toBe(false);
    expect(isUuid('zzze4567-e89b-12d3-a456-426614174000')).toBe(false);
    expect(isUuid(123)).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe('sanitizeSubject', () => {
  it('neutralises CRLF header injection', () => {
    expect(sanitizeSubject('Hi\r\nBcc: x@y.com')).toBe('Hi Bcc: x@y.com');
  });

  it('replaces tabs and control chars with a single space', () => {
    expect(sanitizeSubject('a\tb')).toBe('a b');
    expect(sanitizeSubject('a\u0000b')).toBe('a b');
    expect(sanitizeSubject('a\u007Fb')).toBe('a b');
  });

  it('collapses repeated spaces', () => {
    expect(sanitizeSubject('a   b')).toBe('a b');
    expect(sanitizeSubject('a\r\n\r\nb')).toBe('a b');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeSubject('  hello  ')).toBe('hello');
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(sanitizeSubject('')).toBeNull();
    expect(sanitizeSubject('   ')).toBeNull();
    expect(sanitizeSubject('\r\n\t')).toBeNull();
  });

  it('returns null for non-strings', () => {
    expect(sanitizeSubject(undefined)).toBeNull();
    expect(sanitizeSubject(null)).toBeNull();
    expect(sanitizeSubject(42)).toBeNull();
    expect(sanitizeSubject({})).toBeNull();
  });

  it('enforces the max length', () => {
    expect(sanitizeSubject('a'.repeat(MAX_SUBJECT_LENGTH))).toBe(
      'a'.repeat(MAX_SUBJECT_LENGTH),
    );
    expect(sanitizeSubject('a'.repeat(MAX_SUBJECT_LENGTH + 1))).toBeNull();
  });
});

describe('sanitizeBody', () => {
  it('normalises CRLF and CR to LF', () => {
    expect(sanitizeBody('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('removes NUL and other control chars but keeps newlines and tabs', () => {
    expect(sanitizeBody('a\u0000b')).toBe('ab');
    expect(sanitizeBody('a\u0001b')).toBe('ab');
    expect(sanitizeBody('a\tb')).toBe('a\tb');
    expect(sanitizeBody('a\nb')).toBe('a\nb');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeBody('  hello  ')).toBe('hello');
  });

  it('returns null for empty input', () => {
    expect(sanitizeBody('')).toBeNull();
    expect(sanitizeBody('   ')).toBeNull();
    expect(sanitizeBody('\u0000\u0001')).toBeNull();
  });

  it('returns null for non-strings', () => {
    expect(sanitizeBody(undefined)).toBeNull();
    expect(sanitizeBody(null)).toBeNull();
    expect(sanitizeBody(1)).toBeNull();
  });

  it('enforces the max length', () => {
    expect(sanitizeBody('a'.repeat(MAX_BODY_LENGTH))).toBe(
      'a'.repeat(MAX_BODY_LENGTH),
    );
    expect(sanitizeBody('a'.repeat(MAX_BODY_LENGTH + 1))).toBeNull();
  });
});

describe('normalizeRecipient', () => {
  it('lowercases a valid address', () => {
    expect(normalizeRecipient('A.B+c@Example.CO.NZ')).toBe(
      'a.b+c@example.co.nz',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeRecipient('  a@b.com  ')).toBe('a@b.com');
  });

  it('rejects multiple addresses', () => {
    expect(normalizeRecipient('a@b.com,c@d.com')).toBeNull();
    expect(normalizeRecipient('a@b.com;c@d.com')).toBeNull();
  });

  it('rejects whitespace inside the address', () => {
    expect(normalizeRecipient('a b@c.com')).toBeNull();
  });

  it('rejects angle brackets and quotes', () => {
    expect(normalizeRecipient('<a@b.com>')).toBeNull();
    expect(normalizeRecipient('"a"@b.com')).toBeNull();
  });

  it('rejects malformed addresses', () => {
    expect(normalizeRecipient('a@b')).toBeNull();
    expect(normalizeRecipient('a@@b.com')).toBeNull();
    expect(normalizeRecipient('@b.com')).toBeNull();
    expect(normalizeRecipient('a@.com')).toBeNull();
    expect(normalizeRecipient('a@b..com')).toBeNull();
    expect(normalizeRecipient('a@-b.com')).toBeNull();
    expect(normalizeRecipient('a@b-.com')).toBeNull();
  });

  it('rejects addresses that are too long', () => {
    const local = 'a'.repeat(64);
    const domain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.com`;
    const address = `${local}@${domain}`;
    expect(address.length).toBe(255);
    expect(normalizeRecipient(address)).toBeNull();
  });

  it('rejects local parts longer than 64 chars', () => {
    const local = 'a'.repeat(65);
    expect(normalizeRecipient(`${local}@b.com`)).toBeNull();
  });

  it('rejects non-ASCII addresses', () => {
    expect(normalizeRecipient('ü@b.com')).toBeNull();
    expect(normalizeRecipient('a@bü.com')).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(normalizeRecipient(undefined)).toBeNull();
    expect(normalizeRecipient(null)).toBeNull();
    expect(normalizeRecipient(123)).toBeNull();
  });
});

describe('pickRecipient', () => {
  it('uses a valid primary email', () => {
    expect(pickRecipient('A@B.com', ['c@d.com'])).toEqual({
      ok: true,
      email: 'a@b.com',
    });
  });

  it('falls back to a single identity when primary is invalid', () => {
    expect(pickRecipient('not-an-email', ['c@d.com'])).toEqual({
      ok: true,
      email: 'c@d.com',
    });
  });

  it('reports ambiguous when two distinct identities exist', () => {
    expect(pickRecipient(null, ['a@b.com', 'c@d.com'])).toEqual({
      ok: false,
      reason: 'ambiguous',
    });
  });

  it('treats case-different identities as one', () => {
    expect(pickRecipient(undefined, ['A@B.com', 'a@b.com'])).toEqual({
      ok: true,
      email: 'a@b.com',
    });
  });

  it('reports none when nothing is usable', () => {
    expect(pickRecipient(null, [])).toEqual({ ok: false, reason: 'none' });
    expect(pickRecipient(undefined, ['bad', 'also-bad'])).toEqual({
      ok: false,
      reason: 'none',
    });
  });

  it('reports invalid when only an invalid primary was present', () => {
    expect(pickRecipient('not-an-email', [])).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});
