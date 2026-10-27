import type {
  FrequencySources,
  FrequencyVerdict,
  OutboundItem,
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

function sameMessage(a: OutboundItem, b: OutboundItem): boolean {
  if (a.id !== null && b.id !== null && a.id === b.id) return true
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
  },
): Promise<Collected | Failed> {
  const { addresses, contactId, sinceIso, sources } = args
  const [sent, audit, touch, mail] = await Promise.all([
    safeCall(() => sources.sentItems(addresses, sinceIso)),
    safeCall(() => sources.audit(contactId, sinceIso)),
    safeCall(() => sources.touchpoints(contactId, sinceIso)),
    safeCall(() => sources.mailchimp(addresses, sinceIso)),
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
  if (errors.length > 0) return { ok: false, error: errors.join('; ') }
  return { ok: true, items }
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

export async function evaluateFrequency(args: {
  cap: { max: number; windowDays: number }
  now: Date
  addresses: readonly string[]
  contactId: string
  sources: FrequencySources
  budgetMs?: number
}): Promise<FrequencyVerdict> {
  const { cap, now, addresses, contactId, sources } = args
  const budgetMs = args.budgetMs ?? DEFAULT_BUDGET_MS
  const nowMs = now.getTime()
  const sinceMs = nowMs - cap.windowDays * DAY_MS
  const sinceIso = new Date(sinceMs).toISOString()

  const collected = await withTimeout(
    collect({ addresses, contactId, sinceIso, sources }),
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
  const items = dedupeItems(filtered)
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
