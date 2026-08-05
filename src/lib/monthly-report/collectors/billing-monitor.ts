import { DataSourceCollectorBase } from '../collector-base'
import { BillingMetrics } from '@/types/monthly-report'

interface BillingLogRow {
  id: number
  api_calls: number | null
  cost_usd: number | null
  service: string | null
  month: string
}

export class BillingMonitorCollector extends DataSourceCollectorBase {
  name = 'Billing Monitor'
  datasource_type = 'billing'

  /**
   * Collect billing metrics for a client in a given month
   */
  async collect(clientId: string, month: string): Promise<BillingMetrics | null> {
    // 🔴 This used to filter on a `logged_at` column that does not exist on
    //    datasource_usage_logs (the columns are client_id / service / api_calls
    //    / cost_usd / month / created_at / updated_at). PostgREST rejects the
    //    unknown column, so this collector threw on every single run. The table
    //    stores one aggregated row per client+service+month, so `month` is the
    //    filter it was always meant to use.
    const { data: logs, error } = await this.supabase
      .from('datasource_usage_logs')
      .select('id, api_calls, cost_usd, service, month')
      .eq('client_id', clientId)
      .eq('month', month)

    if (error) {
      throw new Error(`Failed to fetch billing logs: ${error.message}`)
    }

    if (!logs || logs.length === 0) {
      return {
        total_cost_usd: 0,
        total_api_calls: 0,
        cost_by_service: {},
        monthly_trend: [],
      }
    }

    const metrics = this.normalizeBillingData(logs as BillingLogRow[])
    return metrics
  }

  /**
   * Normalize raw billing data into BillingMetrics
   */
  private normalizeBillingData(logs: BillingLogRow[]): BillingMetrics {
    // Aggregate by service
    const costByService = new Map<string, number>()
    const callsByService = new Map<string, number>()

    let totalCost = 0
    let totalCalls = 0

    logs.forEach((log) => {
      const cost = log.cost_usd ?? 0
      const calls = log.api_calls ?? 0

      totalCost += cost
      totalCalls += calls

      const service = log.service || 'unknown'
      costByService.set(service, (costByService.get(service) || 0) + cost)
      callsByService.set(service, (callsByService.get(service) || 0) + calls)
    })

    // Note: `monthly_trend` is a per-service breakdown, not a time series —
    // this table has no per-day granularity to build one from. A day-by-day
    // map used to be computed here off the non-existent `logged_at` column and
    // then thrown away unused; it is gone rather than left looking meaningful.
    const monthlyTrend = Array.from(costByService.entries()).map(([service, cost]) => ({
      service,
      calls: callsByService.get(service) || 0,
      cost: parseFloat(cost.toFixed(4)),
    }))

    return {
      total_cost_usd: parseFloat(totalCost.toFixed(2)),
      total_api_calls: totalCalls,
      cost_by_service: Object.fromEntries(
        Array.from(costByService.entries()).map(([service, cost]) => [
          service,
          parseFloat(cost.toFixed(4)),
        ])
      ),
      monthly_trend: monthlyTrend,
    }
  }

  /**
   * Validate billing data
   */
  validate(data: BillingMetrics): boolean {
    if (!data) return false
    if (typeof data !== 'object') return false
    if (typeof data.total_cost_usd !== 'number') return false
    if (typeof data.total_api_calls !== 'number') return false
    return true
  }

  /**
   * Normalize raw data to BillingMetrics
   */
  async normalize(data: any): Promise<BillingMetrics> {
    if (Array.isArray(data)) {
      return this.normalizeBillingData(data)
    }
    return data as BillingMetrics
  }

  /**
   * Execute full collection pipeline
   */
  async execute(clientId: string, month: string): Promise<void> {
    const data = await this.collect(clientId, month)
    if (!data) {
      console.log(`No billing data for client ${clientId} in month ${month}`)
      return
    }

    if (!this.validate(data)) {
      throw new Error('Invalid billing data')
    }

    const normalized = await this.normalize(data)

    const reportId = await this.updateReport(clientId, month, {
      billing_total_cost: normalized.total_cost_usd,
      billing_total_api_calls: normalized.total_api_calls,
    })

    await this.storeSection(reportId, normalized)
  }
}
