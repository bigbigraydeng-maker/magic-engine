/**
 * content_strategy_items — 3D content strategy recommendations (Phase 8.D.1.1)
 *
 * Stores the output of the analyzer (Phase 8.D.1.2). One row = one
 * scored recommendation: upgrade an existing page, publish a new blog,
 * or amplify a topic on social.
 *
 * Reference: ARCHITECTURE.md §3.7, ROADMAP.md P8.D.1.1
 */

import { supabaseAdmin } from '@/lib/supabase'
import type {
  ContentStrategyItem,
  ContentStrategyInsert,
  ListStrategyFilter,
  StrategyStatus,
} from '@/types/magic-engine'

const TABLE = 'content_strategy_items'

const DEFAULT_LIMIT = 200

export async function listStrategyItems(
  clientId: string,
  filter: ListStrategyFilter = {}
): Promise<ContentStrategyItem[]> {
  let query: any = supabaseAdmin.from(TABLE).select('*').eq('client_id', clientId)
  if (filter.status) query = query.eq('status', filter.status)
  if (filter.action_type) query = query.eq('action_type', filter.action_type)
  if (filter.strategy_run_id)
    query = query.eq('strategy_run_id', filter.strategy_run_id)

  const { data, error } = await query
    .order('priority_score', { ascending: false })
    .limit(filter.limit ?? DEFAULT_LIMIT)

  if (error) throw new Error(`Failed to list strategy items: ${error.message}`)
  return (data || []) as ContentStrategyItem[]
}

export async function insertStrategyItems(
  rows: ContentStrategyInsert[]
): Promise<ContentStrategyItem[]> {
  if (!rows || rows.length === 0) return []

  const payload = rows.map((r) => ({
    ...r,
    priority: r.priority ?? deriveDefaultPriority(r.priority_score),
    status: r.status ?? 'pending',
  }))

  const { data, error } = await supabaseAdmin.from(TABLE).insert(payload).select()

  if (error) throw new Error(`Failed to insert strategy items: ${error.message}`)
  return (data || []) as ContentStrategyItem[]
}

export async function updateStrategyStatus(
  itemId: string,
  patch: { status: StrategyStatus; linked_blog_post_id?: string | null }
): Promise<ContentStrategyItem> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({
      status: patch.status,
      ...(patch.linked_blog_post_id !== undefined
        ? { linked_blog_post_id: patch.linked_blog_post_id }
        : {}),
    })
    .eq('id', itemId)
    .select()
    .single()

  if (error) throw new Error(`Failed to update strategy item: ${error.message}`)
  return data as ContentStrategyItem
}

export async function countStrategyItemsByStatus(
  clientId: string
): Promise<Partial<Record<StrategyStatus, number>>> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('status')
    .eq('client_id', clientId)
    .order('status', { ascending: true })
    .limit(10000)

  if (error) throw new Error(`Failed to count strategy items: ${error.message}`)

  const counts: Partial<Record<StrategyStatus, number>> = {}
  for (const row of data || []) {
    const s = (row as { status: StrategyStatus }).status
    counts[s] = (counts[s] ?? 0) + 1
  }
  return counts
}

function deriveDefaultPriority(score: number): 'critical' | 'high' | 'medium' | 'low' {
  if (score >= 80) return 'critical'
  if (score >= 60) return 'high'
  if (score >= 30) return 'medium'
  return 'low'
}
