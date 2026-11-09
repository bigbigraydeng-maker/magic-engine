/**
 * 给推广计划的检查清单读「开投前追踪检查」的最近一份回执（只读）。
 *
 * 返回值的三种含义（见 promo/gates.ts 的 GateFacts.tracking）：
 *   · undefined          —— 这个客户没配置追踪检查：不适用，清单里不出现追踪那十道门，也不读库
 *   · { receipt: null }  —— 配置了，但读不到回执 / 最近几轮里没有它：十道门全灰（硬门灰 = 不能批准）
 *   · { receipt: {...} } —— 最近一份回执（新鲜不新鲜由 gates.ts 按 36 小时判；预算那一道按 12 小时）
 *
 * 🔴 读库出任何问题都是 { receipt: null }——读不到就灰，绝不当成没问题。
 * 🔴 现读预算（可选）：调用方传了 readLiveBudget（批准 / 看板 / 派广告任务前的复查）时，现读一次放进 live_budget
 *    （见 live-budget.ts）。liveMode：'if_needed'（默认）= 存档里的预算门缺失、过期或没过（红 / 灰）才读；
 *    'always' = 授权动作（批准）每次都读，不看存档多新——存档里的绿 / 黄最多能用 12 小时，期间有人在
 *    广告后台加了广告，批准时仍会看到旧的绿。没传 readLiveBudget 就只读存档，后台任务不去打 Meta。
 *    现读失败 = live_budget 为 null：'if_needed'（只是展示）存档还新时照存档；'always'（授权）带上
 *    live_required，gates.ts 一律判灰，不拿存档顶替（读不到就不放行）。
 * 🔴 平台通用：不点名任何客户；配置在 client-config.ts。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { GateFacts } from '@/lib/marketing-plan/promo/gates'
import { getTrackingClientConfig } from './client-config'
import { BUDGET_RECEIPT_STALE_HOURS, TRACKING_PREFLIGHT_JOB, pickLatestClientReceipt, receiptIsStale } from './receipt'
import type { TrackingGateReceipt } from './types'

/** 回看最近几轮运行记录（每天一轮，多看几轮是为了「更新的一轮只查了别的客户」的情况）。 */
const RECENT_RUNS = 14

const BUDGET_GATE_KEY = 'env.account_billing'

interface RunRow {
  status: string | null
  started_at: string
  summary: unknown
}

type TrackingFacts = NonNullable<GateFacts['tracking']>
type StoredReceipt = TrackingFacts['receipt']

export interface TrackingLoadOptions {
  /** 判「存档过期」用的当前时间；不传 = 现在 */
  now?: Date
  /** 传了 = 现读预算门（读多频繁看 liveMode）；不传 = 只读存档 */
  readLiveBudget?: (clientId: string) => Promise<TrackingGateReceipt | null>
  /** 'if_needed'（默认）：存档里的预算门缺失 / 过期 / 没过才读；'always'：每次都读（批准这类授权动作） */
  liveMode?: 'if_needed' | 'always'
}

async function loadStoredReceipt(supabase: SupabaseClient, clientId: string): Promise<StoredReceipt> {
  try {
    const { data, error } = await supabase
      .from('cron_run_logs')
      .select('status, started_at, summary')
      .eq('job_name', TRACKING_PREFLIGHT_JOB)
      .order('started_at', { ascending: false })
      .limit(RECENT_RUNS)
    if (error) return null
    const picked = pickLatestClientReceipt((data ?? []) as RunRow[], clientId)
    return picked ? { checked_at: picked.receipt.checked_at, gates: picked.receipt.gates } : null
  } catch {
    return null
  }
}

/** 存档里的预算门能直接用吗：有、不过期、而且是绿或黄（红 / 灰要重读——人可能刚把问题修掉了）。 */
function storedBudgetGateUsable(receipt: StoredReceipt, now: Date): boolean {
  if (receipt === null || receiptIsStale(receipt.checked_at, now, BUDGET_RECEIPT_STALE_HOURS)) return false
  const gate = receipt.gates.find(g => g.key === BUDGET_GATE_KEY)
  return gate !== undefined && (gate.status === 'green' || gate.status === 'yellow')
}

export async function loadTrackingGateFacts(
  supabase: SupabaseClient,
  clientId: string,
  options: TrackingLoadOptions = {},
): Promise<GateFacts['tracking']> {
  if (getTrackingClientConfig(clientId) === null) return undefined
  const receipt = await loadStoredReceipt(supabase, clientId)
  const facts: TrackingFacts = { receipt, client_id: clientId }

  const { readLiveBudget } = options
  const always = options.liveMode === 'always'
  const needLive = always || !storedBudgetGateUsable(receipt, options.now ?? new Date())
  if (readLiveBudget !== undefined && needLive) {
    // 授权动作要求现读：现读没读成时不许回落存档（gates.ts 据此一律判灰）
    if (always) facts.live_required = true
    try {
      facts.live_budget = await readLiveBudget(clientId)
    } catch {
      facts.live_budget = null
    }
  }
  return facts
}
