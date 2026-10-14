import { daysBetween } from '@/lib/ledger/walk'
import { isClosedTitle, parseDescription } from './parse-event'
import {
  MAX_EVENTS_PER_RUN,
  WINDOW_DAYS,
  STALE_LOOKBACK_DAYS,
  type CalendarEvent,
  type ClassifyOutput,
  type EventDecision,
  type EventTier,
} from './types'

export interface LedgerCardView {
  id: string
  status: 'decided' | 'done' | 'verified' | 'failed'
  verifiedRef: string | null
}

export interface ClassifyInput {
  events: readonly CalendarEvent[]
  cards: ReadonlyMap<string, LedgerCardView>
  /** ledger card ids for which the ledger lane will TODAY already raise a PM-visible todo; computed by the caller */
  coveredLedgerIds: ReadonlySet<string>
  todayNz: string // YYYY-MM-DD, New Zealand date
}

/**
 * Tiers that count against MAX_EVENTS_PER_RUN: only the ones that cost a probe / a human look.
 * no_ledger events are aggregated into one todo later and cost nothing, so they are never deferred
 * (otherwise a pile of old ledger-less events starves the ledger-linked ones — seen in the 2026-10-08 trial).
 */
function isLimited(tier: EventTier): boolean {
  return tier === 'auto' || tier === 'human'
}

/** Decide a single in-window event, independently of every other event. */
function decideEvent(
  event: CalendarEvent,
  overdueDays: number,
  input: ClassifyInput,
): EventDecision {
  const base = {
    eventId: event.id,
    title: event.title,
    htmlLink: event.htmlLink,
    dueNz: event.startNz,
    overdueDays,
  }

  // (a) title already marked closed
  if (isClosedTitle(event.title)) {
    return {
      ...base,
      tier: 'closed',
      ledgerId: null,
      probe: null,
      reason: '标题已标记闭环',
    }
  }

  const parsed = parseDescription(event.description)

  // (b) no usable ledger-id (missing / malformed / ambiguous)
  if (parsed.ambiguous || parsed.ledgerId === null) {
    return {
      ...base,
      tier: 'no_ledger',
      ledgerId: null,
      probe: null,
      reason: parsed.reason ?? '没有 ledger-id',
    }
  }

  const ledgerId = parsed.ledgerId

  // (c) card not in the ledger
  const card = input.cards.get(ledgerId)
  if (card === undefined) {
    return {
      ...base,
      tier: 'no_ledger',
      ledgerId,
      probe: null,
      reason: '台账里没有这张卡',
    }
  }

  // (d) card already closed
  if (card.status === 'verified') {
    return {
      ...base,
      tier: 'closed',
      ledgerId,
      probe: null,
      reason: '台账卡已 verified',
    }
  }
  if (card.status === 'done' && card.verifiedRef !== null) {
    return {
      ...base,
      tier: 'closed',
      ledgerId,
      probe: null,
      reason: '台账卡已有验证证据',
    }
  }

  // (e) ledger lane already raises a PM-visible todo today
  if (input.coveredLedgerIds.has(ledgerId)) {
    return {
      ...base,
      tier: 'covered',
      ledgerId,
      probe: null,
      reason: '台账栏今天已为这张卡出待办',
    }
  }

  // (f) machine-checkable vs. needs a human
  if (parsed.probe !== null) {
    return {
      ...base,
      tier: 'auto',
      ledgerId,
      probe: parsed.probe,
      reason: null,
    }
  }
  return {
    ...base,
    tier: 'human',
    ledgerId,
    probe: null,
    reason: null,
  }
}

/** Stable sort: dueNz ascending, then eventId ascending. */
function compareDecisions(a: EventDecision, b: EventDecision): number {
  if (a.dueNz !== b.dueNz) return a.dueNz < b.dueNz ? -1 : 1
  if (a.eventId !== b.eventId) return a.eventId < b.eventId ? -1 : 1
  return 0
}

export function classifyEvents(input: ClassifyInput): ClassifyOutput {
  const decisions: EventDecision[] = []
  let staleOpen = 0

  for (const event of input.events) {
    const d = daysBetween(event.startNz, input.todayNz)
    if (d < 0 || d > STALE_LOOKBACK_DAYS) continue
    if (d > WINDOW_DAYS) {
      // 超出逐条核对窗口的旧事项：只数「还没闭环」的个数，让它们不会悄悄消失
      const tier = decideEvent(event, d, input).tier
      if (tier !== 'closed' && tier !== 'covered') staleOpen += 1
      continue
    }
    decisions.push(decideEvent(event, d, input))
  }

  const candidates = decisions.length

  const limited = decisions.filter((decision) => isLimited(decision.tier))
  const rest = decisions.filter((decision) => !isLimited(decision.tier))

  limited.sort(compareDecisions)
  // no_ledger 排在 closed/covered 前面
  rest.sort((a, b) => {
    const rank = (t: EventTier): number => (t === 'no_ledger' ? 0 : 1)
    return rank(a.tier) - rank(b.tier) || compareDecisions(a, b)
  })

  const kept = limited.slice(0, MAX_EVENTS_PER_RUN)
  const deferred = limited.length - kept.length

  return {
    decisions: [...kept, ...rest],
    deferred,
    candidates,
    staleOpen,
  }
}
