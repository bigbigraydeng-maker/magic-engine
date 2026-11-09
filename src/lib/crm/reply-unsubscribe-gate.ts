/**
 * The unsubscribe check of a REPLY to a guest's own e-mail (CRM conversation reply).
 *
 * The rule (P2-2b, design §16.10): a reply is refused only when the guest unsubscribed from e-mail (ME's link, or a
 * spam complaint about an ME letter) AFTER the latest mail the guest sent in this thread. A guest who unsubscribed and
 * then writes to us again has started the conversation themselves: answering that mail is allowed. The same way the
 * "do not contact" re-engagement works (a guest who comes back clears it), but narrower: nothing is cleared here, the
 * unsubscribe stays on, and only the reply to the guest's newer mail goes out.
 *
 *  - Asked by contact and by every address of that contact (the same address can sit on two contact records).
 *  - A thread linked to no contact cannot be matched to an unsubscribe here (ME stores no address on e-mail threads): it
 *    is not refused. Documented gap; only a guest whose new thread is not linked to a contact is affected.
 *  - Unreadable = refused.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { readEmailUnsubscribed } from './email-unsubscribe'

export const REPLY_UNSUBSCRIBED_MESSAGE = '这位客人在他最后一封来信之后退订了邮件，这封没有发出。等他再来信就可以回复；打电话不受影响。'
export const REPLY_UNSUBSCRIBE_UNVERIFIABLE_MESSAGE = '暂时查不到他有没有退订邮件，先别发，稍后再试。'

export type ReplyUnsubscribeGate =
  | { blocked: false }
  | { blocked: true; status: 409; reason: 'email_unsubscribed'; error: string }
  | { blocked: true; status: 503; reason: 'unsubscribe_unverifiable'; error: string }

const UNVERIFIABLE: ReplyUnsubscribeGate = {
  blocked: true,
  status: 503,
  reason: 'unsubscribe_unverifiable',
  error: REPLY_UNSUBSCRIBE_UNVERIFIABLE_MESSAGE,
}

async function contactAddresses(db: SupabaseClient, clientId: string, contactId: string): Promise<string[] | null> {
  const [contact, identities] = await Promise.all([
    db.from('contacts').select('primary_email').eq('id', contactId).eq('client_id', clientId).maybeSingle(),
    db.from('contact_identities').select('value').eq('contact_id', contactId).eq('client_id', clientId).eq('kind', 'email'),
  ])
  if (contact.error || identities.error) return null
  const primary = (contact.data as { primary_email: string | null } | null)?.primary_email ?? null
  const others = ((identities.data as Array<{ value: string }> | null) ?? []).map((r) => r.value)
  return primary === null ? others : [primary, ...others]
}

export async function checkReplyUnsubscribe(
  args: { clientId: string; contactId: string | null; lastInboundAt: string | null },
  deps: { db?: SupabaseClient } = {},
): Promise<ReplyUnsubscribeGate> {
  if (args.contactId === null) return { blocked: false }
  const db = deps.db ?? supabaseAdmin
  try {
    const addresses = await contactAddresses(db, args.clientId, args.contactId)
    if (addresses === null) return UNVERIFIABLE
    // No time for the guest's latest mail: any unsubscribe refuses the reply (the cautious reading).
    const opts = args.lastInboundAt === null ? {} : { after: args.lastInboundAt }
    const read = await readEmailUnsubscribed(db, args.clientId, { contactId: args.contactId, addresses }, opts)
    if (!read.ok) return UNVERIFIABLE
    if (read.unsubscribed) return { blocked: true, status: 409, reason: 'email_unsubscribed', error: REPLY_UNSUBSCRIBED_MESSAGE }
    return { blocked: false }
  } catch {
    return UNVERIFIABLE
  }
}
