/**
 * 广告自治熔断器运行时调用方（WP3 熔断器运行时调用方，接在 WP3「接线通电」的
 * 纯判据 `evaluateCircuitBreaker` 之后）。
 *
 * `google-data-pullback-daily` 在每个有配置行的客户拉完当天 `ad_daily_insights`
 * 后发一条 `ads.circuit_breaker.check_due`（叫醒铃：payload 只带 client_id +
 * date，本函数回库读当下 `autonomy_mode` 与最新花费，不信 payload 里可能过期
 * 的值——跟 `ads-autonomy-sync.ts` 同一惯例）。
 *
 * 只在 `autonomy_mode = 'bounded_auto'` 时评估：`observe` 下没有任何广告动作
 * 在自动执行，没有对象可熔断，硬熔断一个空转档位只会制造一个之后要人去解的
 * 死锁。
 *
 * 触发后把该客户全部 `ads.*` 动作的 `client_automation_policies.mode` 写成
 * `deny`，写入口是新 SQL 函数 `ads_trip_circuit_breaker_policy`（唯一允许写
 * deny 的入口，见迁移 `20260928000001_ads_circuit_breaker_policy.sql`）。
 * 解除走对应的 `ads_release_circuit_breaker_policy`，由
 * `POST .../ad-strategy-config/release-circuit-breaker` 路由调用（管理员操作，
 * 不在本文件）。
 *
 * 🔴 **新增函数上线要手动 Sync `/api/inngest`**（STATE.md:174、PITFALLS F10）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { ADS_CIRCUIT_BREAKER_CHECK_DUE } from '../ads-events'
import { evaluateCircuitBreaker, CIRCUIT_BREAKER_LOOKBACK_DAYS } from '@/lib/ads-strategy/circuit-breaker'
import { fetchClientDailySpendCents } from '@/lib/ads-strategy/circuit-breaker-spend'
import { listAdsActionKeys } from '@/lib/ads-strategy/autonomy/sync-policy'

export const ADS_CIRCUIT_BREAKER_CHECK_FN_ID = `${CLOUD_FN_PREFIX}ads-circuit-breaker-check`

export interface AdsCircuitBreakerCheckDeps {
  /** 在 handler 内部取客户端，不在模块顶层 new。测试注入假对象。 */
  readonly getSupabase: () => SupabaseClient
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface CheckPayload {
  readonly client_id: string
  readonly date: string
}

/** payload 校验（fail-closed）：只认合法 UUID + 'YYYY-MM-DD' 日期。 */
export function parseCheckPayload(data: unknown): CheckPayload | null {
  if (!data || typeof data !== 'object') return null
  const clientId = (data as Record<string, unknown>).client_id
  const date = (data as Record<string, unknown>).date
  if (typeof clientId !== 'string' || !UUID_RE.test(clientId)) return null
  if (typeof date !== 'string' || !ISO_DATE_RE.test(date)) return null
  return { client_id: clientId, date }
}

export interface AdsTripKeyResult {
  readonly key: string
  readonly outcome: string // rpc 返回：tripped | already_tripped | locked_by_other_deny | race_lost
}

export type AdsCircuitBreakerCheckReceipt =
  | {
      ok: false
      reason: 'invalid_payload' | 'no_config' | 'not_bounded_auto'
      client_id: string | null
    }
  | {
      ok: true
      client_id: string
      date: string
      verdict: 'not_tripped' | 'undeterminable' | 'tripped'
      reason?: string
      applied: AdsTripKeyResult[]
    }

async function readAutonomyMode(sb: SupabaseClient, clientId: string): Promise<'observe' | 'bounded_auto' | null> {
  const { data, error } = await sb
    .from('ad_strategy_configs')
    .select('autonomy_mode')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new Error(`read-autonomy-mode failed: ${error.message}`)
  if (!data) return null
  return data.autonomy_mode === 'bounded_auto' ? 'bounded_auto' : 'observe'
}

/** 逐键调触发函数；单键失败即抛（Inngest 按 retries 重试，SQL 函数本身幂等，重试安全）。 */
async function tripAllKeys(sb: SupabaseClient, clientId: string, reason: string): Promise<AdsTripKeyResult[]> {
  const results: AdsTripKeyResult[] = []
  for (const key of listAdsActionKeys()) {
    const { data, error } = await sb.rpc('ads_trip_circuit_breaker_policy', {
      p_client_id: clientId,
      p_action_key: key,
      p_reason: reason,
    })
    if (error) throw new Error(`ads_trip_circuit_breaker_policy(${key}) failed: ${error.message}`)
    results.push({ key, outcome: typeof data === 'string' ? data : 'unknown' })
  }
  return results
}

export function createAdsCircuitBreakerCheckFunction(deps: AdsCircuitBreakerCheckDeps) {
  return inngest.createFunction(
    {
      id: ADS_CIRCUIT_BREAKER_CHECK_FN_ID,
      name: 'Ads: circuit breaker check',
      retries: 2,
      concurrency: { limit: 1, key: 'event.data.client_id' },
    },
    { event: ADS_CIRCUIT_BREAKER_CHECK_DUE },
    async ({ event, step }): Promise<AdsCircuitBreakerCheckReceipt> => {
      const payload = parseCheckPayload(event.data)
      if (payload === null) return { ok: false, reason: 'invalid_payload', client_id: null }
      const { client_id: clientId, date } = payload

      const mode = await step.run('read-autonomy-mode', () => readAutonomyMode(deps.getSupabase(), clientId))
      if (mode === null) return { ok: false, reason: 'no_config', client_id: clientId }
      if (mode !== 'bounded_auto') return { ok: false, reason: 'not_bounded_auto', client_id: clientId }

      // 🔴 Codex P1 复审：读失败必须 throw，不能正常返回软失败——Inngest 只在
      // step 抛错时重试（配了 retries: 2），正常返回值一律当"成功"，重试配置
      // 会形同虚设；而且事件 id 固定为 client_id:date，一次"正常返回的失败"
      // 会让这天的安全检查永久跳过、没有任何可见回执或重试机会。
      const spend = await step.run('read-spend', async () => {
        const result = await fetchClientDailySpendCents(deps.getSupabase(), clientId, date, CIRCUIT_BREAKER_LOOKBACK_DAYS)
        if (result === null) throw new Error(`read-spend failed: ad_daily_insights unreadable for ${clientId}:${date}`)
        return result
      })

      const verdict = evaluateCircuitBreaker({
        clientId,
        todayTotalSpendCents: spend.todayTotalSpendCents,
        recentDailySpend: spend.recentDailySpend,
      })

      if (verdict.tripped !== true) {
        return {
          ok: true,
          client_id: clientId,
          date,
          verdict: verdict.tripped === 'undeterminable' ? 'undeterminable' : 'not_tripped',
          reason: verdict.tripped === 'undeterminable' ? verdict.reason : undefined,
          applied: [],
        }
      }

      const applied = await step.run('trip-policy', () => tripAllKeys(deps.getSupabase(), clientId, verdict.reason))

      return { ok: true, client_id: clientId, date, verdict: 'tripped', reason: verdict.reason, applied }
    },
  )
}

export const adsCircuitBreakerCheckFunction = createAdsCircuitBreakerCheckFunction({ getSupabase: () => supabaseAdmin })
