import type { TouchpointLike } from '../segments'
import type { ReturningLead } from '../returning-lead'

/** TouchpointLike plus optional hints the caller's reader can fill in. All extras are optional. */
export interface HardFactsTouchpoint extends TouchpointLike {
  /** Sender address / id, only used by the injected isOwnStaffSender predicate. */
  senderAddress?: string | null
  /** Staff stage-change note or other internal note the customer never saw. */
  internalNote?: boolean
  /** Outbound message written by a chatbot / fixed greeting / AI assistant (not a person). */
  botReply?: boolean
  /** Phone only: seconds of actual talk. undefined = unknown. */
  talkSeconds?: number | null
  /** Phone only: the call hit voicemail / the customer never spoke. */
  voicemail?: boolean
  /** Phone only: our staff promised to send / quote / call back during this call. */
  promise?: boolean
}

export type EventKind = 'in_human' | 'out_human' | 'out_attempt' | 'out_auto' | 'engagement' | 'note'
export type EventSub = 'message' | 'form' | 'missed_call' | 'call_talk' | 'logged_contact' | 'other'

/** One touchpoint normalised into who-did-what. */
export interface HardFactEvent {
  at: string          // ISO timestamp (as given)
  kind: EventKind
  sub: EventSub
  channel: string
  promise?: boolean
}

export type WhoIsWaiting = 'customer_waiting_on_us' | 'we_waiting_on_customer' | 'nobody'

export interface HardFactsOptions {
  /** "Today". */
  now: Date
  /** IANA time zone used to count whole local days. Required (no default). */
  timeZone: string
  /** Inject: true when an INBOUND-stored touchpoint was really sent by our own staff (e.g. a reply stored with the wrong direction). Never hard-code addresses. */
  isOwnStaffSender?: (t: HardFactsTouchpoint) => boolean
  /** Default 30. Our outreach older than this no longer counts as "we are waiting". */
  weWaitingMaxDays?: number
  /** Default 30. A call counts as a real conversation only with at least this many talk seconds. */
  minCallTalkSeconds?: number
}

export interface LastRealHumanMessage {
  direction: 'inbound' | 'outbound'
  at: string
  channel: string
  sub: EventSub
}

export interface EventFacts {
  whoIsWaiting: WhoIsWaiting
  /** ISO timestamp of the event the wait started from, or null when nobody is waiting. */
  waitingSince: string | null
  /** Whole local days from waitingSince to now, or null. */
  waitingDays: number | null
  lastRealHumanMessage: LastRealHumanMessage | null
  consecutiveUnansweredCalls: number
  daysSinceOurLastHumanContactWithNoReply: number | null
  freshNeverContacted: boolean
}

export interface HardFacts extends EventFacts {
  returningEnquirer: boolean
  returning: ReturningLead | null
}

/** Minimal contact shape; ContactLike is assignable to it. */
export interface HardFactsContact {
  touchpoints: readonly HardFactsTouchpoint[]
}
