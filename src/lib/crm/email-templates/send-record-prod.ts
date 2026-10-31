/** The real receipt writer + workflow wake-up for `recordSendAttempt`. Never throws. */

import { emitSendAttempted } from '@/lib/inngest/crm-email-events'
import { supabaseAdmin } from '@/lib/supabase'
import { insertReceipt } from './receipt-store'
import { recordSendAttempt, type RecordArgs } from './send-record'

export function recordSendAttemptProd(args: RecordArgs): Promise<void> {
  return recordSendAttempt(
    {
      insert: (receipt) => insertReceipt(supabaseAdmin, receipt),
      emit: (receipt) => emitSendAttempted(receipt),
    },
    args,
  )
}
