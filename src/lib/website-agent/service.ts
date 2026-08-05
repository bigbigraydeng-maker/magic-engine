import type { SupabaseClient } from '@supabase/supabase-js'
import { loadMemoryForClient } from '@/lib/memory'
import { loadZhugeFeedbackSummary } from '@/lib/zhuge/memory-loader'
import { writeExecutionItems } from '@/lib/zhuge/action-persister'
import type { StrategyItem } from '@/lib/strategy/types'
import { planWebsiteGrowth } from './planner'
import type { WebsiteGrowthPlan, WebsitePageSignal } from './types'

export async function buildWebsiteGrowthPlan(
  supabase: SupabaseClient,
  clientId: string,
  maxActions = 3,
): Promise<WebsiteGrowthPlan> {
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, domain')
    .eq('id', clientId)
    .single()

  if (clientError || !client) throw new Error('Client not found')
  if (!client.domain) throw new Error('Client has no domain configured')

  const [pagesResult, strategyResult, memory, feedback] = await Promise.all([
    supabase
      .from('client_site_pages')
      .select('id, url, title, page_type, topics, primary_keyword, word_count, has_geo_block, status_code, crawled_at')
      .eq('client_id', clientId)
      .order('crawled_at', { ascending: false })
      .limit(500),
    supabase
      .from('content_strategy_items')
      .select('*')
      .eq('client_id', clientId)
      .in('status', ['pending', 'approved', 'in_progress'])
      .order('priority_score', { ascending: false })
      .limit(100),
    loadMemoryForClient(supabase, clientId, { flywheel: 'seo', maxRecentDecisions: 10 }),
    loadZhugeFeedbackSummary(supabase, clientId),
  ])

  if (pagesResult.error) {
    throw new Error(`Unable to load site pages: ${pagesResult.error.message}`)
  }
  if (strategyResult.error) {
    throw new Error(`Unable to load content strategy: ${strategyResult.error.message}`)
  }

  return planWebsiteGrowth({
    clientId,
    domain: client.domain,
    pages: (pagesResult.data ?? []) as WebsitePageSignal[],
    strategyItems: (strategyResult.data ?? []) as StrategyItem[],
    memory,
    feedback,
    maxActions,
  })
}

export async function queueWebsiteGrowthPlan(
  supabase: SupabaseClient,
  plan: WebsiteGrowthPlan,
) {
  return writeExecutionItems(
    supabase,
    plan.client_id,
    null,
    plan.actions,
    null,
  )
}

