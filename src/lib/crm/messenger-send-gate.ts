/**
 * Messenger 发送前的拒联安全闸。
 *
 * 真正的拒联判决仍由 `dnc.ts` 统一维护；私信正文尚未经过可靠语义判定时，
 * 复用 #1037 的人工复核信号，只阻断发送，不自动写永久 DNC。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isDoNotContact, type DncTouch } from '@/lib/crm/dnc'
import { pickStopSignals, type InboundDm } from '@/lib/crm/messenger-stop-signal'
import { fetchAll } from '@/lib/supabase-paginate'

export type MessengerSendGateResult =
  | { kind: 'allow' }
  | { kind: 'do_not_contact' }
  | { kind: 'review_required'; quote: string }
  | { kind: 'unknown' }

interface TouchRow {
  id: string
  occurred_at: string
  source: string | null
  metadata: Record<string, unknown> | null
}

interface MessageRow {
  id: string
  body: string | null
  sent_at: string
}

function newest(a: string | undefined, b: string): string {
  if (!a) return b
  const at = new Date(a).getTime()
  const bt = new Date(b).getTime()
  if (Number.isNaN(at)) return b
  return Number.isNaN(bt) || at >= bt ? a : b
}

export function evaluateMessengerSendGate(input: {
  clientId: string
  contactId: string
  contactFlag: boolean
  touches: TouchRow[]
  inboundMessages: MessageRow[]
}): MessengerSendGateResult {
  const dncTouches: DncTouch[] = input.touches.map((t) => ({
    outcome: (t.metadata?.outcome as string | undefined) ?? null,
    flagged: t.metadata?.do_not_contact === true,
    occurredAt: t.occurred_at,
  }))

  if (isDoNotContact(input.contactFlag, dncTouches)) return { kind: 'do_not_contact' }

  let lastHumanTouchAt: string | undefined
  for (const touch of input.touches) {
    if (touch.source === 'me_manual') {
      lastHumanTouchAt = newest(lastHumanTouchAt, touch.occurred_at)
    }
  }

  const messages: InboundDm[] = input.inboundMessages.map((m) => ({
    clientId: input.clientId,
    contactId: input.contactId,
    body: m.body ?? '',
    sentAt: m.sent_at,
  }))
  const result = pickStopSignals({
    messages,
    dnc: new Map([[input.contactId, { flag: input.contactFlag, touches: dncTouches }]]),
    lastHumanTouchAt: lastHumanTouchAt
      ? new Map([[input.contactId, lastHumanTouchAt]])
      : new Map(),
    maxPerClient: 1,
  })

  const signal = result.signals[0]
  return signal ? { kind: 'review_required', quote: signal.quote } : { kind: 'allow' }
}

/**
 * 只读加载安全闸所需事实。任何一块读不全都返回 unknown，由发送端 fail-closed。
 */
export async function loadMessengerSendGate(
  supabase: SupabaseClient,
  input: { clientId: string; contactId: string; conversationId: string },
): Promise<MessengerSendGateResult> {
  try {
    const [contact, touches, messages] = await Promise.all([
      supabase
        .from('contacts')
        .select('do_not_contact')
        .eq('id', input.contactId)
        .eq('client_id', input.clientId)
        .maybeSingle<{ do_not_contact: boolean | null }>(),
      fetchAll<TouchRow>((from, to) =>
        supabase
          .from('contact_touchpoints')
          .select('id, occurred_at, source, metadata')
          .eq('client_id', input.clientId)
          .eq('contact_id', input.contactId)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAll<MessageRow>((from, to) =>
        supabase
          .from('conversation_messages')
          .select('id, body, sent_at')
          .eq('conversation_id', input.conversationId)
          .eq('direction', 'inbound')
          .order('id', { ascending: true })
          .range(from, to),
      ),
    ])

    if (contact.error || !contact.data) return { kind: 'unknown' }
    return evaluateMessengerSendGate({
      ...input,
      contactFlag: contact.data.do_not_contact === true,
      touches,
      inboundMessages: messages,
    })
  } catch {
    return { kind: 'unknown' }
  }
}
