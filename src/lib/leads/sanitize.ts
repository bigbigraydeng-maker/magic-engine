/**
 * Lead-payload sanitization.
 *
 * Pure functions only — the route layer wraps this with rate limit + CORS +
 * DB insert. Keeping these separate so we can unit-test the validation rules
 * without spinning up Supabase.
 *
 * Trust model: ANYTHING on the wire is hostile. Public, no-auth POST endpoint.
 */

// Whitelists must match the LP form options; the LP can be tightened up later
// but the server stays the source of truth for what values are valid.
export const PROJECT_TYPES = ['flooring', 'carpet', 'tiles', 'bathware', 'multi', 'other'] as const
export type ProjectType = typeof PROJECT_TYPES[number]

export const TIMELINES = ['this_week', 'this_month', 'this_quarter', 'researching'] as const
export type Timeline = typeof TIMELINES[number]

// Field length caps. Anything over the cap is REJECTED (not silently truncated)
// because we don't want the DB to silently keep a truncated phone number that
// would never reach the customer.
const REQUIRED_CAPS = { name: 120, phone: 32 } as const
const OPTIONAL_CAPS = {
  email:        160,
  suburb:       80,
  message:      2000,
  source_url:   500,
  referrer:     500,
  utm_source:   80,
  utm_medium:   80,
  utm_campaign: 120,
} as const

// Cheap, permissive email regex — DEAD-letter rejection happens elsewhere.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/
// Allows + 0-9 spaces ( ) - and . to accommodate AU and intl formats.
const PHONE_RE = /^[+0-9\s().-]{8,32}$/

export interface RawLeadInput {
  // Honeypot — if the bot tool fills this, we silently DROP the submission.
  company_hp?: unknown
  // Required
  name?:         unknown
  phone?:        unknown
  // Optional
  email?:        unknown
  project_type?: unknown
  suburb?:       unknown
  timeline?:     unknown
  message?:      unknown
  // Attribution (untrusted, but kept for analytics)
  source_url?:   unknown
  referrer?:     unknown
  utm_source?:   unknown
  utm_medium?:   unknown
  utm_campaign?: unknown
  submitted_at?: unknown
}

export interface CleanLead {
  name:          string
  phone:         string
  email:         string | null
  project_type:  ProjectType | null
  suburb:        string | null
  timeline:      Timeline | null
  message:       string | null
  source_url:    string | null
  referrer:      string | null
  utm_source:    string | null
  utm_medium:    string | null
  utm_campaign:  string | null
  submitted_at:  string | null
}

export type SanitizeResult =
  | { ok: true;  lead: CleanLead }
  | { ok: false; reason: string; code: 'HONEYPOT' | 'INVALID_INPUT' }

/** Trim + cap. Returns null for non-strings or empty after trim. */
function strField(v: unknown, cap: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  if (t.length > cap) return null   // signal "too long" via null + length check
  return t
}

/** Required version of strField: also returns null on overflow. */
function requiredStr(v: unknown, cap: number): string | null {
  return strField(v, cap)
}

function pickEnum<T extends readonly string[]>(v: unknown, allowed: T): T[number] | null {
  if (typeof v !== 'string') return null
  return (allowed as readonly string[]).includes(v) ? (v as T[number]) : null
}

export function sanitizeLead(raw: RawLeadInput): SanitizeResult {
  // Honeypot — if a bot filled it, silently mark as honeypot. The caller
  // returns 200 OK so the bot does not learn the trap exists.
  if (typeof raw.company_hp === 'string' && raw.company_hp.trim().length > 0) {
    return { ok: false, reason: 'honeypot hit', code: 'HONEYPOT' }
  }

  // ── Required: name + phone ────────────────────────────────────────────────
  const name  = requiredStr(raw.name,  REQUIRED_CAPS.name)
  const phone = requiredStr(raw.phone, REQUIRED_CAPS.phone)
  if (!name)  return { ok: false, reason: 'name is required',  code: 'INVALID_INPUT' }
  if (!phone) return { ok: false, reason: 'phone is required', code: 'INVALID_INPUT' }
  if (!PHONE_RE.test(phone)) {
    return { ok: false, reason: 'phone format is invalid', code: 'INVALID_INPUT' }
  }

  // ── Optional fields ───────────────────────────────────────────────────────
  // For email: present but malformed → REJECT (don't silently strip — caller
  // typed something they expect us to use). Empty/missing → null.
  let email: string | null = null
  if (raw.email !== undefined && raw.email !== null && raw.email !== '') {
    email = strField(raw.email, OPTIONAL_CAPS.email)
    if (!email || !EMAIL_RE.test(email)) {
      return { ok: false, reason: 'email format is invalid', code: 'INVALID_INPUT' }
    }
  }

  return {
    ok: true,
    lead: {
      name,
      phone,
      email,
      project_type: pickEnum(raw.project_type, PROJECT_TYPES),
      suburb:       strField(raw.suburb,  OPTIONAL_CAPS.suburb),
      timeline:     pickEnum(raw.timeline, TIMELINES),
      message:      strField(raw.message, OPTIONAL_CAPS.message),
      source_url:   strField(raw.source_url,   OPTIONAL_CAPS.source_url),
      referrer:     strField(raw.referrer,     OPTIONAL_CAPS.referrer),
      utm_source:   strField(raw.utm_source,   OPTIONAL_CAPS.utm_source),
      utm_medium:   strField(raw.utm_medium,   OPTIONAL_CAPS.utm_medium),
      utm_campaign: strField(raw.utm_campaign, OPTIONAL_CAPS.utm_campaign),
      // ISO timestamp validation: a stray "abc" from a tampered LP would
      // otherwise reach PostgreSQL and 22007-error the whole insert, dropping
      // a real lead. Validate parse-ability and fallback to null on garbage.
      submitted_at: parseIsoTimestamp(raw.submitted_at),
    },
  }
}

function parseIsoTimestamp(v: unknown): string | null {
  if (typeof v !== 'string') return null
  if (v.length > 40) return null
  const ts = Date.parse(v)
  if (!Number.isFinite(ts)) return null
  // Normalise to a canonical ISO 8601 so DB receives the same shape regardless
  // of trailing milliseconds / timezone abbreviation oddities.
  return new Date(ts).toISOString()
}

/**
 * Pull the first X-Forwarded-For hop. Render proxies set this to the real
 * client IP; on direct requests it's missing — fall back to a placeholder so
 * the rate-limit key is still stable per request batch.
 */
export function extractClientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first.slice(0, 64)
  }
  // Render's CDN-tier header — kept as a secondary signal.
  const real = headers.get('x-real-ip')
  if (real) return real.trim().slice(0, 64)
  return 'unknown'
}
