/**
 * Client facts: a read-only, structured aggregate of what we know about one client
 * (brand, visual identity, three-tier taboos). It is NOT prompt text — prompt text is
 * rendered only by `formatBriefForPrompt` in `src/lib/content/brief-injector.ts`.
 *
 * Every value carries `source` (table.column it came from) so a shadow comparison can
 * say where a difference originates.
 */

export interface Sourced<T> {
  value: T
  /** e.g. `master_briefs.vi_colors`; `none` when no source had a value. */
  source: string
}

export type BriefMatchedBy = 'status' | 'is_active_fallback'

/**
 * One taboo tier. `none_configured` (null / missing / empty list) and `all_unusable` are different
 * from a failed read (which is `ok:false` and never reaches this type): downstream hard gates
 * must say "no redlines to scan" in their receipt instead of treating either as a pass.
 */
export interface TabooTier {
  items: string[]
  /**
   * `none_configured`: nothing configured. `all_unusable`: entries exist but none can be matched
   * on (so scanning `items` would scan nothing). `set`: at least one usable entry.
   */
  status: 'set' | 'none_configured' | 'all_unusable'
  /** Entries that were blank or too short to match on; counted, never silently dropped. */
  unusable_count: number
  /** The unusable entries themselves (cleaned; `(blank)` when nothing visible is left), so a receipt can name them. */
  unusable_entries: string[]
}

export interface BrandVoiceFacts {
  tone_keywords: string[]
  avoid_keywords: string[]
  formality: 'casual' | 'neutral' | 'professional' | null
  emoji_usage: 'none' | 'minimal' | 'moderate' | null
  language_mix: string | null
  persona: { name: string; role: string | null } | null
}

export interface TargetAudienceFacts {
  interests: string[]
  pain_points: string[]
  age_range: string | null
  location: string | null
}

export interface ViColorsFacts {
  primary: string | null
  secondary: string | null
  accent: string | null
  background: string | null
}

/** Reserved for the brand-pack step. Never populated by step 1. */
export interface LogoRef {
  ref: string
  hash?: string
}

export interface ClientFacts {
  client_id: string
  brief: { id: string; version: number; matched_by: BriefMatchedBy }
  brand: {
    brand_name: Sourced<string | null>
    tagline: Sourced<string | null>
    core_proposition: Sourced<string | null>
    brand_voice: Sourced<BrandVoiceFacts | null>
    target_audience: Sourced<TargetAudienceFacts | null>
    /** Display only. This is NOT a fetch allowlist: `clients.domain` is client-editable. */
    website_host: Sourced<string | null>
  }
  visual: {
    vi_colors: Sourced<ViColorsFacts | null>
    vi_style_keywords: Sourced<string[]>
    vi_dos: Sourced<string[]>
    vi_donts: Sourced<string[]>
    logo?: Sourced<LogoRef | null>
  }
  taboos: {
    /** Hard scan. From `clients.brand_redline_phrases` only. */
    redline_phrases: Sourced<TabooTier>
    /** Topic level (SEO / blog). Matching semantics are substring, not whole word. */
    topics: Sourced<TabooTier>
    /** Hint only. `avoid_words` plus `brand_voice.avoid_keywords`. */
    tone_words: Sourced<TabooTier>
  }
  warnings: string[]
}

export type ClientFactsFailureReason =
  | 'invalid_client_id'
  | 'client_mismatch'
  | 'client_lookup_failed'
  | 'client_not_found'
  | 'client_malformed'
  | 'brief_lookup_failed'
  /** Postgres 42703: a selected column does not exist (a migration is not applied). */
  | 'schema_not_ready'
  | 'no_active_brief'
  | 'ambiguous_brief'
  | 'brief_malformed'
  | 'isolation_violation'
  | 'unexpected_error'

export type ClientFactsResult =
  | { ok: true; facts: ClientFacts }
  /** `detail` may carry raw database error text: server logs only, never return it to a browser. */
  | { ok: false; reason: ClientFactsFailureReason; detail?: string }

export interface GetClientFactsOptions {
  /**
   * The already-authenticated caller's client id (e.g. from `requireDashboardClientAccess`).
   * A mismatch with `clientId` fails with `client_mismatch`. `null` explicitly means
   * "trusted server-side pipeline": it is required so that forgetting it is a compile error.
   */
  callerClientId: string | null
}
