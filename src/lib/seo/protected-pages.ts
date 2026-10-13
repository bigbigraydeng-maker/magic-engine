/**
 * Protected-page gate — normalisation, identity, matching, and the write guard.
 *
 * This module is the single source of truth for "is this page protected?".
 * It replaces the ad-hoc slug parsing that used to live in the meta-cycle
 * roster: the roster now only carries the raw config through, and every
 * decision about protection is made here.
 *
 * Design notes:
 *  - `readProtectedRaw` is the ONLY place that reads the config key, so the
 *    literal appears exactly once in the repo.
 *  - Nothing here imports a concrete Supabase client; the client is always
 *    injected as a `SupabaseClient` (type-only import).
 *  - Receipt writes never throw: a logging failure must not break the step
 *    it is observing.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'

export const HOME_PATH = '/'
export const MAX_PROTECTED_ENTRIES = 50
export const GATE_JOB_NAME = 'seo-protected-page-gate'

/** The single occurrence of the config key in the repo. */
const PROTECTED_KEY = 'meta_cycle_protected_slugs'

/** Home aliases apply to PAGE identities only, never to list entries. */
const HOME_ALIASES = ['home', 'index'] as const

export interface IdentityPath {
  value: string
  kind: 'url' | 'file'
}

export interface PageIdentity {
  paths: IdentityPath[]
  slugs: string[]
  /** Non-null => the identity could not be resolved; decision is 'unknown'. */
  unresolved: string | null
}

/**
 * LEGACY behaviour — kept byte-for-byte identical to the old roster.ts
 * `normalizeSlug` so existing callers see no change: trim, absolute URL ->
 * pathname, strip leading/trailing slashes, lowercase.
 */
export function normalizeSlug(v: string): string {
  let s = v.trim()
  try {
    const url = new URL(s)
    s = url.pathname
  } catch {
    // not a full URL — continue with raw value
  }
  return s.replace(/^\/+|\/+$/g, '').toLowerCase()
}

/**
 * Shared canonical form for page paths AND list entries: trim, absolute URL -> pathname, drop query/hash,
 * percent-decode, lowercase, strip slashes, strip a trailing `.html` / `.htm`, strip a trailing `/index`
 * (repeating, so `foo/index.html/` and `foo/index/` both become `foo`). Returns null when decoding fails.
 */
function canonicalPath(input: string): string | null {
  let s = input.trim()
  try {
    s = new URL(s).pathname
  } catch {
    // not a full URL — continue with raw value
  }
  s = s.split('#')[0].split('?')[0]

  let decoded: string
  try {
    decoded = decodeURIComponent(s)
  } catch {
    return null
  }

  let p = decoded.toLowerCase().replace(/^\/+|\/+$/g, '')
  for (let i = 0; i < 4; i++) {
    const before = p
    p = p.replace(/\.html?$/, '').replace(/(^|\/)index$/, '').replace(/^\/+|\/+$/g, '')
    if (p === before) break
  }
  return p
}

/**
 * Spec A. Input may be a full URL, a path, or a bare slug.
 * Returns null when decodeURIComponent throws (caller maps that to
 * `unresolvedIdentity('decode_failed')`).
 */
export function normalizePagePath(input: string): string | null {
  const p = canonicalPath(input)
  if (p === null) return null
  if (p === '' || p === 'index' || p === 'home') return HOME_PATH
  return p
}

/** Spec B. `kind` defaults to 'url'. */
export function identityFromUrl(url: string, kind: 'url' | 'file' = 'url'): PageIdentity {
  const p = normalizePagePath(url)
  if (p === null) return unresolvedIdentity('decode_failed')
  if (p === HOME_PATH) {
    return { paths: [{ value: HOME_PATH, kind }], slugs: ['', ...HOME_ALIASES], unresolved: null }
  }
  const last = p.split('/').filter((seg) => seg.length > 0).pop() ?? ''
  return { paths: [{ value: p, kind }], slugs: [last], unresolved: null }
}

/** Spec B. A bare slug normalises the same way as a URL. */
export function identityFromSlug(slug: string): PageIdentity {
  return identityFromUrl(slug, 'url')
}

export function unresolvedIdentity(reason: string): PageIdentity {
  return { paths: [], slugs: [], unresolved: reason }
}

/** Union of paths (dedupe by value+kind) and slugs (dedupe); unresolved = first non-null. */
export function mergeIdentities(...ids: PageIdentity[]): PageIdentity {
  const paths: IdentityPath[] = []
  const seenPaths = new Set<string>()
  const slugs: string[] = []
  const seenSlugs = new Set<string>()
  let unresolved: string | null = null

  for (const id of ids) {
    if (unresolved === null && id.unresolved !== null) unresolved = id.unresolved
    for (const path of id.paths) {
      const key = `${path.kind}\u0000${path.value}`
      if (seenPaths.has(key)) continue
      seenPaths.add(key)
      paths.push({ value: path.value, kind: path.kind })
    }
    for (const slug of id.slugs) {
      if (seenSlugs.has(slug)) continue
      seenSlugs.add(slug)
      slugs.push(slug)
    }
  }

  return { paths, slugs, unresolved }
}

export interface ParsedProtected {
  entries: string[]
  malformed: boolean
  reason: string | null
}

/**
 * Spec C. Normalises one list entry. Returns null when the entry cannot be
 * decoded (caller maps that to malformed 'bad_entry').
 */
function normalizeEntry(raw: string): string | null {
  const p = canonicalPath(raw)
  if (p === null) return null
  // List entries do NOT get the home aliases: `home` stays a slug entry. Only "nothing left" means the home page.
  return p === '' ? HOME_PATH : p
}

/** Spec C. */
export function parseProtectedSlugs(raw: unknown): ParsedProtected {
  if (raw === undefined || raw === null) return { entries: [], malformed: false, reason: null }
  if (!Array.isArray(raw)) return { entries: [], malformed: true, reason: 'not_array' }
  if (raw.length > MAX_PROTECTED_ENTRIES) return { entries: [], malformed: true, reason: 'too_many' }

  const entries: string[] = []
  const seen = new Set<string>()

  for (const item of raw) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      return { entries: [], malformed: true, reason: 'non_string_item' }
    }
    const normalized = normalizeEntry(item)
    if (normalized === null) return { entries: [], malformed: true, reason: 'bad_entry' }
    if (seen.has(normalized)) continue
    seen.add(normalized)
    entries.push(normalized)
  }

  return { entries, malformed: false, reason: null }
}

/** Spec C. The ONLY place that reads the config key. */
export function readProtectedRaw(seoConfig: unknown): { raw: unknown; malformed: boolean } {
  if (seoConfig === undefined || seoConfig === null) return { raw: undefined, malformed: false }
  if (typeof seoConfig !== 'object' || Array.isArray(seoConfig)) {
    return { raw: undefined, malformed: true }
  }
  return { raw: (seoConfig as Record<string, unknown>)[PROTECTED_KEY], malformed: false }
}

/** Spec D. */
export function matchProtected(entries: readonly string[], identity: PageIdentity): boolean {
  if (entries.length === 0) return false

  for (const entry of entries) {
    if (entry.length === 0) continue

    if (entry === HOME_PATH) {
      if (identity.paths.some((p) => p.value === HOME_PATH)) return true
      continue
    }

    if (entry.includes('/')) {
      for (const path of identity.paths) {
        if (path.value === entry) return true
        if (path.kind === 'file' && path.value.endsWith(`/${entry}`)) return true
      }
      continue
    }

    if (identity.slugs.includes(entry)) return true
  }

  return false
}

export type LoadedProtected =
  | { ok: true; entries: string[] }
  | { ok: false; reason: 'malformed' | 'lookup_failed' }

/** Spec E. */
export async function loadProtectedPages(
  supabase: SupabaseClient,
  clientId: string,
): Promise<LoadedProtected> {
  const { data, error } = await supabase
    .from('clients')
    .select('seo_config')
    .eq('id', clientId)
    .maybeSingle()

  if (error || !data) return { ok: false, reason: 'lookup_failed' }

  const { raw, malformed } = readProtectedRaw((data as { seo_config?: unknown }).seo_config)
  if (malformed) return { ok: false, reason: 'malformed' }

  const parsed = parseProtectedSlugs(raw)
  if (parsed.malformed) return { ok: false, reason: 'malformed' }

  return { ok: true, entries: parsed.entries }
}

export type GateDecision = 'protected' | 'open' | 'unknown'

/** Spec F. */
export function decide(loaded: LoadedProtected, identity: PageIdentity): GateDecision {
  if (!loaded.ok) return 'unknown'
  if (identity.unresolved !== null) return 'unknown'
  if (matchProtected(loaded.entries, identity)) return 'protected'
  return 'open'
}

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

declare const actorBrand: unique symbol

export interface PageWriteActor {
  readonly [actorBrand]: true
  readonly kind: 'system' | 'human'
  readonly isPm: boolean
  readonly callerHash: string
}

export const SYSTEM_ACTOR: PageWriteActor = {
  kind: 'system',
  isPm: false,
  callerHash: 'system',
} as PageWriteActor

function hashEmail(email: string): string {
  return createHash('sha256').update(email).digest('hex').slice(0, 12)
}

/**
 * Resolves the acting user from a verified email. `isPm` is only true when
 * the email is on the override list AND the email is verified.
 */
export function resolveActorFromEmail(
  email: string | null | undefined,
  emailVerified: boolean,
): PageWriteActor {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (normalized.length === 0) {
    return { kind: 'human', isPm: false, callerHash: 'anonymous' } as PageWriteActor
  }

  const callerHash = hashEmail(normalized)
  // Always read from the real process environment: there is deliberately no way to pass the allow-list in,
  // otherwise any caller could mint a PM actor for itself.
  const allowList = (process.env.PROTECTED_PAGE_OVERRIDE_EMAILS ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0)
  logOverrideListSizeOnce(allowList.length)

  const isPm = emailVerified && allowList.includes(normalized)
  return { kind: 'human', isPm, callerHash } as PageWriteActor
}

let overrideListSizeLogged = false
/** One log line the first time the list is read: a mistyped variable shows up as "0" (no emails are logged). */
function logOverrideListSizeOnce(size: number): void {
  if (overrideListSizeLogged) return
  overrideListSizeLogged = true
  console.info(`[seo-protected-page-gate] override list has ${size} owner email(s)`)
}

// ---------------------------------------------------------------------------
// Receipt + guard
// ---------------------------------------------------------------------------

export type GateOutcome =
  | 'denied_protected'
  | 'denied_unknown'
  | 'denied_not_pm'
  | 'allowed_pm_override'

export interface GateReceiptInput {
  clientId: string
  route: string
  outcome: GateOutcome
  identity: PageIdentity
  callerHash: string
  targetType: string | null
  /** What the gate would have decided without the override ('protected' | 'unknown'). */
  overriddenDecision?: GateDecision
}

/**
 * Inserts ONE terminal row into cron_run_logs. Never throws; returns false on
 * error so the caller can decide whether the failure is fatal.
 */
export async function writeGateReceipt(
  supabase: SupabaseClient,
  input: GateReceiptInput,
): Promise<boolean> {
  const now = new Date().toISOString()
  const { error } = await supabase.from('cron_run_logs').insert({
    id: randomUUID(),
    job_name: GATE_JOB_NAME,
    status: 'completed',
    started_at: now,
    finished_at: now,
    duration_ms: 0,
    processed: 1,
    completed_count: 0,
    failed_count: 0,
    summary: {
      client_id: input.clientId,
      route: input.route,
      decision: input.outcome,
      paths: input.identity.paths.map((p) => p.value),
      slugs: input.identity.slugs,
      target_type: input.targetType,
      caller_hash: input.callerHash,
      overridden_decision: input.overriddenDecision ?? null,
    },
    error_message: null,
  })
  if (error) {
    console.error(`[seo-protected-page-gate] receipt write failed (${input.route}):`, error.message)
    return false
  }
  return true
}

export class ProtectedPageError extends Error {
  readonly status = 403
  constructor(
    readonly decision: GateDecision | 'not_pm',
    message: string,
  ) {
    super(message)
    this.name = 'ProtectedPageError'
  }
}

declare const guardBrand: unique symbol

export interface PageWriteGuard {
  readonly [guardBrand]: true
  readonly clientId: string
  assert(identity: PageIdentity, opts?: { targetType?: string }): Promise<void>
}

function deniedOutcome(decision: GateDecision, actor: PageWriteActor): GateOutcome {
  if (decision === 'unknown') return 'denied_unknown'
  if (actor.kind === 'human') return 'denied_not_pm'
  return 'denied_protected'
}

export function createPageWriteGuard(input: {
  supabase: SupabaseClient
  clientId: string
  actor: PageWriteActor
  route: string
}): PageWriteGuard {
  const { supabase, clientId, actor, route } = input

  const guard = {
    clientId,
    async assert(identity: PageIdentity, opts?: { targetType?: string }): Promise<void> {
      const loaded = await loadProtectedPages(supabase, clientId)
      const decision = decide(loaded, identity)

      if (decision === 'open') return

      const targetType = opts?.targetType ?? null

      if (actor.isPm) {
        const written = await writeGateReceipt(supabase, {
          clientId,
          route,
          outcome: 'allowed_pm_override',
          identity,
          callerHash: actor.callerHash,
          targetType,
          overriddenDecision: decision,
        })
        if (!written) {
          throw new ProtectedPageError('unknown', 'receipt write failed, override refused')
        }
        return
      }

      const outcome = deniedOutcome(decision, actor)
      await writeGateReceipt(supabase, {
        clientId,
        route,
        outcome,
        identity,
        callerHash: actor.callerHash,
        targetType,
      })

      const reason = decision === 'unknown' ? 'unknown' : 'protected'
      throw new ProtectedPageError(reason, `write refused: page is ${reason}`)
    },
  }

  return guard as PageWriteGuard
}

/**
 * A guard reads the protected list of ITS client. A write function that receives a guard built for another client
 * would check the wrong list and wave a protected page through, so the pair must match — a mismatch is a
 * programming error, not a gate decision.
 */
export function assertGuardMatchesClient(guard: PageWriteGuard, clientId: string): void {
  if (guard.clientId !== clientId) {
    throw new Error(`page write guard belongs to client ${guard.clientId}, not ${clientId}`)
  }
}
