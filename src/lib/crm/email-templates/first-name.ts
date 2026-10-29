const HONORIFICS = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'mx',
  'dr',
  'prof',
  'sir',
  'madam',
]);

const BLOCKED = new Set([
  'guest',
  'customer',
  'unknown',
  'test',
  'tester',
  'user',
  'admin',
  'none',
  'noname',
  'anonymous',
  'name',
  'client',
  'visitor',
  'info',
  'sales',
  'enquiry',
  'enquiries',
  'na',
]);

// Strip leading/trailing chars that are not letters, numbers, apostrophes or hyphens.
const EDGE_STRIP = /^[^\p{L}\p{N}'-]+|[^\p{L}\p{N}'-]+$/gu;
const HONORIFIC_TOKEN = /^(mr|mrs|ms|miss|mx|dr|prof|sir|madam)\.?$/i;
const CJK = /\p{Script=Han}/u;

function titleCasePart(part: string): string {
  return part
    .split(/([-'])/)
    .map((seg) => {
      if (seg === '-' || seg === "'") return seg;
      if (seg.length === 0) return seg;
      return seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase();
    })
    .join('');
}

function isAllLower(s: string): boolean {
  return s === s.toLowerCase() && s !== s.toUpperCase();
}

function isAllUpper(s: string): boolean {
  return s === s.toUpperCase() && s !== s.toLowerCase();
}

export function resolveFirstName(
  displayName: string | null | undefined,
): string | null {
  if (displayName == null) return null;
  if (displayName.trim() === '') return null;
  if (displayName.includes('@')) return null;

  const normalised = displayName.normalize('NFKC').trim();
  const tokens = normalised
    .split(/\s+/)
    .map((t) => t.replace(EDGE_STRIP, ''))
    .filter((t) => t.length > 0);

  let index = 0;
  while (index < tokens.length && HONORIFIC_TOKEN.test(tokens[index])) {
    index += 1;
  }
  if (index >= tokens.length) return null;

  const candidate = tokens[index];
  if (candidate.length < 2 || candidate.length > 40) return null;
  if (/[\d@_]/.test(candidate)) return null;
  if (BLOCKED.has(candidate.toLowerCase())) return null;

  if (CJK.test(candidate)) return candidate;

  if (isAllLower(candidate) || isAllUpper(candidate)) {
    return titleCasePart(candidate);
  }
  return candidate;
}
