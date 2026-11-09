import { detectReturningLead } from '../returning-lead'
import { classifyTouchpoint, normaliseDirection } from './events'
import type {
  EventFacts,
  HardFactEvent,
  HardFacts,
  HardFactsContact,
  HardFactsOptions,
  LastRealHumanMessage,
  WhoIsWaiting,
} from './types'

/** Default maximum age (in whole local days) of our outreach for "we are waiting". */
const DEFAULT_WE_WAITING_MAX_DAYS = 30

const MS_PER_DAY = 86_400_000

/**
 * Milliseconds of the local calendar date (year/month/day in `timeZone`) at UTC midnight.
 * Two timestamps on the same local day yield the same value.
 */
function localDateKey(iso: string | number | Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso))

  let year = 0
  let month = 1
  let day = 1
  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value)
    else if (part.type === 'month') month = Number(part.value)
    else if (part.type === 'day') day = Number(part.value)
  }
  return Date.UTC(year, month - 1, day)
}

/** Whole local calendar days between `fromIso` and `now` in `timeZone`. */
function wholeLocalDays(fromIso: string, now: Date, timeZone: string): number {
  return Math.round((localDateKey(now, timeZone) - localDateKey(fromIso, timeZone)) / MS_PER_DAY)
}

/** Parse an event timestamp to epoch milliseconds. */
function ms(e: HardFactEvent): number {
  return Date.parse(e.at)
}

/** Return the last element of an array, or null when empty. */
function lastOf<T>(items: readonly T[]): T | null {
  return items.length > 0 ? items[items.length - 1] : null
}

interface WaitingResult {
  whoIsWaiting: WhoIsWaiting
  waitingSince: string | null
}

/**
 * Decide who is waiting and since when, based on the last inbound ask,
 * the last outbound human contact, and the last outreach attempt.
 */
function resolveWaiting(
  ins: readonly HardFactEvent[],
  lastOut: HardFactEvent | null,
  lastReach: HardFactEvent | null,
  opts: HardFactsOptions,
): WaitingResult {
  const asks = ins.filter((e) => e.sub !== 'form')
  const lastAsk = lastOf(asks)

  // Case A: the customer asked something after our last human contact.
  if (lastAsk !== null && (lastOut === null || ms(lastAsk) > ms(lastOut))) {
    const firstAfterOut =
      lastOut === null
        ? asks[0]
        : asks.find((e) => ms(e) > ms(lastOut))
    return {
      whoIsWaiting: 'customer_waiting_on_us',
      waitingSince: (firstAfterOut ?? lastAsk).at,
    }
  }

  // Case B: we promised something on a call and did not deliver.
  if (
    lastOut !== null &&
    lastOut.promise === true &&
    (lastReach === null || ms(lastReach) <= ms(lastOut) || lastReach.kind === 'out_attempt')
  ) {
    return { whoIsWaiting: 'customer_waiting_on_us', waitingSince: lastOut.at }
  }

  // Case C: we reached out recently and are waiting for a reply.
  if (lastReach !== null) {
    const maxDays = opts.weWaitingMaxDays ?? DEFAULT_WE_WAITING_MAX_DAYS
    if (wholeLocalDays(lastReach.at, opts.now, opts.timeZone) <= maxDays) {
      return { whoIsWaiting: 'we_waiting_on_customer', waitingSince: lastReach.at }
    }
  }

  // Nobody is waiting.
  return { whoIsWaiting: 'nobody', waitingSince: null }
}

/** True when the event counts as a real human message for `lastRealHumanMessage`. */
function isRealHumanMessage(e: HardFactEvent): boolean {
  if (e.kind === 'out_human') return true
  if (e.kind === 'in_human') {
    return e.sub === 'message' || e.sub === 'form' || e.sub === 'call_talk'
  }
  return false
}

/** True when the event represents a real conversation (used to reset unanswered calls). */
function isConversation(e: HardFactEvent): boolean {
  if (e.sub === 'call_talk' || e.sub === 'logged_contact') return true
  return e.kind === 'in_human' && e.sub === 'message'
}

/** Compute the derived event facts for a list of already-classified events. */
export function computeEventFacts(
  events: readonly HardFactEvent[],
  opts: HardFactsOptions,
): EventFacts {
  const sorted = [...events].sort((a, b) => ms(a) - ms(b))

  const ins = sorted.filter((e) => e.kind === 'in_human')
  const outs = sorted.filter((e) => e.kind === 'out_human')
  const reachOuts = sorted.filter((e) => e.kind === 'out_human' || e.kind === 'out_attempt')
  const lastOut = lastOf(outs)
  const lastReach = lastOf(reachOuts)

  const { whoIsWaiting, waitingSince } = resolveWaiting(ins, lastOut, lastReach, opts)
  const waitingDays =
    waitingSince !== null ? wholeLocalDays(waitingSince, opts.now, opts.timeZone) : null

  const lastRealEvent = lastOf(sorted.filter(isRealHumanMessage))
  const lastRealHumanMessage: LastRealHumanMessage | null =
    lastRealEvent === null
      ? null
      : {
          direction: lastRealEvent.kind === 'in_human' ? 'inbound' : 'outbound',
          at: lastRealEvent.at,
          channel: lastRealEvent.channel,
          sub: lastRealEvent.sub,
        }

  const lastConversation = lastOf(sorted.filter(isConversation))
  const consecutiveUnansweredCalls = sorted.filter(
    (e) =>
      e.kind === 'out_attempt' &&
      e.channel === 'phone' &&
      (lastConversation === null || ms(e) > ms(lastConversation)),
  ).length

  const asks = ins.filter((e) => e.sub !== 'form')
  let daysSinceOurLastHumanContactWithNoReply: number | null = null
  if (lastOut !== null) {
    const repliedAfter = asks.some((e) => ms(e) > ms(lastOut))
    if (!repliedAfter) {
      daysSinceOurLastHumanContactWithNoReply = wholeLocalDays(lastOut.at, opts.now, opts.timeZone)
    }
  }

  const freshNeverContacted = ins.length > 0 && reachOuts.length === 0

  return {
    whoIsWaiting,
    waitingSince,
    waitingDays,
    lastRealHumanMessage,
    consecutiveUnansweredCalls,
    daysSinceOurLastHumanContactWithNoReply,
    freshNeverContacted,
  }
}

/** Classify a contact's touchpoints and compute all hard facts, including returning-lead info. */
export function computeHardFacts(contact: HardFactsContact, opts: HardFactsOptions): HardFacts {
  const events: HardFactEvent[] = []
  for (const t of contact.touchpoints) {
    const classified = classifyTouchpoint(t, opts)
    if (classified !== null) events.push(classified)
  }

  const base = computeEventFacts(events, opts)

  const normalised = contact.touchpoints.map((t) => normaliseDirection(t, opts))
  const returning = detectReturningLead(normalised)

  return { ...base, returningEnquirer: returning !== null, returning }
}
