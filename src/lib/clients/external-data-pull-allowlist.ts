/**
 * Per-client external data pull allowlist (legacy ME maintenance mode).
 *
 * Scheduled crons / Inngest fan-outs that call third-party APIs (Meta, Google,
 * DataForSEO, Mailchimp, Microsoft Graph, telephony vendors, etc.) intersect
 * their client roster with this list before spending.
 *
 * Env `EXTERNAL_DATA_PULL_CLIENT_IDS` (comma-separated UUIDs):
 *   · unset → CTS Tours NZ only (maintenance default)
 *   · `*` or `all` → no extra filter (restore full multi-tenant pulls)
 *   · explicit UUID list → only those clients
 *
 * Does not apply to manual/API routes (execute, webhooks, per-client refresh
 * triggered from the dashboard with an explicit client id).
 */

/** CTS Tours NZ — sole default tenant while legacy ME external pulls are narrowed. */
export const DEFAULT_EXTERNAL_DATA_PULL_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ALL_TOKENS = new Set(['*', 'all'])

function normalizeClientId(clientId: string): string {
  return clientId.trim().toLowerCase()
}

function parseAllowlistFromEnv(raw: string | undefined): ReadonlySet<string> | null {
  if (raw === undefined) {
    return new Set([normalizeClientId(DEFAULT_EXTERNAL_DATA_PULL_CLIENT_ID)])
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return new Set([normalizeClientId(DEFAULT_EXTERNAL_DATA_PULL_CLIENT_ID)])
  }
  if (ALL_TOKENS.has(trimmed.toLowerCase())) {
    return null
  }
  const tokens = trimmed.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  const invalidCount = tokens.filter((s) => !UUID_RE.test(s)).length
  warnDroppedNonUuidTokens(trimmed, invalidCount)
  const ids = tokens.filter((s) => UUID_RE.test(s)).map(normalizeClientId)
  return ids.length > 0
    ? new Set(ids)
    : new Set([normalizeClientId(DEFAULT_EXTERNAL_DATA_PULL_CLIENT_ID)])
}

/** Last raw env string we already warned about. Not logged. */
let warnedInvalidAllowlistRaw: string | undefined

function warnDroppedNonUuidTokens(raw: string, invalidCount: number): void {
  if (invalidCount <= 0 || warnedInvalidAllowlistRaw === raw) return
  warnedInvalidAllowlistRaw = raw
  console.warn(
    `[external-data-pull-allowlist] dropped ${invalidCount} non-UUID token(s) from EXTERNAL_DATA_PULL_CLIENT_IDS`,
  )
}

/** `null` = unrestricted (all clients that pass upstream gates may pull). */
export function resolveExternalDataPullAllowlist(): ReadonlySet<string> | null {
  return parseAllowlistFromEnv(process.env.EXTERNAL_DATA_PULL_CLIENT_IDS)
}

export function isExternalDataPullUnrestricted(): boolean {
  return resolveExternalDataPullAllowlist() === null
}

export function isClientAllowedForExternalDataPull(clientId: string): boolean {
  const allowlist = resolveExternalDataPullAllowlist()
  if (allowlist === null) return true
  if (typeof clientId !== 'string' || clientId.trim().length === 0) return false
  return allowlist.has(normalizeClientId(clientId))
}

export function filterClientIdsForExternalDataPull(clientIds: readonly string[]): string[] {
  const allowlist = resolveExternalDataPullAllowlist()
  if (allowlist === null) return [...clientIds]
  return clientIds.filter((id) => allowlist.has(normalizeClientId(id)))
}

export function filterRowsWithId<T extends { id: string }>(rows: readonly T[]): T[] {
  const allowlist = resolveExternalDataPullAllowlist()
  if (allowlist === null) return [...rows]
  return rows.filter((row) => allowlist.has(normalizeClientId(row.id)))
}

export function filterRowsWithClientId<T extends { client_id: string }>(rows: readonly T[]): T[] {
  const allowlist = resolveExternalDataPullAllowlist()
  if (allowlist === null) return [...rows]
  return rows.filter((row) => allowlist.has(normalizeClientId(row.client_id)))
}

export function filterRowsWithClientIdCamel<T extends { clientId: string }>(rows: readonly T[]): T[] {
  const allowlist = resolveExternalDataPullAllowlist()
  if (allowlist === null) return [...rows]
  return rows.filter((row) => allowlist.has(normalizeClientId(row.clientId)))
}

/** Roster split for cron summaries. `skippedCount` is rows dropped, never names. */
export function partitionExternalDataPull<T>(
  rows: readonly T[],
  clientIdOf: (row: T) => string,
): { kept: T[]; skippedCount: number } {
  const allowlist = resolveExternalDataPullAllowlist()
  if (allowlist === null) return { kept: [...rows], skippedCount: 0 }
  const kept: T[] = []
  let skippedCount = 0
  for (const row of rows) {
    const id = clientIdOf(row)
    if (typeof id === 'string' && allowlist.has(normalizeClientId(id))) kept.push(row)
    else skippedCount += 1
  }
  return { kept, skippedCount }
}