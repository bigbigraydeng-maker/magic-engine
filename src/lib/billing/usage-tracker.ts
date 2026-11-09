/**
 * DataForSEO usage and cost tracking
 * Monitors API calls and calculates costs for billing
 */

import { SupabaseClient } from '@supabase/supabase-js'

interface UsageLog {
  client_id: string
  service: 'DataForSEO' | 'Semrush'
  api_calls: number
  cost_usd: number
  month: string // YYYY-MM format
}

/**
 * Get current month in YYYY-MM format
 */
function getCurrentMonth(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/**
 * Log API usage and cost for a service (accumulates calls and costs)
 */
export async function logServiceUsage(
  supabase: SupabaseClient,
  clientId: string,
  service: 'DataForSEO' | 'Semrush',
  apiCalls: number,
  costUsd: number
): Promise<{ success: boolean; error?: Error }> {
  const month = getCurrentMonth()

  // First, fetch existing record to accumulate
  const { data: existing, error: fetchError } = await supabase
    .from('datasource_usage_logs')
    .select('api_calls, cost_usd')
    .eq('client_id', clientId)
    .eq('service', service)
    .eq('month', month)
    .single()

  if (fetchError && fetchError.code !== 'PGRST116') {
    // PGRST116 = no rows returned (expected for new records)
    return { success: false, error: fetchError }
  }

  const totalApiCalls = (existing?.api_calls || 0) + apiCalls
  const totalCost = (existing?.cost_usd || 0) + costUsd

  const { error } = await supabase
    .from('datasource_usage_logs')
    .upsert(
      {
        client_id: clientId,
        service,
        api_calls: totalApiCalls,
        cost_usd: totalCost,
        month,
      },
      {
        onConflict: 'client_id,service,month',
      }
    )

  if (error) {
    return { success: false, error }
  }

  return { success: true }
}

/**
 * Get billing summary for a specific month
 */
export async function getBillingByMonth(
  supabase: SupabaseClient,
  month: string
) {
  const { data, error } = await supabase
    .from('datasource_usage_logs')
    .select('client_id, service, api_calls, cost_usd, month')
    .eq('month', month)
    .order('cost_usd', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch billing data: ${error.message}`)
  }

  return data || []
}

/**
 * Get billing summary for a specific client and month
 */
export async function getClientBillingByMonth(
  supabase: SupabaseClient,
  clientId: string,
  month: string
) {
  const { data, error } = await supabase
    .from('datasource_usage_logs')
    .select('client_id, service, api_calls, cost_usd, month')
    .eq('client_id', clientId)
    .eq('month', month)

  if (error) {
    throw new Error(`Failed to fetch client billing data: ${error.message}`)
  }

  return data || []
}

/**
 * Calculate total costs by service for a month
 */
export async function getCostsByService(
  supabase: SupabaseClient,
  month: string
): Promise<Record<string, number>> {
  const data = await getBillingByMonth(supabase, month)

  const costs: Record<string, number> = {}
  for (const log of data) {
    if (!costs[log.service]) {
      costs[log.service] = 0
    }
    costs[log.service] += log.cost_usd
  }

  return costs
}

/**
 * Get all unique months with usage data
 */
export async function getAvailableMonths(
  supabase: SupabaseClient
): Promise<string[]> {
  const { data, error } = await supabase
    .from('datasource_usage_logs')
    .select('month')
    .order('month', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch available months: ${error.message}`)
  }

  // Deduplicate months
  const months = (data || []).map((row: any) => row.month)
  return Array.from(new Set(months))
}
