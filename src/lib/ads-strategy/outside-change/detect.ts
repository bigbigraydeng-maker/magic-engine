/**
 * Compare consecutive stored ad snapshots and keep the budget / new-ad-set / new-ad
 * changes that no finished ME action record explains.
 *
 * Read-only and pure: no network, no database, no client names or client ids.
 * A "consecutive" pair is two stored rows of the same entity in time order.
 * A new ad set or ad is one whose first stored row is later than some other
 * entity's row — the first snapshot of an account has nothing earlier to compare.
 * `history` is snapshots from before the comparison window. An entity already
 * stored there is not new, even when its first row inside the window is later
 * than the window's earliest stamp.
 */

export const OUTSIDE_TAG = 'ME 外改动'
export const OUTSIDE_LOOKBACK_DAYS = 14
export const MATCH_BEFORE_MS = 36 * 60 * 60 * 1000
export const MATCH_AFTER_MS = 2 * 60 * 60 * 1000

const DISAPPEARED_HASH = 'disappeared'
const BUDGET_KEYS = new Set([
  'ads.scale_unit_budget',
  'ads.cut_unit_budget',
  'ads.cut_campaign_budget',
  'ads.adjust_bid',
  'ads.budget_move_plan',
])
const CREATE_KEYS = new Set([
  'ads.create_ad',
  'ads.add_retargeting_adset',
  'ads.swap_creative',
])
const DONE_STATUS = new Set(['succeeded', 'active', 'executed'])
/**
 * ME paused draft ledger rows — not live yet, but still ME-created (not outside Meta edits).
 * `activating`: approved, waiting for Meta to finish creating the entity.
 */
const PENDING_DRAFT_STATUS = new Set(['awaiting_approval', 'blocked', 'rejected', 'activating'])
const ID_KEYS = new Set([
  'entity_id', 'entityId',
  'campaign_id', 'campaignId',
  'adset_id', 'adSetId', 'adsetId',
  'ad_id', 'adId', 'adIds',
])

export interface SnapshotFact {
  level: 'campaign' | 'adset' | 'ad'
  entityId: string
  entityName: string | null
  campaignId: string | null
  adsetId: string | null
  settingsHash: string
  dailyBudgetMinor: number | null
  lifetimeBudgetMinor: number | null
  currency: string | null
  capturedAt: string
}

export interface ActionFact {
  key: string
  occurredAt: string
  ids: string[]
  /** null = the row has no status field (older budget receipts still count). */
  status: string | null
}

export interface OutsideChange {
  kind: 'budget' | 'new_adset' | 'new_ad'
  where: string
  what: string
  capturedAt: string
  entityId: string
}

interface Candidate {
  kind: OutsideChange['kind']
  row: SnapshotFact
  previousCapturedAt: string | null
  what: string
}

export function idsInRecord(value: unknown): string[] {
  const into = new Set<string>()
  walkIds(value, null, into, 0)
  return [...into]
}

function walkIds(value: unknown, key: string | null, into: Set<string>, depth: number): void {
  if (depth > 6 || value == null) return
  if (typeof value === 'string') {
    if (key && ID_KEYS.has(key)) into.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) walkIds(item, key, into, depth + 1)
    return
  }
  if (typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      walkIds(child, childKey, into, depth + 1)
    }
  }
}

export function formatNzWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '时间不明'
  const clock = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  const zone = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    timeZoneName: 'short',
  }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? ''
  return zone ? `${clock} ${zone}` : clock
}

function money(minor: number | null, currency: string | null): string {
  if (minor === null) return '未设'
  const text = minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2)
  return currency ? `${currency} ${text}` : text
}

function budgetWhat(prev: SnapshotFact, next: SnapshotFact): string | null {
  if (!prev.settingsHash || !next.settingsHash) return null
  if (prev.settingsHash === DISAPPEARED_HASH || next.settingsHash === DISAPPEARED_HASH) return null
  if (prev.settingsHash === next.settingsHash || prev.capturedAt === next.capturedAt) return null
  const currency = next.currency ?? prev.currency
  const parts: string[] = []
  if (prev.dailyBudgetMinor !== next.dailyBudgetMinor) {
    parts.push(`每天预算 ${money(prev.dailyBudgetMinor, currency)} → ${money(next.dailyBudgetMinor, currency)}`)
  }
  if (prev.lifetimeBudgetMinor !== next.lifetimeBudgetMinor) {
    parts.push(`总预算 ${money(prev.lifetimeBudgetMinor, currency)} → ${money(next.lifetimeBudgetMinor, currency)}`)
  }
  return parts.length > 0 ? parts.join('，') : null
}

function groups(rows: SnapshotFact[], levels: ReadonlySet<string>): Map<string, SnapshotFact[]> {
  const map = new Map<string, SnapshotFact[]>()
  for (const row of rows) {
    if (!levels.has(row.level) || !row.entityId || !row.settingsHash || row.settingsHash === DISAPPEARED_HASH) continue
    const key = `${row.level}:${row.entityId}`
    const list = map.get(key)
    if (list) list.push(row)
    else map.set(key, [row])
  }
  for (const list of map.values()) list.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  return map
}

function budgetCandidates(rows: SnapshotFact[]): Candidate[] {
  const out: Candidate[] = []
  for (const list of groups(rows, new Set(['campaign', 'adset'])).values()) {
    for (let i = 1; i < list.length; i++) {
      const what = budgetWhat(list[i - 1], list[i])
      if (!what) continue
      out.push({ kind: 'budget', row: list[i], previousCapturedAt: list[i - 1].capturedAt, what })
    }
  }
  return out
}

function earliestStamp(rows: SnapshotFact[]): string | null {
  let min: string | null = null
  for (const row of rows) {
    if (!row.settingsHash || row.settingsHash === DISAPPEARED_HASH) continue
    if (min === null || row.capturedAt < min) min = row.capturedAt
  }
  return min
}

function latestBefore(rows: SnapshotFact[], at: string): string | null {
  let best: string | null = null
  for (const row of rows) {
    if (!row.settingsHash || row.settingsHash === DISAPPEARED_HASH) continue
    if (row.capturedAt < at && (best === null || row.capturedAt > best)) best = row.capturedAt
  }
  return best
}

function newWhat(row: SnapshotFact, kind: 'new_ad' | 'new_adset'): string {
  if (kind === 'new_ad') return '新广告'
  if (row.dailyBudgetMinor === null) return '新广告组'
  return `新广告组，每天预算 ${money(row.dailyBudgetMinor, row.currency)}`
}

function seenBeforeWindow(history: readonly SnapshotFact[]): Set<string> {
  const keys = new Set<string>()
  for (const row of history) {
    if (row.level !== 'adset' && row.level !== 'ad') continue
    if (!row.entityId || !row.settingsHash) continue
    keys.add(`${row.level}:${row.entityId}`)
  }
  return keys
}

function newCandidates(rows: SnapshotFact[], history: readonly SnapshotFact[]): Candidate[] {
  const firstAt = earliestStamp(rows)
  if (!firstAt) return []
  const already = seenBeforeWindow(history)
  const out: Candidate[] = []
  for (const list of groups(rows, new Set(['adset', 'ad'])).values()) {
    const first = list[0]
    if (!first || already.has(`${first.level}:${first.entityId}`)) continue
    if (first.capturedAt <= firstAt) continue
    const kind = first.level === 'ad' ? 'new_ad' : 'new_adset'
    out.push({ kind, row: first, previousCapturedAt: latestBefore(rows, first.capturedAt), what: newWhat(first, kind) })
  }
  return out
}

function namesOf(rows: SnapshotFact[]): Map<string, string> {
  const best = new Map<string, { at: string; name: string }>()
  for (const row of rows) {
    const name = row.entityName?.trim()
    if (!name) continue
    const key = `${row.level}:${row.entityId}`
    const prev = best.get(key)
    if (!prev || row.capturedAt >= prev.at) best.set(key, { at: row.capturedAt, name })
  }
  const out = new Map<string, string>()
  for (const [key, value] of best) out.set(key, value.name)
  return out
}

function whereOf(row: SnapshotFact, names: Map<string, string>): string {
  const self = row.entityName?.trim() || names.get(`${row.level}:${row.entityId}`) || '未命名'
  if (row.level === 'adset') {
    const campaign = row.campaignId ? names.get(`campaign:${row.campaignId}`) : undefined
    return campaign ? `广告组 · ${self}（系列 ${campaign}）` : `广告组 · ${self}`
  }
  if (row.level === 'ad') {
    const adset = row.adsetId ? names.get(`adset:${row.adsetId}`) : undefined
    return adset ? `广告 · ${self}（广告组 ${adset}）` : `广告 · ${self}`
  }
  return `系列 · ${self}`
}

function inWindow(action: ActionFact, previous: string | null, capturedAt: string): boolean {
  const at = Date.parse(action.occurredAt)
  const seen = Date.parse(capturedAt)
  if (!Number.isFinite(at) || !Number.isFinite(seen)) return false
  const prevMs = previous ? Date.parse(previous) : Number.NEGATIVE_INFINITY
  const from = Math.max(seen - MATCH_BEFORE_MS, Number.isFinite(prevMs) ? prevMs : Number.NEGATIVE_INFINITY)
  if (previous && !(at > prevMs)) return false
  return at >= from && at <= seen + MATCH_AFTER_MS
}

function statusExplains(action: ActionFact, createAction: boolean): boolean {
  if (!action.status) return true
  if (DONE_STATUS.has(action.status)) return true
  if (createAction && PENDING_DRAFT_STATUS.has(action.status)) return true
  // Partial create failures can leave entities on Meta; only treat as ME-built when the row
  // carries entity ids — otherwise we cannot tie the receipt to the snapshot and must not
  // suppress the outside-change tag.
  if (createAction && action.status === 'failed' && action.ids.length > 0) return true
  return false
}

function matched(candidate: Candidate, actions: ActionFact[]): boolean {
  const keys = candidate.kind === 'budget' ? BUDGET_KEYS : CREATE_KEYS
  return actions.some((action) => {
    if (!keys.has(action.key)) return false
    const createAction = CREATE_KEYS.has(action.key)
    // TODO(Ray): matched() ignores adopted.source today. Rows sourced as manual_meta_adopted
    // (post-hoc adoption of hand-made Meta edits) still count as ME-explained. Decide whether
    // those should be treated as outside changes instead; suggested default: mark as ME 外改动.
    if (!statusExplains(action, createAction)) return false
    if (!action.ids.includes(candidate.row.entityId)) return false
    return inWindow(action, candidate.previousCapturedAt, candidate.row.capturedAt)
  })
}

export function detectOutsideChanges(
  snapshots: SnapshotFact[],
  actions: ActionFact[],
  history: readonly SnapshotFact[] = [],
): OutsideChange[] {
  const names = namesOf(snapshots)
  const open = [...budgetCandidates(snapshots), ...newCandidates(snapshots, history)]
    .filter((candidate) => !matched(candidate, actions))
  open.sort((a, b) => b.row.capturedAt.localeCompare(a.row.capturedAt) || a.row.entityId.localeCompare(b.row.entityId))
  return open.map((candidate) => ({
    kind: candidate.kind,
    where: whereOf(candidate.row, names),
    what: candidate.what,
    capturedAt: candidate.row.capturedAt,
    entityId: candidate.row.entityId,
  }))
}
