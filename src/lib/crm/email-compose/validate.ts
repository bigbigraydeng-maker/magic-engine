export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 10000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

// U+0000–U+001F and U+007F
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g;
const MULTI_SPACE_RE = / {2,}/g;

export function sanitizeSubject(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const replaced = raw.replace(CONTROL_CHARS_RE, ' ');
  const collapsed = replaced.replace(MULTI_SPACE_RE, ' ').trim();
  if (collapsed.length === 0) return null;
  if (collapsed.length > MAX_SUBJECT_LENGTH) return null;
  return collapsed;
}

// Control chars except \n (U+000A) and \t (U+0009)
const BODY_CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function sanitizeBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const cleaned = normalized.replace(BODY_CONTROL_CHARS_RE, '');
  const trimmed = cleaned.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_BODY_LENGTH) return null;
  return trimmed;
}

const FORBIDDEN_ADDRESS_CHARS_RE = /[\s,;<>"'()\[\]\\]/;
const LOCAL_PART_RE = /^[a-z0-9!#$%&*+/=?^_`{|}~.-]+$/i;
const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

export function normalizeRecipient(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 254) return null;
  if (FORBIDDEN_ADDRESS_CHARS_RE.test(trimmed)) return null;

  const atIndex = trimmed.indexOf('@');
  if (atIndex === -1) return null;
  if (trimmed.indexOf('@', atIndex + 1) !== -1) return null;

  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);

  if (local.length < 1 || local.length > 64) return null;
  if (!LOCAL_PART_RE.test(local)) return null;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return null;
  }

  if (domain.length === 0) return null;
  if (!domain.includes('.')) return null;

  const labels = domain.split('.');
  for (const label of labels) {
    if (label.length === 0) return null;
    if (!DOMAIN_LABEL_RE.test(label)) return null;
  }

  return `${local}@${domain}`.toLowerCase();
}

export type RecipientPick =
  | { ok: true; email: string }
  | { ok: false; reason: 'none' | 'ambiguous' | 'invalid' };

export function pickRecipient(
  primaryEmail: string | null | undefined,
  identityEmails: readonly string[],
): RecipientPick {
  let primaryWasPresent = false;
  let primaryWasInvalid = false;

  if (typeof primaryEmail === 'string' && primaryEmail.length > 0) {
    primaryWasPresent = true;
    const normalized = normalizeRecipient(primaryEmail);
    if (normalized !== null) {
      return { ok: true, email: normalized };
    }
    primaryWasInvalid = true;
  }

  const seen = new Set<string>();
  for (const candidate of identityEmails) {
    const normalized = normalizeRecipient(candidate);
    if (normalized !== null) {
      seen.add(normalized);
    }
  }

  if (seen.size === 1) {
    const [only] = seen;
    return { ok: true, email: only };
  }
  if (seen.size > 1) {
    return { ok: false, reason: 'ambiguous' };
  }

  if (primaryWasPresent && primaryWasInvalid) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: false, reason: 'none' };
}
