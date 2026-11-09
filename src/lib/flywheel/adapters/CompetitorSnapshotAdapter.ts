/**
 * CompetitorSnapshotAdapter — P22.A.4
 *
 * Reads competitor domains from clients.competitor_domains, calls DataForSEO
 * bulk_traffic_estimation, and writes one flywheel_metrics row per domain.
 *
 * This adapter is read-only (no execute() — competitor tracking has no
 * in-house action to log). Only pullMetrics() is implemented.
 *
 * Data flow:
 *   clients.competitor_domains[]
 *     → getBulkTrafficEstimation(domains)
 *     → flywheel_metrics(competitor.domain.organic_traffic, source_ref.domain = competitor)
 *
 * Enables AnomalyDetector (Phase 22.D.1) to detect competitor traffic surges.
 */

import { supabaseAdmin } from '../../supabase'
import { getBulkTrafficEstimation } from '../../dataforseo/labs'
import { getClientCompetitorDomains } from '../../competitors/resolver'
import { COMPETITOR_METRIC_KEY } from '../vocabulary'
import type { FlywheelMetricRow } from './types'

/**
 * 竞品维度落在哪个飞轮。数据库枚举 flywheel_name 只有 seo/geo/ads/social，
 * 与 execution-target.ts 的 dimensionToFlywheel('competitor') 保持一致。
 */
const COMPETITOR_FLYWHEEL = 'seo' as const

export class CompetitorSnapshotAdapter {
  /**
   * Pull organic traffic estimates for all competitor domains of a client.
   *
   * - Skips silently if the client has no competitor_domains set.
   * - Uses Promise.allSettled-style resilience: a DataForSEO failure logs
   *   an error but does not throw, so the cron job keeps running.
   *
   * @param clientId  UUID of the client row in clients table
   * @returns         Array of FlywheelMetricRow written to flywheel_metrics
   */
  async pullMetrics(clientId: string): Promise<FlywheelMetricRow[]> {
    const domains = await this.fetchCompetitorDomains(clientId)
    if (domains.length === 0) return []

    const results = await getBulkTrafficEstimation(domains).catch(err => {
      console.error('[CompetitorSnapshotAdapter] DataForSEO error:', (err as Error).message)
      return []
    })

    if (results.length === 0) return []

    const now = new Date().toISOString()

    // 🔴 `flywheel` 是数据库枚举 flywheel_name，只有 seo/geo/ads/social 四个值 ——
    // 没有 'competitor'。写 'competitor' 会被数据库整行拒绝。竞品归到 'seo' 轮，
    // 跟 execution-target.ts 的 dimensionToFlywheel('competitor') → 'seo' 同一口径；
    // 竞品这一维靠 metric_key（competitor.domain.*）区分，不靠 flywheel 列。
    const toInsert = results
      .filter(r => r.monthly_traffic !== null)
      .map(r => ({
        client_id:    clientId,
        flywheel:     COMPETITOR_FLYWHEEL,
        metric_key:   COMPETITOR_METRIC_KEY.ORGANIC_TRAFFIC,
        metric_value: r.monthly_traffic as number,
        source:       'dataforseo',
        source_ref:   { domain: r.domain },
        measured_at:  now,
      }))

    if (toInsert.length === 0) return []

    const { error } = await supabaseAdmin.from('flywheel_metrics').insert(toInsert)
    if (error) {
      // ⚠️ 已知问题（本次不改，属行为变更需单独授权）：写库失败时这里仍会把
      // toInsert 当成「已落库的行」返回给调用方，失败只留在 console。
      // 现有测试 “logs insert error but still returns rows” 明文锁着这个行为。
      console.error('[CompetitorSnapshotAdapter] insert error:', error.message)
    }

    return toInsert.map(row => ({
      id:          '',
      clientId,
      flywheel:    COMPETITOR_FLYWHEEL,
      metricKey:   row.metric_key,
      metricValue: row.metric_value,
      source:      row.source,
      sourceRef:   row.source_ref,
      measuredAt:  now,
    }))
  }

  /**
   * Resolved via unified resolver: clients.competitor_domains (FDE) >
   * master_briefs.competitor_domains > DataForSEO auto (not used here — only
   * known competitors get a flywheel_metrics row).
   */
  private async fetchCompetitorDomains(clientId: string): Promise<string[]> {
    return getClientCompetitorDomains(clientId, [], 50)
  }
}
