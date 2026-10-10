/**
 * One place that hands the knowledge module's write paths a service-role
 * Supabase client.
 *
 * Why a helper instead of a type assertion at each route: `supabaseAdmin` is a
 * genuine `SupabaseClient`, and it really does implement every method
 * `KnowledgeWriteClient` declares — but supabase-js's generic chain is deep
 * enough that `tsc` gives up on the structural comparison with "excessively
 * deep" rather than accepting it (the same limitation `read.ts`,
 * `mining.ts` and the confirmers route already document). Doing the widening
 * once, here, means there is exactly ONE line in the codebase to audit for
 * this, instead of one per route that grows silently over time.
 *
 * Evidence the shape is right, not assumed: every column and method used
 * through this client is replayed against a real local Postgres sandbox by
 * `scripts/knowledge-confirmation-probes.sql`, and the unit tests drive the
 * same call chains through a fake that models PostgREST's real behaviour
 * (insert/update without `.select()` → `data: null`; unique violation →
 * `error.code === '23505'`, not a throw).
 */

import { supabaseAdmin } from '@/lib/supabase'
import type { KnowledgeWriteClient } from './write-client'

export function knowledgeWriteClient(): KnowledgeWriteClient {
  const client: unknown = supabaseAdmin
  return client as KnowledgeWriteClient
}
