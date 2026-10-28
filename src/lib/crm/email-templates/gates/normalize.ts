const NAMED_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&nbsp;': '\u00A0',
  '&hyphen;': '\u2010',
  '&ndash;': '\u2013',
  '&mdash;': '\u2014',
};

const NAMED_ENTITY_PATTERN = /&(amp|lt|gt|quot|apos|nbsp|hyphen|ndash|mdash);/g;
const NUMERIC_ENTITY_PATTERN = /&#(?:(\d+)|[xX]([0-9a-fA-F]+));/g;
const PERCENT_RUN_PATTERN = /(?:%[0-9a-fA-F]{2})+/g;

// Zero-width characters, invisible operators (U+2061-2064), combining grapheme joiner, variation selectors,
// soft hyphen, bidi controls and the invisible Hangul/Khmer fillers: none of them shows on screen, all of them
// can be slipped between the letters of a blocked phrase.
const INVISIBLE_PATTERN =
  /[\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\uFE00-\uFE0F\uFEFF\u00AD\u3164\uFFA0\u{E0100}-\u{E01EF}]/gu;

const DASH_PATTERN = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D\u2043]/g;

const WHITESPACE_PATTERN =
  /[\s\u00A0\u2000-\u200A\u202F\u205F\u3000]+/g;

const HYPHEN_SPACING_PATTERN = /\s*-\s*/g;

function decodeNumericEntity(match: string, dec: string | undefined, hex: string | undefined): string {
  const codePoint = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? '', 16);
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return match;
  }
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return match;
  }
}

function decodeEntitiesOnce(text: string): string {
  const named = text.replace(NAMED_ENTITY_PATTERN, (m) => NAMED_ENTITIES[m] ?? m);
  return named.replace(NUMERIC_ENTITY_PATTERN, (m, dec: string | undefined, hex: string | undefined) =>
    decodeNumericEntity(m, dec, hex),
  );
}

function decodeEntities(text: string): string {
  // Two passes to undo double encoding (e.g. "&amp;#45;").
  return decodeEntitiesOnce(decodeEntitiesOnce(text));
}

function decodePercentRun(run: string): string {
  try {
    return decodeURIComponent(run);
  } catch {
    return run;
  }
}

function decodePercent(text: string): string {
  return text.replace(PERCENT_RUN_PATTERN, (run) => decodePercentRun(run));
}

/**
 * Normalises text for matching only (blocked phrases, link hosts).
 * The result is never sent to anybody.
 *
 * Limitation: this does NOT defeat spacing inside words ("v i s a"),
 * nor homoglyph substitution; those are out of scope for this gate.
 */
export function normalizeForCheck(text: string): string {
  let result = text.normalize('NFKC');
  result = decodeEntities(result);
  result = result.normalize('NFKC');
  result = decodePercent(result);
  result = result.replace(INVISIBLE_PATTERN, '');
  result = result.replace(DASH_PATTERN, '-');
  result = result.replace(WHITESPACE_PATTERN, ' ').trim();
  result = result.replace(HYPHEN_SPACING_PATTERN, '-');
  return result.toLowerCase();
}

/**
 * Normalises text for LINK extraction. Differs from `normalizeForCheck` on purpose:
 *  - no percent-decoding: `https://good.example%2F@evil.com` must keep its `%2F` so the host is read the way a
 *    browser reads it (the authority is `good.example%2F@evil.com`: user-info, then host evil.com);
 *  - whitespace and hyphens are left alone: squeezing the spaces around a hyphen would glue "a.com/x - https://evil.com"
 *    into ONE link whose host looks fine while a mail client still shows the second link;
 *  - not lower-cased (hosts are compared case-insensitively where they are used).
 */
export function normalizeForLinks(text: string): string {
  let result = text.normalize('NFKC');
  result = decodeEntities(result);
  result = result.normalize('NFKC');
  return result.replace(INVISIBLE_PATTERN, '');
}
