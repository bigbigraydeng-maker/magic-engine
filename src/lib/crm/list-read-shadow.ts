/**
 * CRM list "read once until data changes" — slice 2: shadow comparison only.
 *
 * Design: docs/specs/2026-11-16-crm-list-read-once-design-v0.md §3, §6.
 * The database appends one row to `crm_list_change_log` for every committed change to the
 * tables the CRM lists read (migration 20261116100000). The per-client row count is the
 * list version: it only grows, and a write and its log row commit together.
 *
 * This module never changes what a request returns. Each request still reads everything;
 * afterwards we compare a fingerprint of what was read with the fingerprint remembered for
 * the same version. Same version + different rows = a change the log did not record
 * (a table or write path the triggers miss). Slice 3 may only start after zero mismatches.
 *
 * Kill switch: CRM_LIST_SHADOW=off.
 */
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ShadowOutcome = 'first' | 'match' | 'mismatch' | 'version_changed' | 'skipped'

interface Remembered {
  version: number
  rowHashes: Set<string>
  sampleIds: Map<string, string | null>
}

const MEMORY = new Map<string, Remembered>()
const SAMPLE_LIMIT = 5

export function shadowEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.CRM_LIST_SHADOW ?? '').trim().toLowerCase() !== 'off'
}

export function resetListShadowForTests(): void {
  MEMORY.clear()
}

/** Number of change-log rows for this client, or null when it cannot be read (shadow is then skipped). */
export async function readListVersion(sb: SupabaseClient, clientId: string): Promise<number | null> {
  try {
    const { count, error } = await sb
      .from('crm_list_change_log')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
    if (error || typeof count !== 'number') return null
    return count
  } catch {
    return null
  }
}

function rowHash(row: unknown): string {
  return createHash('sha256').update(JSON.stringify(row) ?? 'undefined').digest('hex').slice(0, 24)
}

function rowId(row: unknown): string | null {
  if (row !== null && typeof row === 'object' && 'id' in row) {
    const id = (row as { id: unknown }).id
    return typeof id === 'string' || typeof id === 'number' ? String(id) : null
  }
  return null
}

export interface ShadowResult {
  read: string
  outcome: ShadowOutcome
  version: number | null
  rows: number
  added?: number
  removed?: number
  sampleIds?: Array<string | null>
}

/**
 * Compare one read against what was remembered for the same client + version.
 * `versionBefore` must be read before the data reads start and `versionAfter` after they finish;
 * if they differ a change landed mid-read and the result is neither compared nor remembered.
 */
export function compareShadowRead(
  read: string,
  clientId: string,
  versionBefore: number | null,
  versionAfter: number | null,
  rows: readonly unknown[],
): ShadowResult {
  const base = { read, version: versionBefore, rows: rows.length }
  if (versionBefore === null || versionAfter === null || versionBefore !== versionAfter) {
    return { ...base, outcome: 'skipped' }
  }
  const rowHashes = new Set<string>()
  const sampleIds = new Map<string, string | null>()
  for (const row of rows) {
    const h = rowHash(row)
    rowHashes.add(h)
    sampleIds.set(h, rowId(row))
  }
  const key = `${read}|${clientId}`
  const prev = MEMORY.get(key)
  MEMORY.set(key, { version: versionBefore, rowHashes, sampleIds })
  if (prev === undefined) return { ...base, outcome: 'first' }
  if (prev.version !== versionBefore) return { ...base, outcome: 'version_changed' }

  const added = [...rowHashes].filter((h) => !prev.rowHashes.has(h))
  const removed = [...prev.rowHashes].filter((h) => !rowHashes.has(h))
  if (added.length === 0 && removed.length === 0) return { ...base, outcome: 'match' }
  return {
    ...base,
    outcome: 'mismatch',
    added: added.length,
    removed: removed.length,
    sampleIds: [
      ...added.slice(0, SAMPLE_LIMIT).map((h) => sampleIds.get(h) ?? null),
      ...removed.slice(0, SAMPLE_LIMIT).map((h) => prev.sampleIds.get(h) ?? null),
    ],
  }
}

/**
 * Fire-and-forget: read the version again after the data reads, compare every read, log one line each.
 * Never throws and never delays the response.
 */
export function finishShadowCompare(
  sb: SupabaseClient,
  route: string,
  clientId: string,
  versionBefore: number | null,
  reads: Record<string, readonly unknown[]>,
): void {
  void (async () => {
    try {
      const versionAfter = versionBefore === null ? null : await readListVersion(sb, clientId)
      for (const [name, rows] of Object.entries(reads)) {
        const result = compareShadowRead(`${route}.${name}`, clientId, versionBefore, versionAfter, rows)
        const line = `[crm-list-shadow] ${JSON.stringify({ clientId, ...result })}`
        if (result.outcome === 'mismatch') console.warn(line)
        else console.info(line)
      }
    } catch (err) {
      console.warn('[crm-list-shadow] compare failed', err instanceof Error ? err.message : err)
    }
  })()
}
