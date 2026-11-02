import type {
  ExemptIdLoader,
  FrequencySources,
  FrequencyVerdict,
  OutboundItem,
  OutboundSource,
  SourceResult,
} from './types'

export const DEDUPE_WINDOW_MS = 120_000
export const DEFAULT_BUDGET_MS = 25_000

const DAY_MS = 86_400_000
const FUTURE_TOLERANCE_MS = 5 * 60_000

/** Trim, collapse whitespace, lower-case, strip leading re:/fw:/fwd: prefixes. */
export function normalizeSubjectForDedupe(subject: string | null): string {
  if (subject === null) return ''
  let s = subject.trim().replace(/\s+/g, ' ').toLowerCase()
  // Strip any number of leading reply/forward prefixes.
  let prev = ''
  while (prev !== s) {
    prev = s
    s = s.replace(/^(re|fw|fwd)\s*:\s*/, '')
  }
  return s.trim()
}

function parseAt(at: string): number | null {
  const t = Date.parse(at)
  return Number.isNaN(t) ? null : t
}

// These sources hold ONE record per mail by construction (a mailbox lists each sent mail once, every send writes one
// audit row, every campaign is its own id). Two of their records are therefore two mails unless they carry the same id —
// "same minute, same subject" must never fold two real mails into one, because folding can only UNDER-count.
const ONE_RECORD_PER_MAIL: ReadonlySet<OutboundSource> = new Set(['sent_items', 'audit', 'mailchimp'])
// The mailbox and our audit rows use the same id space (Graph immutable ids): equal = the same mail, different = not.
const GRAPH_ID_SOURCES: ReadonlySet<OutboundSource> = new Set(['sent_items', 'audit'])

function sameMessage(a: OutboundItem, b: OutboundItem): boolean {
  if (a.id !== null && b.id !== null && a.id === b.id) return true
  if (a.id !== null && b.id !== null && GRAPH_ID_SOURCES.has(a.source) && GRAPH_ID_SOURCES.has(b.source)) return false
  if (a.source === b.source && ONE_RECORD_PER_MAIL.has(a.source)) return false
  if (a.address.toLowerCase() !== b.address.toLowerCase()) return false
  const ta = parseAt(a.at)
  const tb = parseAt(b.at)
  if (ta === null || tb === null) return false
  if (Math.abs(ta - tb) > DEDUPE_WINDOW_MS) return false
  const sa = normalizeSubjectForDedupe(a.subject)
  const sb = normalizeSubjectForDedupe(b.subject)
  if (sa === '' || sb === '') return true
  return sa === sb
}

/** Collapse duplicate reports of the same message; keep earliest representative, sort ascending by at. */
export function dedupeItems(items: readonly OutboundItem[]): OutboundItem[] {
  const kept: OutboundItem[] = []
  for (const item of items) {
    const dup = kept.find((k) => sameMessage(k, item))
    if (!dup) kept.push(item)
  }
  return kept.sort((a, b) => {
    const ta = parseAt(a.at)
    const tb = parseAt(b.at)
    if (ta === null && tb === null) return 0
    if (ta === null) return 1
    if (tb === null) return -1
    return ta - tb
  })
}

/** ISO time at which the count first drops below the cap. */
export function nextAllowedAt(
  items: readonly OutboundItem[],
  cap: { max: number; windowDays: number },
): string {
  const sorted = dedupeItems(items)
  const count = sorted.length
  const idx = count - cap.max
  const anchor = sorted[Math.max(0, Math.min(idx, count - 1))]
  const t = parseAt(anchor.at)
  const base = t === null ? Date.now() : t
  return new Date(base + cap.windowDays * DAY_MS).toISOString()
}

function toError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

async function safeCall(fn: () => Promise<SourceResult>): Promise<SourceResult> {
  try {
    return await fn()
  } catch (err) {
    return { ok: false, error: toError(err) }
  }
}

type IdsResult = { ok: true; ids: readonly string[] } | { ok: false; error: string }

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

async function safeIds(load: ExemptIdLoader | undefined, sinceIso: string): Promise<IdsResult> {
  if (load === undefined) return { ok: true, ids: [] }
  try {
    const ids: unknown = await load(sinceIso)
    if (!isStringList(ids)) return { ok: false, error: 'exempt ids: the lookup did not return a list of ids' }
    return { ok: true, ids }
  } catch (err) {
    return { ok: false, error: `exempt ids: ${toError(err)}` }
  }
}

function filterItems(
  items: readonly OutboundItem[],
  addresses: ReadonlySet<string>,
  sinceMs: number,
  nowMs: number,
): OutboundItem[] {
  const upper = nowMs + FUTURE_TOLERANCE_MS
  return items.filter((item) => {
    if (!addresses.has(item.address.toLowerCase())) return false
    const t = parseAt(item.at)
    if (t === null) return true // conservative: unparsable counts
    return t >= sinceMs && t <= upper
  })
}

interface Collected {
  ok: true
  items: OutboundItem[]
  exemptIds: Set<string>
}

interface Failed {
  ok: false
  error: string
}

async function collect(
  args: {
    addresses: readonly string[]
    contactId: string
    sinceIso: string
    sources: FrequencySources
    loadExemptIds: ExemptIdLoader | undefined
  },
): Promise<Collected | Failed> {
  const { addresses, contactId, sinceIso, sources, loadExemptIds } = args
  const [sent, audit, touch, mail, exempt] = await Promise.all([
    safeCall(() => sources.sentItems(addresses, sinceIso)),
    safeCall(() => sources.audit(contactId, sinceIso)),
    safeCall(() => sources.touchpoints(contactId, sinceIso)),
    safeCall(() => sources.mailchimp(addresses, sinceIso)),
    safeIds(loadExemptIds, sinceIso),
  ])
  const results: SourceResult[] = [sent, audit, touch, mail]
  const errors: string[] = []
  const items: OutboundItem[] = []
  for (const r of results) {
    if (r.ok) {
      items.push(...r.items)
    } else {
      errors.push(r.error)
    }
  }
  if (!exempt.ok) errors.push(exempt.error)
  if (errors.length > 0) return { ok: false, error: errors.join('; ') }
  return { ok: true, items, exemptIds: new Set(exempt.ok ? exempt.ids : []) }
}

function withTimeout<T>(p: Promise<T>, budgetMs: number): Promise<T | 'timeout'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('timeout'), budgetMs)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

// Leaves out the mails of exempt templates, found by provider message id (the mailbox record, the audit row and the touchpoint of one
// mail carry the same id). De-duplication can fold an unrelated record into the wrong mail, so two readings are worked out and the
// LARGER list wins; then a record folded into the wrong mail can never make the count too small.
//   A: drop the exempt records first, then de-duplicate the rest.
//   B: de-duplicate everything first (the count as it was before exemptions existed), then drop the groups whose representative carries an exempt id.
// A record that carries no id still counts: counting too much can only block a send, counting too little would let the cap be exceeded.
function countWithoutExempt(items: readonly OutboundItem[], exemptIds: ReadonlySet<string>): OutboundItem[] {
  const isExempt = (item: OutboundItem): boolean => item.id !== null && exemptIds.has(item.id)
  const dropFirst = dedupeItems(items.filter((item) => !isExempt(item)))
  const dedupeFirst = dedupeItems(items).filter((item) => !isExempt(item))
  return dropFirst.length >= dedupeFirst.length ? dropFirst : dedupeFirst
}

export async function evaluateFrequency(args: {
  cap: { max: number; windowDays: number }
  now: Date
  addresses: readonly string[]
  contactId: string
  sources: FrequencySources
  budgetMs?: number
  loadExemptIds?: ExemptIdLoader
}): Promise<FrequencyVerdict> {
  const { cap, now, addresses, contactId, sources } = args
  const budgetMs = args.budgetMs ?? DEFAULT_BUDGET_MS
  const nowMs = now.getTime()
  const sinceMs = nowMs - cap.windowDays * DAY_MS
  const sinceIso = new Date(sinceMs).toISOString()

  const collected = await withTimeout(
    collect({ addresses, contactId, sinceIso, sources, loadExemptIds: args.loadExemptIds }),
    budgetMs,
  )
  if (collected === 'timeout') {
    return { ok: false, reason: 'frequency_unverifiable', error: 'timeout' }
  }
  if (!collected.ok) {
    return { ok: false, reason: 'frequency_unverifiable', error: collected.error }
  }

  const addressSet = new Set(addresses.map((a) => a.toLowerCase()))
  // Audit rows and touchpoints belong to the contact, not to an address: they count for the primary address.
  const primary = addresses.length > 0 ? addresses[0].toLowerCase() : ''
  const scoped = collected.items.map((item) =>
    item.address === '' && primary !== '' ? { ...item, address: primary } : item,
  )
  const filtered = filterItems(scoped, addressSet, sinceMs, nowMs)
  const items = collected.exemptIds.size === 0 ? dedupeItems(filtered) : countWithoutExempt(filtered, collected.exemptIds)
  const count = items.length

  if (count >= cap.max) {
    return {
      ok: false,
      reason: 'frequency_cap',
      count,
      items,
      nextAllowedAt: nextAllowedAt(items, cap),
    }
  }
  return { ok: true, count, items }
}
