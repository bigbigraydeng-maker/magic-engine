export type PickMode = 'none' | 'one' | 'many'
export type TemplateStatus = 'active' | 'disabled'
export type FactSource = 'none' | 'published_tours'
export const FACT_SOURCES: readonly FactSource[] = ['none', 'published_tours']

export interface PickFilter {
  destinations?: string[]
  tiers?: string[]
  departureMonths?: number[] // 1..12
}

export interface EmailTemplateVersion {
  id: string
  clientId: string
  templateKey: string
  version: number
  name: string
  subject: string
  body: string
  factSource: FactSource
  pickMode: PickMode
  pickFilter: PickFilter
  status: TemplateStatus
  changeNote: string | null
  createdBy: string
  createdAt: string
}

export interface NewTemplateVersionInput {
  clientId: string
  templateKey: string
  baseVersion: number | null // null = create a brand-new key (version 1)
  name: string
  subject: string
  body: string
  factSource: FactSource
  pickMode: PickMode
  pickFilter: PickFilter
  status: TemplateStatus
  changeNote?: string | null
  createdBy: string
}

export type AppendResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'conflict' | 'invalid' | 'error'; message: string }

export type ReceiptOutcome = 'sent' | 'blocked' | 'failed' | 'unknown'
export type CallBasis = 'none' | 'system_call' | 'staff_attested'

// A receipt NEVER contains an email address or a message body.
export interface SendReceipt {
  clientId: string
  contactId: string
  requestId: string
  actorEmail: string
  templateKey: string | null
  templateVersion: number | null
  catalogVersion: number | null
  callBasis: CallBasis
  outcome: ReceiptOutcome
  blockReason: string | null
  blockDetail: string | null
  mailbox: string | null
  conversationId: string | null
  providerMessageId: string | null
  editedAfterRender: boolean | null
  warnings: string[]
  renderedSha256: string | null
  finalSha256: string | null
}

export interface StoredReceipt extends SendReceipt {
  id: string
  authBasis: 'human_click'
  createdAt: string
}

export interface GuardrailRule {
  id: string
  phrases: string[]
  message: string
  severity: 'block' | 'warn'
}

export interface PublishedToursProviderSettings {
  urlPattern: string // https URL containing {destination}, {tier} and {slug}
  allToursUrl: string // https URL
}

export interface EmailSettings {
  enabled: boolean
  sendMailbox: string | null
  allowUnsolicited: boolean
  footer: string | null
  limits: { perUserPerHour: number; perUserPerDay: number; perMailboxPerDay: number }
  frequencyCap: { max: number; windowDays: number } | null
  recipientAllowlist: string[] | null
  sameTemplateCooldownHours: number
  callPromptHours: number
  guardrails: { allowedLinkHosts: string[]; rules: GuardrailRule[] }
  providers: { publishedTours?: PublishedToursProviderSettings }
}
