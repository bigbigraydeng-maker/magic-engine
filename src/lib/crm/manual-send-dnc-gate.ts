/**
 * Manual-send DNC gate. Manual reply paths (WhatsApp / Messenger / email) used
 * to skip the do-not-contact check entirely. This gate fails closed: any lookup
 * failure blocks the send. The verdict itself is never re-derived here — the
 * single source of truth is isConversationOptedOut() -> lib/crm/dnc.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { isContactOptedOutAnyChannel, isConversationOptedOut } from '@/lib/messenger-agent/optout'

export const DO_NOT_CONTACT_MESSAGE = '这个客人被标成「别再联系」，系统不允许再给他发消息。'
export const DNC_CHECK_FAILED_MESSAGE = '系统暂时查不到这个客人能不能联系，为安全起见这条没有发出。'

export type ManualSendDncGate =
  | { blocked: false }
  | { blocked: true; status: 403; reason: 'do_not_contact'; error: string }
  | { blocked: true; status: 503; reason: 'dnc_check_failed'; error: string }

export interface ManualSendDncDeps {
  supabase?: SupabaseClient
  isOptedOut?: (conversationId: string) => Promise<boolean>
}

export async function checkManualSendDnc(
  clientId: string,
  conversationId: string,
  deps: ManualSendDncDeps = {},
): Promise<ManualSendDncGate> {
  const supabase = deps.supabase ?? supabaseAdmin
  const isOptedOut = deps.isOptedOut ?? ((id: string) => isConversationOptedOut(id, supabase))

  const { data, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) {
    console.error('[crm/manual-send-dnc-gate] ownership lookup failed', conversationId, error.message)
    return { blocked: true, status: 503, reason: 'dnc_check_failed', error: DNC_CHECK_FAILED_MESSAGE }
  }

  if (!data) {
    // The downstream sender already returns 404/403 for a missing or foreign
    // conversation; answering "do not contact" here would leak another client's
    // DNC state.
    return { blocked: false }
  }

  let optedOut: boolean
  try {
    optedOut = await isOptedOut(conversationId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[crm/manual-send-dnc-gate] dnc check failed', conversationId, message)
    return { blocked: true, status: 503, reason: 'dnc_check_failed', error: DNC_CHECK_FAILED_MESSAGE }
  }

  if (optedOut) {
    return { blocked: true, status: 403, reason: 'do_not_contact', error: DO_NOT_CONTACT_MESSAGE }
  }

  return { blocked: false }
}

export interface ManualSendDncContactDeps {
  isOptedOut?: (contactId: string, clientId: string) => Promise<boolean>
}

/**
 * 「第一封」消息用的闸：这时候还没有会话，所以按**联系人**查。
 * 判据与会话版同一份（`optout.ts` 的 `isContactMarkedDoNotContact` → `lib/crm/dnc.ts`），
 * 另外认这个联系人名下任何会话的 `optout_unlinked`。查询失败一律拒发（fail-closed）。
 */
export async function checkManualSendDncForContact(
  clientId: string,
  contactId: string,
  deps: ManualSendDncContactDeps = {},
): Promise<ManualSendDncGate> {
  const isOptedOut = deps.isOptedOut ?? ((cid: string, clid: string) => isContactOptedOutAnyChannel(cid, clid, supabaseAdmin))

  let optedOut: boolean
  try {
    optedOut = await isOptedOut(contactId, clientId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[crm/manual-send-dnc-gate] contact dnc check failed', contactId, message)
    return { blocked: true, status: 503, reason: 'dnc_check_failed', error: DNC_CHECK_FAILED_MESSAGE }
  }

  if (optedOut) {
    return { blocked: true, status: 403, reason: 'do_not_contact', error: DO_NOT_CONTACT_MESSAGE }
  }
  return { blocked: false }
}
