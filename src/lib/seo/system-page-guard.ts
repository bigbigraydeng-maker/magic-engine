/**
 * Guard factory for non-human writers (Kernel capabilities, cron). Kept out of
 * `protected-pages.ts` and out of `capabilities/` because it needs the service
 * client, which `capabilities/` may not import directly.
 *
 * The SYSTEM actor is never a PM, so a protected page is always refused.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { createPageWriteGuard, SYSTEM_ACTOR, type PageWriteGuard } from './protected-pages'

export function systemPageGuard(clientId: string, route: string): PageWriteGuard {
  return createPageWriteGuard({ supabase: supabaseAdmin, clientId, actor: SYSTEM_ACTOR, route })
}
