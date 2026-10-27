const NON_ALNUM_RE = new RegExp('[^\\p{L}\\p{N}]+', 'gu');
const ALNUM_RE = new RegExp('[\\p{L}\\p{N}]', 'u');

// Zero-width and bidi control characters, plus other control characters.
// U+200B-U+200F, U+202A-U+202E, U+2060, U+FEFF, U+0000-U+001F, U+007F
const CONTROL_RUN_RE = new RegExp(
  '[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\u00AD\\u034F\\u180E\\uFE00-\\uFE0F\\uFEFF\\uFFF9-\\uFFFB\\u0000-\\u001F\\u007F]+',
  'g',
);

const EMAIL_WHOLE_RE = /^[^\s@<>"'()]+@[^\s@<>"'()]+\.[^\s@<>"'()]+$/;
const ANGLE_EMAIL_RE = /<[^<>]*@[^<>]*>/g;
const PAREN_EMAIL_RE = /\([^()]*@[^()]*\)/g;
const BARE_EMAIL_RE = /\S+@\S+\.\S+/g;
const SURROUNDING_QUOTES_RE = /^(['"])([\s\S]*)\1$/;

const PHONE_ALLOWED_RE = /^[0-9+\-().\s]+$/;
const DIGITS_RE = /\d/g;

const MAX_NAME_LENGTH = 80;

export const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set<string>([
  'unknown',
  'unknown caller',
  'unknown user',
  'unknown customer',
  'not available',
  'anonymous user',
  'whatsapp user',
  'guest user',
  'n a',
  'null',
  'undefined',
  'none',
  'no name',
  'anonymous',
  'facebook 用户',
  'facebook用户',
  'facebook user',
  '未知',
  '未知客人',
  '未留姓名',
  '未留名',
  '无名',
  '匿名',
]);

export function normaliseForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(NON_ALNUM_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasLetterOrDigit(s: string): boolean {
  return ALNUM_RE.test(s);
}

function stripSurroundingQuotes(s: string): string {
  const m = SURROUNDING_QUOTES_RE.exec(s);
  if (m) {
    return m[2];
  }
  return s;
}

function looksLikePhone(s: string): boolean {
  if (!PHONE_ALLOWED_RE.test(s)) {
    return false;
  }
  const digits = s.match(DIGITS_RE);
  return digits !== null && digits.length >= 7;
}

export function cleanDisplayName(raw: string | null | undefined): string | null {
  // 1. Reject non-strings; strip control/zero-width chars; collapse whitespace.
  if (typeof raw !== 'string') {
    return null;
  }
  let s = raw.replace(CONTROL_RUN_RE, ' ').replace(/\s+/g, ' ').trim();
  if (s.length === 0) {
    return null;
  }

  // 2. Whole-string email (optionally wrapped in one pair of quotes) -> null.
  const unquoted = stripSurroundingQuotes(s);
  if (EMAIL_WHOLE_RE.test(unquoted)) {
    return null;
  }

  // 3. Remove embedded address parts, keep the rest.
  s = s
    .replace(ANGLE_EMAIL_RE, ' ')
    .replace(PAREN_EMAIL_RE, ' ')
    .replace(BARE_EMAIL_RE, ' ');
  s = stripSurroundingQuotes(s.trim()).trim();
  // 'bob@x.com (Bob)' 去掉地址后剩下 '(Bob)'：整串被一对括号包住就取括号里的。
  const wrapped = /^\(([^()]*)\)$/.exec(s);
  if (wrapped) {
    s = wrapped[1];
  }
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length === 0) {
    return null;
  }

  // 4. Must contain at least one letter or digit.
  if (!hasLetterOrDigit(s)) {
    return null;
  }

  // 5. Whole-string phone number -> null.
  if (looksLikePhone(s)) {
    return null;
  }

  // 6. Placeholder names -> null.
  if (PLACEHOLDER_NAMES.has(normaliseForCompare(s))) {
    return null;
  }

  // 7. Truncate overly long names.
  if (s.length > MAX_NAME_LENGTH) {
    s = s.slice(0, MAX_NAME_LENGTH);
  }

  // 8. Return the remaining string.
  return s;
}
