/**
 * SeoContentAdapter — in_house FlywheelAdapter for the SEO flywheel.
 *
 * P12.B.1:
 *   execute()     — records an SEO action in flywheel_actions and returns the row.
 *   pullMetrics() — pulls SEMrush domain metrics + published post count, writes
 *                   them to flywheel_metrics, and returns the rows written.
 *
 * Auto-registers itself to the adapter registry on import.
 */

import { supabaseAdmin } from '../../supabase'
import { getDomainMetrics } from '../../semrush/client'
import { isValidSeoActionType, SEO_METRIC_KEY } from '../vocabulary'
import { registerAdapter } from './registry'
import type {
  ExecuteActionInput,
  FlywheelActionRow,
  FlywheelAdapter,
  FlywheelMetricRow,
} from './types'

export class SeoContentAdapter implements FlywheelAdapter {
  readonly flywheel = 'seo' as const

  async execute(input: ExecuteActionInput): Promise<FlywheelActionRow> {
    if (!isValidSeoActionType(input.actionType)) {
      throw new Error(
        `Unknown SEO action_type: "${input.actionType}". ` +
          `Valid values are defined in SEO_ACTION_TYPE (vocabulary.ts).`
      )
    }

    const { data, error } = await supabaseAdmin
      .from('flywheel_actions')
      .insert({
        client_id: input.clientId,
        execution_item_id: input.executionItemId ?? null,
        flywheel: 'seo',
        action_type: input.actionType,
        execution_mode: input.executionMode,
        vendor: input.vendor ?? null,
        payload: input.payload ?? null,
        expected_metric: input.expectedMetric ?? null,
        expected_delta: input.expectedDelta ?? null,
      })
      .select()
      .single()

    if (error) {
      throw new Error(`SeoContentAdapter.execute DB error: ${error.message}`)
    }

    return {
      id: data.id,
      clientId: data.client_id,
      executionItemId: data.execution_item_id ?? undefined,
      flywheel: 'seo',
      actionType: data.action_type,
      executionMode: data.execution_mode,
      vendor: data.vendor ?? undefined,
      payload: data.payload ?? undefined,
      expectedMetric: data.expected_metric ?? undefined,
      expectedDelta: data.expected_delta ?? undefined,
      executedAt: data.executed_at,
    }
  }

  /**
   * Pull SEO metrics for a client:
   *   1. Fetch domain from clients table.
   *   2. Call SEMrush domain_ranks API → organic_keywords, organic_traffic, authority_score.
   *   3. Count published blog posts from blog_posts table.
   *   4. Write all rows to flywheel_metrics and return them.
   *
   * Non-fatal: if SEMrush call fails, we still write the blog count.
   */
  async pullMetrics(clientId: string, since?: Date): Promise<FlywheelMetricRow[]> {
    const domain = await this.fetchClientDomain(clientId)
    if (!domain) return []

    const now = new Date().toISOString()
    const base = {
      clientId,
      flywheel: 'seo' as const,
      source: 'semrush',
      sourceRef: { domain },
      measuredAt: now,
    }

    const [semrushResult, postCountResult] = await Promise.allSettled([
      getDomainMetrics(domain),
      this.countPublishedPosts(clientId, since),
    ])

    const toInsert: object[] = []
    const returned: FlywheelMetricRow[] = []

    if (semrushResult.status === 'fulfilled') {
      const m = semrushResult.value
      const semrushRows = [
        { metric_key: SEO_METRIC_KEY.ORGANIC_KEYWORDS, metric_value: m.organic_keywords },
        { metric_key: SEO_METRIC_KEY.ORGANIC_TRAFFIC,  metric_value: m.organic_traffic  },
        { metric_key: SEO_METRIC_KEY.AUTHORITY_SCORE,  metric_value: m.authority_score  },
      ]
      for (const row of semrushRows) {
        toInsert.push({
          client_id: clientId,
          flywheel: 'seo',
          metric_key: row.metric_key,
          metric_value: row.metric_value,
          source: 'semrush',
          source_ref: { domain },
          measured_at: now,
        })
        returned.push({
          id: '',
          ...base,
          metricKey: row.metric_key,
          metricValue: row.metric_value,
        })
      }
    }

    if (postCountResult.status === 'fulfilled') {
      const count = postCountResult.value
      toInsert.push({
        client_id: clientId,
        flywheel: 'seo',
        metric_key: SEO_METRIC_KEY.PUBLISHED_POSTS,
        metric_value: count,
        source: 'blog_posts',
        source_ref: { client_id: clientId },
        measured_at: now,
      })
      returned.push({
        id: '',
        clientId,
        flywheel: 'seo',
        metricKey: SEO_METRIC_KEY.PUBLISHED_POSTS,
        metricValue: count,
        source: 'blog_posts',
        sourceRef: { client_id: clientId },
        measuredAt: now,
      })
    }

    if (toInsert.length === 0) return []

    // Write metrics to DB; log on failure but don't throw — partial data is
    // better than no data.
    const { error } = await supabaseAdmin.from('flywheel_metrics').insert(toInsert)
    if (error) {
      console.error('[SeoContentAdapter] pullMetrics insert error:', error.message)
    }

    return returned
  }

  private async fetchClientDomain(clientId: string): Promise<string | null> {
    const { data } = await supabaseAdmin
      .from('clients')
      .select('domain')
      .eq('id', clientId)
      .single()
    return (data?.domain as string) ?? null
  }

  private async countPublishedPosts(clientId: string, since?: Date): Promise<number> {
    let query = supabaseAdmin
      .from('blog_posts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('status', 'published')

    if (since) {
      query = query.gte('created_at', since.toISOString())
    }

    const { count } = await query
    return count ?? 0
  }
}

registerAdapter(new SeoContentAdapter())
