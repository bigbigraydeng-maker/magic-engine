/**
 * Offerings fact layer loader (Issue #1577).
 *
 * `config/clients/<configSlug>/offerings.yaml` is the PM/FDE-maintained, hand-edited
 * source of truth for what a client is actually selling right now. This loader is
 * the ONLY supported way to read it: parse YAML, validate with Zod, cache in memory
 * for 5 minutes so the reply agent and the Verifier don't re-hit the filesystem on
 * every message.
 *
 * Why this exists: the incident that started the CTS Governed Reply project was
 * Meta's official AI reading a still-live website page and telling a customer a
 * retired tour was bookable. This file is the governance layer's only source of
 * "is this tour actually for sale" — the Agent reasoning layer (Issue F) and the
 * Verifier policy (Issue D) both read through here instead of trusting the website
 * or the model's own training knowledge.
 *
 * Platform note: this loader is client-agnostic AND client-identity-agnostic —
 * it takes a `configSlug` (the literal `config/clients/<slug>` directory name)
 * and knows nothing about DB `client_id` UUIDs. Codex review (PR #1626,
 * 2nd pass) correctly flagged an earlier version that hardcoded a single
 * CTS UUID → slug mapping table *inside this shared loader*: that put one
 * client's identity in `src/lib` and would have required editing shared
 * runtime code for every future client (me-platform-tier-gate 红线 2). That
 * mapping now belongs to whoever calls this loader for a specific client
 * (for CTS today, a one-line constant in the CTS-specific caller/policy file
 * — not here). `configSlug` has no default: this is a shared, multi-client
 * entry point, so a caller that omits it must fail loudly instead of silently
 * reading another client's facts.
 */

import { promises as fs } from 'fs'
import path from 'path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

// ─── Schema ─────────────────────────────────────────────────────────────────

/**
 * Accepts ISO 8601 dates/timestamps (plain "2026-11-16" dates and full ISO
 * instants alike) — offerings.yaml is hand-edited by non-engineers, so typos
 * are expected. `Date.parse` alone is not enough: Node normalizes
 * out-of-range days (e.g. "2026-02-30" silently becomes March 2), which would
 * let a nonexistent departure date reach the fact layer and be quoted to a
 * customer. This re-checks the year/month/day round-trip through
 * `Date.UTC` to reject calendar dates that don't actually exist.
 */
/**
 * Full-string ISO date/timestamp shape — anchored at both ends, not just the
 * start (Codex review, PR #1626, round 7). The date-part extraction below
 * used to only anchor `^`, so `Date.parse`'s own leniency let trailing
 * garbage through: "2026-01-01 (draft)" and "2026-01-01 UTC" both parse
 * successfully in Node, so a hand-edited departure_dates/last_verified_at
 * entry could keep malformed trailing text that the reply agent might then
 * quote verbatim to a customer. This matches either a plain date
 * (`2026-11-16`) or a full ISO instant (`2026-09-13T00:00:00+13:00`) with
 * nothing else allowed before or after.
 */
const ISO_DATE_OR_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/

const dateLikeString = z.string().min(1).refine((value) => {
  const match = value.match(ISO_DATE_OR_INSTANT_RE)
  if (!match) return false
  if (Number.isNaN(Date.parse(value))) return false

  const [, yearStr, monthStr, dayStr] = value.match(/^(\d{4})-(\d{2})-(\d{2})/) ?? []
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  const roundTrip = new Date(Date.UTC(year, month - 1, day))
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  )
}, {
  message:
    'must be a valid calendar date in ISO format with nothing before or after it (e.g. "2026-11-16" or "2026-09-13T00:00:00+13:00") — dates that do not exist (e.g. "2026-02-30") or have trailing text (e.g. "2026-01-01 UTC") are rejected',
})

// Every object schema below is `.strict()` (Codex review, PR #1626): a plain
// z.object() silently drops unknown keys and lets a missing real field fall
// back to its `.default([])`. A hand-edited YAML typo like `retired_tour:`
// instead of `retired_tours:` would then parse "successfully" with an empty
// retired list — silently erasing the exact safety data this file exists to
// hold — instead of failing CI the way the loader tests already claim it does.

/**
 * `code` must already be a normalized slug (lowercase kebab-case, no leading/
 * trailing/internal whitespace) — enforced here instead of only normalizing
 * before comparison (Codex review, PR #1626, round 6). The cross-list
 * uniqueness check below (`superRefine`) does a plain string comparison; if
 * `code` could contain mixed case or stray whitespace, "Silk-Road" and
 * "silk-road " would slip through as "different" codes and the same tour
 * could still end up simultaneously active and retired. Forcing the format
 * at the field level closes that gap for every future consumer of `code`
 * (aliases, URLs, log lines), not just this one check.
 */
const tourCodeSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'must be a normalized slug: lowercase letters/digits, words separated by single hyphens, no leading/trailing/double hyphens or whitespace',
  )

export const ActiveTourSchema = z
  .object({
    code: tourCodeSchema,
    name: z.string().min(1),
    aliases: z.array(z.string()).default([]),
    price_nzd: z.number().positive(),
    departure_dates: z.array(dateLikeString).min(1),
    nights: z.number().int().positive(),
    itinerary_url: z.string().url(),
    highlights: z.array(z.string()).default([]),
  })
  .strict()

export const RetiredTourSchema = z
  .object({
    code: tourCodeSchema,
    name: z.string().min(1),
    aliases: z.array(z.string()).default([]),
    retired_reason: z.string().min(1),
    /**
     * True when the marketing page for a retired tour is still live on the
     * client's website — the exact trap that caused Meta's AI to misreport a
     * retired tour as bookable. Optional because it may be unknown/unverified
     * at the time an entry is added.
     */
    still_visible_on_website: z.boolean().optional(),
  })
  .strict()

export const OfferingsFileSchema = z
  .object({
    active_tours: z.array(ActiveTourSchema).default([]),
    retired_tours: z.array(RetiredTourSchema).default([]),
    /** Hard facts the reply agent may state verbatim (company history, visa rules, etc). */
    factual_bullets: z.array(z.string()).default([]),
    /**
     * Topics the reply agent must never answer directly, independent of
     * `master_briefs.excluded_topics` (that field is about content/brand voice,
     * this one is about what the Governed Reply Agent is allowed to say at all).
     */
    reply_forbidden_topics: z.array(z.string()).default([]),
    /**
     * When this file was last checked against reality. Kept as a plain string
     * (not auto-generated) so PM/FDE editing the YAML by hand can see and update
     * it directly. A downstream daily-todo reminder (Issue O) flags this file
     * once it is more than 7 days old — this loader only exposes the field.
     */
    last_verified_at: dateLikeString,
  })
  .strict()
  .superRefine((file, ctx) => {
    // Codex review, PR #1626: nothing stops the same `code` appearing in both
    // active_tours and retired_tours — e.g. PM/FDE moves a tour into
    // retired_tours but forgets to delete the matching active_tours entry.
    // Without this check the Agent and Verifier would see one code marked
    // simultaneously bookable and retired, and which "wins" would depend on
    // array-iteration order in whichever consumer reads it first — exactly
    // the kind of silent contradiction this file exists to prevent.
    const activeCodes = new Map<string, number>()
    file.active_tours.forEach((tour, i) => activeCodes.set(tour.code, i))

    file.retired_tours.forEach((tour, i) => {
      if (activeCodes.has(tour.code)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['retired_tours', i, 'code'],
          message: `code "${tour.code}" appears in both active_tours (index ${activeCodes.get(tour.code)}) and retired_tours (index ${i}) — a tour cannot be simultaneously bookable and retired`,
        })
      }
    })

    const seenActive = new Set<string>()
    file.active_tours.forEach((tour, i) => {
      if (seenActive.has(tour.code)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['active_tours', i, 'code'],
          message: `duplicate code "${tour.code}" within active_tours`,
        })
      }
      seenActive.add(tour.code)
    })

    const seenRetired = new Set<string>()
    file.retired_tours.forEach((tour, i) => {
      if (seenRetired.has(tour.code)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['retired_tours', i, 'code'],
          message: `duplicate code "${tour.code}" within retired_tours`,
        })
      }
      seenRetired.add(tour.code)
    })
  })

export type ActiveTour = z.infer<typeof ActiveTourSchema>
export type RetiredTour = z.infer<typeof RetiredTourSchema>
export type OfferingsFile = z.infer<typeof OfferingsFileSchema>

// ─── Loader ─────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000

/** Injectable clock so tests can control cache expiry without real sleeps or timer mocks. */
export interface Clock {
  now(): number
}

const systemClock: Clock = { now: () => Date.now() }

interface CacheEntry {
  filePath: string
  data: OfferingsFile
  loadedAt: number
}

let cache: CacheEntry | null = null

/**
 * `configSlug` is the literal `config/clients/<configSlug>` directory name —
 * NOT a DB `client_id` UUID. This loader deliberately carries zero mapping
 * from DB identity to config directory (Codex review, PR #1626, 2nd pass —
 * an earlier version hardcoded a single CTS UUID→slug entry here, which put
 * client identity inside shared `src/lib` runtime and would have required
 * editing this file for every future client). Resolving a caller's real
 * `conversations.client_id` to the right `configSlug` is the caller's job —
 * for CTS today that's a one-line constant living in the CTS-specific
 * caller/policy file, not a lookup table in this platform-shared loader.
 */
export function offeringsPathFor(configSlug: string): string {
  return path.join(process.cwd(), 'config', 'clients', configSlug, 'offerings.yaml')
}

export interface LoadOfferingsOptions {
  /**
   * Required unless `filePath` is given. The `config/clients/<configSlug>`
   * directory name — already resolved by the caller, not a raw DB
   * `client_id`. No default: this loader backs a shared, multi-client
   * Agent/Verifier entry point, so a caller that forgot to resolve/pass a
   * client must fail loudly instead of silently reading (and then quoting)
   * another client's private tour facts.
   */
  configSlug?: string
  /** Overrides the computed `config/clients/<configSlug>/offerings.yaml` path — mainly for tests. */
  filePath?: string
  /** Skip the in-memory cache and re-read + re-validate the file. */
  forceRefresh?: boolean
  /** Injectable clock — mainly for tests. Defaults to the real system clock. */
  clock?: Clock
}

/**
 * Load, validate, and cache a client's offerings.yaml.
 *
 * Throws if `configSlug`/`filePath` are both missing, the file is missing, or
 * it fails Zod validation — callers (Agent tool layer, Verifier policy) must
 * treat a throw as "fact layer unavailable" and fail closed (do not let the
 * model answer tour-availability questions from its own knowledge, and never
 * fall back to a different client's facts), not silently fall back to no
 * facts at all.
 */
export async function loadOfferings(options: LoadOfferingsOptions = {}): Promise<OfferingsFile> {
  let filePath = options.filePath
  if (!filePath) {
    if (!options.configSlug) {
      throw new Error(
        'loadOfferings requires configSlug (or filePath) — refusing to guess a client, ' +
          'since that could leak one client\'s tour facts into another client\'s reply',
      )
    }
    filePath = offeringsPathFor(options.configSlug)
  }
  const clock = options.clock ?? systemClock
  const now = clock.now()

  if (
    !options.forceRefresh &&
    cache &&
    cache.filePath === filePath &&
    now - cache.loadedAt < CACHE_TTL_MS
  ) {
    return cache.data
  }

  const raw = await fs.readFile(filePath, 'utf8')
  const parsed = parseYaml(raw)
  const data = OfferingsFileSchema.parse(parsed)

  cache = { filePath, data, loadedAt: now }
  return data
}

/** Test-only escape hatch — clears the module-level cache between test cases. */
export function __clearOfferingsCacheForTests(): void {
  cache = null
}
