/**
 * Shared test kit for write-path tests: a REAL `PageWriteGuard` (real matching,
 * real fail-closed rules) over a tiny table-modelled fake Supabase. Using the
 * real guard means the write-path tests prove "protected page => nothing is
 * written", not merely "the function called a mock".
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createPageWriteGuard,
  resolveActorFromEmail,
  SYSTEM_ACTOR,
  type PageWriteGuard,
} from '../protected-pages'

export interface GateFake {
  client: SupabaseClient
  receipts: Array<Record<string, unknown>>
}

/** `seoConfig` is what `clients.seo_config` holds for the client under test. */
export function gateFake(seoConfig: unknown, opts: { lookupError?: boolean } = {}): GateFake {
  const receipts: Array<Record<string, unknown>> = []
  const fake = {
    from: (table: string) => {
      if (table === 'clients') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                opts.lookupError
                  ? { data: null, error: { message: 'boom' } }
                  : { data: { seo_config: seoConfig }, error: null },
            }),
          }),
        }
      }
      if (table === 'cron_run_logs') {
        return { insert: async (row: Record<string, unknown>) => { receipts.push(row); return { error: null } } }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
  return { client: fake as never as SupabaseClient, receipts }
}

export type TestActor = 'fde' | 'pm' | 'system'

export function realGuard(fake: GateFake, who: TestActor, clientId = 'client-1'): PageWriteGuard {
  const env = { PROTECTED_PAGE_OVERRIDE_EMAILS: 'pm@example.com' }
  const actor =
    who === 'system' ? SYSTEM_ACTOR
    : who === 'pm' ? resolveActorFromEmail('PM@example.com ', true, env)
    : resolveActorFromEmail('fde@example.com', true, env)
  return createPageWriteGuard({ supabase: fake.client, clientId, actor, route: 'test' })
}
