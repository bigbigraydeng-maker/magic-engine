/** Production data for the template preview (same loaders as the real send gates, scoped to one client). */

import type { SendGateData } from './send-gates'
import { createSendGateData } from './send-gates-prod'
import { createMailNewStore, graphGetPage } from '@/lib/microsoft/mail-send-new-prod'
import { supabaseAdmin } from '@/lib/supabase'

export function createPreviewData(clientId: string): SendGateData {
  const store = createMailNewStore()
  return createSendGateData(supabaseAdmin, { clientId, listActiveMailboxes: store.listActiveMailboxes, graphGetPage })
}
