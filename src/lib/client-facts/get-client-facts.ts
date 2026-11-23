import { supabaseAdmin } from '@/lib/supabase'
import { isUuid } from '@/lib/validation-utils'
import {
  buildTier,
  cleanText,
  hostFromUrlLike,
  parseBrandVoice,
  parseTargetAudience,
  parseViColors,
  readLenientList,
  readStrictList,
} from './normalize'
import type {
  BrandVoiceFacts,
  BriefMatchedBy,
  ClientFacts,
  ClientFactsFailureReason,
  ClientFactsResult,
  GetClientFactsOptions,
  Sourced,
  TabooTier,
} from './types'

/** Field whitelist for the `clients` table. Never use `select('*')`. */
const CLIENT_COLUMNS = 'id, domain, brand_redline_phrases'

/** Field whitelist for the `master_briefs` table. Never use `select('*')`. */
const BRIEF_COLUMNS =
  'id, client_id, version, status, is_active, project_id, created_at, brand_name, tagline, core_proposition, brand_voice, target_audience, vi_colors, vi_style_keywords, vi_dos, vi_donts, avoid_words, excluded_topics, website, source_website_urls'

/** Narrow an unknown value to a plain record so fields can be read safely. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Build a failure result. */
function fail(reason: ClientFactsFailureReason, detail?: string): ClientFactsResult {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail }
}

/** Map a Postgres error to a failure reason; 42703 means a migration is not applied. */
function errorReason(error: { code?: string }, fallback: ClientFactsFailureReason): ClientFactsFailureReason {
  return error.code === '42703' ? 'schema_not_ready' : fallback
}

/** Discriminated result of loading the effective brief. */
type BriefLoadResult =
  | { kind: 'ok'; row: Record<string, unknown>; matchedBy: BriefMatchedBy }
  | { kind: 'fail'; reason: ClientFactsFailureReason; detail?: string }

/** Query one brief path and return its rows, or a failure. */
async function queryBriefRows(
  cid: string,
  path: 'status' | 'fallback',
): Promise<{ kind: 'rows'; rows: Record<string, unknown>[] } | { kind: 'fail'; reason: ClientFactsFailureReason; detail?: string }> {
  const base = supabaseAdmin
    .from('master_briefs')
    .select(BRIEF_COLUMNS)
    .eq('client_id', cid)
    .is('project_id', null)

  const filtered =
    path === 'status'
      ? base.eq('status', 'active')
      : base.eq('is_active', true).is('status', null)

  const { data, error } = await filtered
    .order('version', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(2)

  if (error) {
    return { kind: 'fail', reason: errorReason(error, 'brief_lookup_failed'), detail: error.message }
  }
  if (!Array.isArray(data)) {
    return { kind: 'fail', reason: 'brief_lookup_failed' }
  }
  const rows: Record<string, unknown>[] = []
  for (const item of data) {
    if (isRecord(item)) rows.push(item)
  }
  return { kind: 'rows', rows }
}

/** Belt-and-braces validation of the chosen brief row. */
function validateBriefRow(
  cid: string,
  row: Record<string, unknown>,
  path: 'status' | 'fallback',
): { kind: 'ok' } | { kind: 'fail'; reason: ClientFactsFailureReason; detail?: string } {
  if (typeof row.client_id !== 'string' || row.client_id.toLowerCase() !== cid) {
    return { kind: 'fail', reason: 'isolation_violation', detail: 'brief row client_id mismatch' }
  }
  if (row.project_id !== null && row.project_id !== undefined) {
    return { kind: 'fail', reason: 'isolation_violation', detail: 'brief row has project_id' }
  }
  if (path === 'status') {
    if (row.status !== 'active') {
      return { kind: 'fail', reason: 'brief_malformed', detail: 'brief row status is not active' }
    }
  } else {
    if (row.status !== null) {
      return { kind: 'fail', reason: 'brief_malformed', detail: 'fallback brief row status is not null' }
    }
    if (row.is_active !== true) {
      return { kind: 'fail', reason: 'brief_malformed', detail: 'fallback brief row is_active is not true' }
    }
  }
  if (typeof row.id !== 'string') {
    return { kind: 'fail', reason: 'brief_malformed', detail: 'brief row id is not a string' }
  }
  if (typeof row.version !== 'number' || !Number.isFinite(row.version)) {
    return { kind: 'fail', reason: 'brief_malformed', detail: 'brief row version is not a finite number' }
  }
  return { kind: 'ok' }
}

/**
 * Load the effective brief for a client. The definition of "effective brief" lives
 * in exactly one place: this function.
 */
async function loadBrief(cid: string): Promise<BriefLoadResult> {
  const statusResult = await queryBriefRows(cid, 'status')
  if (statusResult.kind === 'fail') return statusResult
  if (statusResult.rows.length > 0) {
    const rows = statusResult.rows
    if (rows.length > 1 && rows[0].version === rows[1].version) {
      return { kind: 'fail', reason: 'ambiguous_brief' }
    }
    const check = validateBriefRow(cid, rows[0], 'status')
    if (check.kind === 'fail') return check
    return { kind: 'ok', row: rows[0], matchedBy: 'status' }
  }

  const fallbackResult = await queryBriefRows(cid, 'fallback')
  if (fallbackResult.kind === 'fail') return fallbackResult
  if (fallbackResult.rows.length === 0) {
    return { kind: 'fail', reason: 'no_active_brief' }
  }
  const rows = fallbackResult.rows
  if (rows.length > 1 && rows[0].version === rows[1].version) {
    return { kind: 'fail', reason: 'ambiguous_brief' }
  }
  const check = validateBriefRow(cid, rows[0], 'fallback')
  if (check.kind === 'fail') return check
  return { kind: 'ok', row: rows[0], matchedBy: 'is_active_fallback' }
}

/** Push warnings describing a taboo tier's state. */
function warnTier(warnings: string[], name: string, tier: TabooTier): void {
  if (tier.status === 'none_configured') {
    warnings.push(`${name}_none_configured`)
  }
  if (tier.status === 'all_unusable') {
    warnings.push(`${name}_all_unusable`)
  }
  if (tier.unusable_count > 0) {
    warnings.push(`${name}_has_unusable_entries`)
  }
}

/** Build the three-tier taboo facts, or a failure when a strict list is malformed. */
function buildTaboos(
  clientRow: Record<string, unknown>,
  briefRow: Record<string, unknown>,
  brandVoice: BrandVoiceFacts | null,
  warnings: string[],
): { kind: 'ok'; taboos: ClientFacts['taboos'] } | { kind: 'fail'; reason: ClientFactsFailureReason; detail?: string } {
  // The column is NOT NULL DEFAULT '{}': null/undefined here means the read itself went wrong
  // (e.g. the column fell out of the select), which must not look like "no redlines configured".
  const redlineRaw = readStrictList(clientRow.brand_redline_phrases)
  if (redlineRaw === null || clientRow.brand_redline_phrases === null || clientRow.brand_redline_phrases === undefined) {
    return { kind: 'fail', reason: 'client_malformed', detail: 'brand_redline_phrases is missing or not a string list' }
  }
  const topicsRaw = readStrictList(briefRow.excluded_topics)
  if (topicsRaw === null) {
    return { kind: 'fail', reason: 'brief_malformed', detail: 'excluded_topics is not a string list' }
  }
  const avoidWordsRaw = readStrictList(briefRow.avoid_words)
  if (avoidWordsRaw === null) {
    return { kind: 'fail', reason: 'brief_malformed', detail: 'avoid_words is not a string list' }
  }

  const redlineTier = buildTier([redlineRaw])
  const topicsTier = buildTier([topicsRaw])
  const toneTier = buildTier([avoidWordsRaw, brandVoice?.avoid_keywords ?? []])

  warnTier(warnings, 'redline_phrases', redlineTier)
  warnTier(warnings, 'topics', topicsTier)
  warnTier(warnings, 'tone_words', toneTier)

  return {
    kind: 'ok',
    taboos: {
      redline_phrases: { value: redlineTier, source: 'clients.brand_redline_phrases' },
      topics: { value: topicsTier, source: 'master_briefs.excluded_topics' },
      tone_words: {
        value: toneTier,
        source: 'master_briefs.avoid_words + master_briefs.brand_voice.avoid_keywords',
      },
    },
  }
}

/** Pick the first non-null website host from the ordered candidates. */
function pickWebsiteHost(
  briefRow: Record<string, unknown>,
  clientRow: Record<string, unknown>,
): Sourced<string | null> {
  const fromWebsite = hostFromUrlLike(briefRow.website)
  if (fromWebsite !== null) {
    return { value: fromWebsite, source: 'master_briefs.website' }
  }

  const sourceUrls = briefRow.source_website_urls
  if (Array.isArray(sourceUrls) && sourceUrls.length > 0) {
    const fromSourceUrls = hostFromUrlLike(sourceUrls[0])
    if (fromSourceUrls !== null) {
      return { value: fromSourceUrls, source: 'master_briefs.source_website_urls' }
    }
  }

  const fromDomain = hostFromUrlLike(clientRow.domain)
  if (fromDomain !== null) {
    return { value: fromDomain, source: 'clients.domain' }
  }

  return { value: null, source: 'none' }
}

/** Build the brand facts block. */
function buildBrand(
  briefRow: Record<string, unknown>,
  clientRow: Record<string, unknown>,
  brandVoice: BrandVoiceFacts | null,
  warnings: string[],
): ClientFacts['brand'] {
  return {
    brand_name: { value: cleanText(briefRow.brand_name), source: 'master_briefs.brand_name' },
    tagline: { value: cleanText(briefRow.tagline), source: 'master_briefs.tagline' },
    core_proposition: {
      value: cleanText(briefRow.core_proposition),
      source: 'master_briefs.core_proposition',
    },
    brand_voice: { value: brandVoice, source: 'master_briefs.brand_voice' },
    target_audience: {
      value: parseTargetAudience(briefRow.target_audience, warnings),
      source: 'master_briefs.target_audience',
    },
    website_host: pickWebsiteHost(briefRow, clientRow),
  }
}

/** Build the visual identity facts block. */
function buildVisual(briefRow: Record<string, unknown>, warnings: string[]): ClientFacts['visual'] {
  return {
    vi_colors: { value: parseViColors(briefRow.vi_colors, warnings), source: 'master_briefs.vi_colors' },
    vi_style_keywords: {
      value: readLenientList(briefRow.vi_style_keywords, warnings, 'vi_style_keywords'),
      source: 'master_briefs.vi_style_keywords',
    },
    vi_dos: {
      value: readLenientList(briefRow.vi_dos, warnings, 'vi_dos'),
      source: 'master_briefs.vi_dos',
    },
    vi_donts: {
      value: readLenientList(briefRow.vi_donts, warnings, 'vi_donts'),
      source: 'master_briefs.vi_donts',
    },
  }
}

/** Assemble the full ClientFacts result from the explicit picks above. */
function buildFacts(
  cid: string,
  clientRow: Record<string, unknown>,
  briefRow: Record<string, unknown>,
  matchedBy: BriefMatchedBy,
): ClientFactsResult {
  const warnings: string[] = []

  const brandVoice = parseBrandVoice(briefRow.brand_voice, warnings)

  const taboosResult = buildTaboos(clientRow, briefRow, brandVoice, warnings)
  if (taboosResult.kind === 'fail') {
    return fail(taboosResult.reason, taboosResult.detail)
  }

  const brand = buildBrand(briefRow, clientRow, brandVoice, warnings)
  const visual = buildVisual(briefRow, warnings)

  const briefId = briefRow.id
  const briefVersion = briefRow.version
  if (typeof briefId !== 'string' || typeof briefVersion !== 'number') {
    return fail('brief_malformed', 'brief row id or version is invalid')
  }

  const facts: ClientFacts = {
    client_id: cid,
    brief: { id: briefId, version: briefVersion, matched_by: matchedBy },
    brand,
    visual,
    taboos: taboosResult.taboos,
    warnings,
  }

  return { ok: true, facts }
}

/**
 * Read-only aggregate of one client's brand / visual / three-tier taboo facts.
 *
 * This function does NOT authenticate. The caller must already have authorised
 * `clientId` (e.g. via `requireDashboardClientAccess`) and should pass that
 * authorised id as `opts.callerClientId`. A `null` callerClientId means a trusted
 * server-side pipeline.
 *
 * It never throws: any thrown error or rejected promise becomes
 * `{ ok: false, reason: 'unexpected_error' }`.
 */
export async function getClientFacts(
  clientId: string,
  opts: GetClientFactsOptions,
): Promise<ClientFactsResult> {
  try {
    if (!isUuid(clientId)) {
      return fail('invalid_client_id')
    }

    const cid = clientId.toLowerCase()
    if (opts.callerClientId !== null && opts.callerClientId.toLowerCase() !== cid) {
      return fail('client_mismatch')
    }

    const { data, error } = await supabaseAdmin
      .from('clients')
      .select(CLIENT_COLUMNS)
      .eq('id', cid)
      .limit(2)

    if (error) {
      return fail(errorReason(error, 'client_lookup_failed'), error.message)
    }
    if (!Array.isArray(data) || data.length === 0) {
      return fail('client_not_found')
    }
    if (data.length > 1) {
      return fail('isolation_violation', 'multiple client rows')
    }

    const clientRow = data[0]
    if (!isRecord(clientRow)) {
      return fail('client_malformed', 'client row is not an object')
    }
    if (typeof clientRow.id !== 'string' || clientRow.id.toLowerCase() !== cid) {
      return fail('isolation_violation', 'client row id mismatch')
    }

    const briefResult = await loadBrief(cid)
    if (briefResult.kind === 'fail') {
      return fail(briefResult.reason, briefResult.detail)
    }

    return buildFacts(cid, clientRow, briefResult.row, briefResult.matchedBy)
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown error'
    return fail('unexpected_error', detail)
  }
}
