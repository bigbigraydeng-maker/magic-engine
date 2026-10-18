/**
 * Pure classifier for inbound WhatsApp Cloud API webhook payloads.
 *
 * This module exists so the routing decisions in
 * `app/api/webhooks/whatsapp/route.ts` can be reasoned about (and tested)
 * without a database, a signature, or a network. It performs NO IO and imports
 * nothing but types — every branch here is a pure function of its input.
 *
 * The interface shapes below are re-declared (and exported) so this module is
 * self-contained; they mirror the ones in the route file exactly.
 */

export interface WhatsAppReferral {
  source_url?: string
  source_id?: string
  source_type?: string
  headline?: string
  body?: string
  ctwa_clid?: string
}

export interface WhatsAppMedia {
  id?: string
  mime_type?: string
  sha256?: string
  caption?: string
  filename?: string
}

export interface WhatsAppInboundMessage {
  id?: string
  from?: string
  timestamp?: string
  type?: string
  text?: { body?: string }
  referral?: WhatsAppReferral
  image?: WhatsAppMedia
  video?: WhatsAppMedia
  audio?: WhatsAppMedia
  document?: WhatsAppMedia
  sticker?: WhatsAppMedia
}

/** A message the business itself sent, echoed back by Meta (smb_message_echoes). */
export interface WhatsAppEcho {
  from?: string
  to?: string
  id?: string
  timestamp?: string
  type?: string
  text?: { body?: string }
  image?: WhatsAppMedia
  video?: WhatsAppMedia
  audio?: WhatsAppMedia
  document?: WhatsAppMedia
  sticker?: WhatsAppMedia
}

/** A delivery/read receipt for a message we sent. */
export interface WhatsAppStatus {
  id?: string
  status?: string
  timestamp?: string
  recipient_id?: string
  errors?: Array<{ code?: number | string; title?: string }>
}

export interface HistoryMessage {
  from?: string
  to?: string
  id?: string
  timestamp?: string
  type?: string
  history_context?: { status?: string }
}

export interface HistoryThread {
  id?: string
  messages?: HistoryMessage[]
}

export interface HistoryChunk {
  metadata?: {
    phase?: number | string
    chunk_order?: number | string
    progress?: number | string
  }
  threads?: HistoryThread[]
}

export type InboundChange =
  | {
      kind: 'customer_messages'
      phoneNumberId: string
      contactName?: string
      messages: WhatsAppInboundMessage[]
    }
  | {
      kind: 'echoes'
      phoneNumberId: string
      displayNumber?: string
      echoes: WhatsAppEcho[]
    }
  | {
      kind: 'statuses'
      phoneNumberId: string
      statuses: WhatsAppStatus[]
    }
  | {
      kind: 'history'
      phoneNumberId: string
      displayNumber?: string
      itemCount: number
      chunks: HistoryChunk[]
      mediaFollowUps: number
    }
  | { kind: 'ignored'; field: string }
  | {
      kind: 'malformed'
      field: string
      reason: 'bad_phone_number_id' | 'wrong_array_for_field'
    }

/** A plain object: not null, not an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Keep only the plain-object elements of an array. */
function plainObjectsOnly(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter(isPlainObject)
}

/** A non-empty array of plain objects, or null when it is not one. */
function nonEmptyObjectArray(value: unknown): Record<string, unknown>[] | null {
  const items = plainObjectsOnly(value)
  return items.length > 0 ? items : null
}

const PHONE_NUMBER_ID_RE = /^[0-9]{1,32}$/

/** The change's `field`, defaulting to 'messages' when absent (legacy tolerance). */
function readField(change: Record<string, unknown>): string | null {
  if (!('field' in change) || change.field === undefined) return 'messages'
  if (typeof change.field === 'string') return change.field
  return null
}

/** Extract a valid phone_number_id + optional display number, or null. */
function readMetadata(
  value: Record<string, unknown>,
): { phoneNumberId: string; displayNumber?: string } | null {
  const metadata = value.metadata
  if (!isPlainObject(metadata)) return null
  const phoneNumberId = metadata.phone_number_id
  if (typeof phoneNumberId !== 'string' || !PHONE_NUMBER_ID_RE.test(phoneNumberId)) return null
  const displayNumber =
    typeof metadata.display_phone_number === 'string' ? metadata.display_phone_number : undefined
  return { phoneNumberId, displayNumber }
}

/** Classify a single change object. Returns [] when it should be skipped. */
function classifyChange(change: Record<string, unknown>): InboundChange[] {
  const field = readField(change)
  if (field === null) {
    return [{ kind: 'ignored', field: String(typeof change.field) }]
  }

  const value = change.value
  if (!isPlainObject(value)) return []

  const meta = readMetadata(value)
  if (!meta) {
    return [{ kind: 'malformed', field, reason: 'bad_phone_number_id' }]
  }

  const { phoneNumberId, displayNumber } = meta

  if (field === 'messages') return classifyMessagesField(value, phoneNumberId, displayNumber, field)
  if (field === 'smb_message_echoes') return classifyEchoesField(value, phoneNumberId, displayNumber, field)
  if (field === 'history') return classifyHistoryField(value, phoneNumberId, displayNumber)

  return [{ kind: 'ignored', field }]
}

/** field === 'messages': customer messages and/or statuses, plus cross-field guards. */
function classifyMessagesField(
  value: Record<string, unknown>,
  phoneNumberId: string,
  displayNumber: string | undefined,
  field: string,
): InboundChange[] {
  const out: InboundChange[] = []

  const messages = nonEmptyObjectArray(value.messages)
  if (messages) {
    const contacts = plainObjectsOnly(value.contacts)
    const profile = contacts[0]?.profile
    const contactName =
      isPlainObject(profile) && typeof profile.name === 'string' ? profile.name : undefined
    out.push({
      kind: 'customer_messages',
      phoneNumberId,
      ...(contactName !== undefined ? { contactName } : {}),
      messages: messages as WhatsAppInboundMessage[],
    })
  }

  const statuses = nonEmptyObjectArray(value.statuses)
  if (statuses) {
    out.push({
      kind: 'statuses',
      phoneNumberId,
      statuses: statuses as WhatsAppStatus[],
    })
  }

  // message_echoes / history under 'messages' are never customer messages.
  if (nonEmptyObjectArray(value.message_echoes) || nonEmptyObjectArray(value.history)) {
    out.push({ kind: 'malformed', field, reason: 'wrong_array_for_field' })
  }

  return out
}

/** field === 'smb_message_echoes': echoes only; messages/statuses are not processed. */
function classifyEchoesField(
  value: Record<string, unknown>,
  phoneNumberId: string,
  displayNumber: string | undefined,
  field: string,
): InboundChange[] {
  const out: InboundChange[] = []

  const echoes = nonEmptyObjectArray(value.message_echoes)
  if (echoes) {
    out.push({
      kind: 'echoes',
      phoneNumberId,
      ...(displayNumber !== undefined ? { displayNumber } : {}),
      echoes: echoes as WhatsAppEcho[],
    })
  }

  if (nonEmptyObjectArray(value.messages) || nonEmptyObjectArray(value.statuses)) {
    out.push({ kind: 'malformed', field, reason: 'wrong_array_for_field' })
  }

  return out
}

/** field === 'history': itemCount = history[] + messages[] (media follow-up). */
function classifyHistoryField(
  value: Record<string, unknown>,
  phoneNumberId: string,
  displayNumber: string | undefined,
): InboundChange[] {
  const historyItems = plainObjectsOnly(value.history)
  // A declined share ("history sharing turned off") is `history:[{errors:[…]}]` with no
  // threads: there is no data in it to lose, so it must not be refused forever.
  const withData = historyItems.filter((item) => !('errors' in item) || Array.isArray(item.threads))
  const declinedOnly = historyItems.length > 0 && withData.length === 0
  const messagesCount = plainObjectsOnly(value.messages).length
  const itemCount = withData.length + messagesCount
  if (itemCount === 0) {
    return declinedOnly ? [{ kind: 'ignored', field: 'history_declined' }] : []
  }
  // Only chunks that actually carry threads are forwarded; deeper validation is the
  // intake module's job.
  const chunks = withData.filter((item) => Array.isArray(item.threads)) as HistoryChunk[]
  return [
    {
      kind: 'history',
      phoneNumberId,
      ...(displayNumber !== undefined ? { displayNumber } : {}),
      itemCount,
      chunks,
      mediaFollowUps: messagesCount,
    },
  ]
}

/**
 * Classify every change in a webhook payload, in encounter order.
 *
 * Never throws: anything that is not a recognisable shape is skipped, and a
 * change that cannot be routed is reported as `malformed` or `ignored` rather
 * than dropped silently.
 */
export function classifyInboundChanges(payload: unknown): InboundChange[] {
  if (!isPlainObject(payload)) return []
  const entries = payload.entry
  if (!Array.isArray(entries)) return []

  const out: InboundChange[] = []
  for (const entry of entries) {
    if (!isPlainObject(entry)) continue
    const changes = entry.changes
    if (!Array.isArray(changes)) continue
    for (const change of changes) {
      if (!isPlainObject(change)) continue
      out.push(...classifyChange(change))
    }
  }
  return out
}
