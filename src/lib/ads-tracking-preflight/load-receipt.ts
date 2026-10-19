/**
 * 给推广计划的检查清单读「开投前追踪检查」的最近一份回执（只读）。
 *
 * 返回值的三种含义（见 promo/gates.ts 的 GateFacts.tracking）：
 *   · undefined          —— 这个客户没配置追踪检查：不适用，清单里不出现追踪那十道门，也不读库
 *   · { receipt: null }  —— 配置了，但读不到回执 / 最近几轮里没有它：十道门全灰（硬门灰 = 不能批准）
 *   · { receipt: {...} } —— 最近一份回执（新鲜不新鲜由 gates.ts 按 36 小时判）
 *
 * 🔴 读库出任何问题都是 { receipt: null }——读不到就灰，绝不当成没问题。
 * 🔴 平台通用：不点名任何客户；配置在 client-config.ts。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { GateFacts } from '@/lib/marketing-plan/promo/gates'
import { getTrackingClientConfig } from './client-config'
import { TRACKING_PREFLIGHT_JOB, pickLatestClientReceipt } from './receipt'

/** 回看最近几轮运行记录（每天一轮，多看几轮是为了「更新的一轮只查了别的客户」的情况）。 */
const RECENT_RUNS = 14

interface RunRow {
  status: string | null
  started_at: string
  summary: unknown
}

export async function loadTrackingGateFacts(
  supabase: SupabaseClient,
  clientId: string,
): Promise<GateFacts['tracking']> {
  if (getTrackingClientConfig(clientId) === null) return undefined
  try {
    const { data, error } = await supabase
      .from('cron_run_logs')
      .select('status, started_at, summary')
      .eq('job_name', TRACKING_PREFLIGHT_JOB)
      .order('started_at', { ascending: false })
      .limit(RECENT_RUNS)
    if (error) return { receipt: null }
    const picked = pickLatestClientReceipt((data ?? []) as RunRow[], clientId)
    return { receipt: picked ? { checked_at: picked.receipt.checked_at, gates: picked.receipt.gates } : null }
  } catch {
    return { receipt: null }
  }
}
