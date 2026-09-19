/** Shapes returned by the Messenger endpoints, as the page consumes them. */

export type IntentLevel = 'high' | 'medium' | 'low' | 'unknown'

export type WindowKind = 'standard' | 'human_agent' | 'closed'

export interface ReplyWindow {
  kind: WindowKind
  msRemaining: number
}

export interface TripDetails {
  tour_interest: string | null
  travel_window: string | null
  party_size: number | null
  departure_city: string | null
  first_time_to_china: boolean | null
  budget_signal: string | null
}

export interface ContactDetails {
  phone: string | null
  email: string | null
}

/** Chinese except draft_reply, which is English and goes to the customer. */
export interface Brief {
  summary: string
  intent_level: IntentLevel
  customer_needs: string[]
  objections: string[]
  promises_made: string[]
  next_action: string | null
  follow_up_due_at: string | null
  risk_flags: string[]
  trip: TripDetails
  contact: ContactDetails
  draft_reply: string | null
  generated_at: string
}

export interface Conversation {
  id: string
  participantName: string | null
  messageCount: number
  lastMessageAt: string | null
  awaitingReply: boolean
  hoursWaiting: number | null
  /** When the AI said to chase this person, ISO. Null when there is no date. */
  followUpDueAt: string | null
  /** That date has passed and nobody has been back to them. */
  followUpOverdue: boolean
  /** Only computed by the list view when the customer spoke last. */
  replyWindow: ReplyWindow | null
  brief: Brief | null
}

export interface ConversationsResponse {
  conversations: Conversation[]
  viewerEmail: string | null
  counts: { total: number; awaitingReply: number; followUpOverdue: number; highIntent: number }
  error?: string
}

export interface ThreadMessage {
  direction: 'inbound' | 'outbound'
  senderName: string | null
  body: string
  sentAt: string
}

export interface ThreadResponse {
  messages: ThreadMessage[]
  replyWindow: ReplyWindow
  error?: string
}

/** One AI-drafted reply still waiting on a human decision (Issue #1588). */
export interface PendingDraft {
  id: string
  draftBody: string
  agentConfidence: number | null
  quotedOfferingNames: string[]
  verifierOutputJson: { ok?: boolean; blocked_reasons?: string[] } | null
  /** Verifier gate ids this draft cleared to reach 'pending'. Empty for a
   *  client whose Verifier policy this endpoint does not (yet) know. */
  passedGateIds: string[]
  createdAt: string
}

export interface DraftsResponse {
  drafts: PendingDraft[]
  error?: string
}
