/**
 * 熔断判据 #2（客户级日预算上限）的取数层。
 *
 * 组装 `detectClientSpendOverCap` 需要的四样东西，**只组装事实，不判断**——
 * 判断在 `circuit-detectors.ts`。四样东西里三样直接复用已有模块，只有
 * "每个账户的花费事实" 这一样是本文件新写的最小查询：
 *
 *   · 客户参考日           → 复用 `resolveClientEvaluationDate`（不重推时区逻辑，
 *                            也不重复卫青那次"读不到时区的账户排除在取最早之外"的修复）
 *   · 客户级配置来源与上限 → 复用 `loadAdStrategyConfigWithSource`
 *   · 账户列表             → 复用 `getClientAdAccounts`（含它对老客户的
 *                            `meta_ad_account_id` 回落）
 *   · 每账户"在不在投"     → 复用 `isDelivering` / `DELIVERING_STATUSES`
 *                            （诊断层那份，不是自己另写一份 —— WP2 复审吃过
 *                            "两份判据不一致"的亏，见 envelope-facts.ts 同一处注释）
 *
 * 🔴 没有复用 `buildAccountContext` / `loadAccount`（诊断层那套重型加载器）：
 *    它一次要拉 35 天快照 + 每日指标 + `ad_snapshot_captures`，是给"给客户出诊断
 *    报告"用的，本模块只需要"这个账户现在在不在投、币种是什么"两个字段，
 *    拉那么多东西纯属浪费，而且会把熔断判据的取数耦合到诊断层的迭代节奏上。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getClientAdAccounts } from '@/lib/meta/client-ad-accounts'
import { resolveClientEvaluationDate } from './account-timezone'
import { loadAdStrategyConfigWithSource } from './config'
import { isDelivering } from './portfolio/diagnostics/context'
import type { EntitySnapshotRow } from './portfolio/snapshot'
import type { AccountSpendFact, DetectorConfigSource } from './circuit-detectors'

/**
 * 快照的回看窗口。设置快照约 6 小时一轮（见 `portfolio/snapshot-sync.ts` 的调度
 * 注释），48 小时覆盖至少 8 轮，容忍偶发一两轮跳过而不至于把"暂时没跑"
 * 误判成"这个账户没有实体"。
 */
const SNAPSHOT_LOOKBACK_MS = 48 * 60 * 60 * 1000

/**
 * 单账户在回看窗口内不该有这么多行快照（真实客户最多几百个 campaign/adset）。
 * 撞到这个数就当查询被截断处理，**不当"扫完了、没有在投的实体"**——
 * 跟 `circuit-spend-window.ts` 的 `SPEND_WINDOW_ROW_LIMIT` 是同一个理由：
 * 静默截断会把"少查了几个实体"读成"这几个实体不存在"，方向是 fail-open。
 */
const SNAPSHOT_ROW_LIMIT = 2000

export interface ClientCapFacts {
  readonly clientReferenceDate: string
  readonly accounts: readonly AccountSpendFact[]
  readonly capCents: number | null
  readonly configSource: DetectorConfigSource
}

interface LastCompleteSpend {
  readonly lastCompleteDate: string | null
  readonly spendCents: number | null
}

/**
 * 这个账户**自己**最后一个不晚于 `clientReferenceDate` 的完整数据日，及那天的花费。
 *
 * 🔴 两步查询而不是一步 `order + limit(1)` 里直接拿 spend：`ad_daily_insights`
 *    同一天同一账户会有多条 campaign 行（多个系列），第一步只用来定位"哪一天"，
 *    第二步才把那一天**所有** campaign 行的花费加总——一步查会漏掉除第一条外的
 *    系列，把当天花费算少（同样是 fail-open 的方向）。
 */
async function readLastCompleteSpend(
  clientId: string,
  adAccountId: string,
  clientReferenceDate: string,
): Promise<LastCompleteSpend> {
  const { data: lastRow, error: lastErr } = await supabaseAdmin
    .from('ad_daily_insights')
    .select('insight_date')
    .eq('client_id', clientId)
    .eq('ad_account_id', adAccountId)
    .eq('level', 'campaign')
    .lte('insight_date', clientReferenceDate)
    .order('insight_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  // 查询本身失败，或这个账户在参考日及之前压根没有过任何数据 —— 两种都答
  // "不知道"，不猜成 0。「查不到」跟「知道是 0」是两件事，交给判据层再区分。
  if (lastErr || !lastRow) {
    return { lastCompleteDate: null, spendCents: null }
  }

  const lastCompleteDate = (lastRow as { insight_date: string }).insight_date

  const { data: dayRows, error: dayErr } = await supabaseAdmin
    .from('ad_daily_insights')
    .select('spend')
    .eq('client_id', clientId)
    .eq('ad_account_id', adAccountId)
    .eq('level', 'campaign')
    .eq('insight_date', lastCompleteDate)

  if (dayErr) {
    // 知道"哪一天"、但那一天到底花了多少查不出来 —— 同样答"不知道"，
    // 不能让"日期查到了"给人一种"花费也一定查到了"的错觉。
    return { lastCompleteDate: null, spendCents: null }
  }

  // 先把当天所有行的元加完、最后才乘 100 转分（同 circuit-spend-window.ts 的理由：
  // 逐行取整会把每行的小数误差累积起来）。spend 为 null 的行按 0 累加。
  const totalMajor = (dayRows ?? []).reduce((sum, row) => {
    const spend = (row as { spend: number | null }).spend
    return sum + (typeof spend === 'number' ? spend : 0)
  }, 0)

  return { lastCompleteDate, spendCents: Math.round(totalMajor * 100) }
}

interface DeliveryAndCurrency {
  readonly hasDeliveringEntity: boolean | null
  readonly currency: string | null
}

/**
 * 这个账户"有没有在投的实体"+ 币种。
 *
 * 币种从**账户级**快照的 `currency` 直接读（同 `diagnostics/loader.ts:160-164`
 * 的取法），不从 campaign/adset 行反查——账户级那一行本来就存着它，反查是多余的
 * 一步、还多一个"campaign 行的币种会不会跟账户不一致"的假设要处理。
 */
async function readAccountDeliveryAndCurrency(
  clientId: string,
  adAccountId: string,
): Promise<DeliveryAndCurrency> {
  const since = new Date(Date.now() - SNAPSHOT_LOOKBACK_MS).toISOString()

  const [accountSnapResult, entityRowsResult] = await Promise.all([
    supabaseAdmin
      .from('ad_entity_snapshots')
      .select('currency')
      .eq('client_id', clientId)
      .eq('ad_account_id', adAccountId)
      .eq('level', 'account')
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('ad_entity_snapshots')
      .select('entity_id, effective_status, captured_at')
      .eq('client_id', clientId)
      .eq('ad_account_id', adAccountId)
      .in('level', ['campaign', 'adset'])
      .gte('captured_at', since)
      .order('captured_at', { ascending: false })
      .limit(SNAPSHOT_ROW_LIMIT),
  ])

  const currency = (accountSnapResult.data as { currency: string | null } | null)?.currency ?? null

  if (entityRowsResult.error) {
    return { hasDeliveringEntity: null, currency }
  }

  const rows = (entityRowsResult.data ?? []) as Array<
    Pick<EntitySnapshotRow, 'entity_id' | 'effective_status'>
  >

  // 回看窗口里连一行快照都没有 —— 连快照都拿不到，不是"没有在投的"。
  if (rows.length === 0) {
    return { hasDeliveringEntity: null, currency }
  }
  // 撞到上限，可能漏了没扫到的实体 —— 同样不敢说"没有在投的"。
  if (rows.length === SNAPSHOT_ROW_LIMIT) {
    return { hasDeliveringEntity: null, currency }
  }

  // rows 已按 captured_at 倒序：每个 entity_id 第一次出现，就是它在这个窗口里
  // 最新的那一条。用 Map 的"已存在则跳过"天然做到"只取第一次出现"。
  const latestByEntity = new Map<string, EntitySnapshotRow>()
  for (const row of rows) {
    if (!latestByEntity.has(row.entity_id)) {
      latestByEntity.set(row.entity_id, row as EntitySnapshotRow)
    }
  }

  const hasDeliveringEntity = [...latestByEntity.values()].some((row) => isDelivering(row))
  return { hasDeliveringEntity, currency }
}

/** 装配判据 #2 需要的全部事实。 */
export async function loadClientCapFacts(clientId: string): Promise<ClientCapFacts> {
  const [clientAccounts, { config, source: configSource }] = await Promise.all([
    getClientAdAccounts(clientId),
    loadAdStrategyConfigWithSource(clientId),
  ])

  const adAccountIds = clientAccounts.map((account) => account.adAccountId)
  const clientReferenceDate = await resolveClientEvaluationDate(adAccountIds)

  const accounts: AccountSpendFact[] = await Promise.all(
    clientAccounts.map(async ({ adAccountId }) => {
      const [spend, delivery] = await Promise.all([
        readLastCompleteSpend(clientId, adAccountId, clientReferenceDate),
        readAccountDeliveryAndCurrency(clientId, adAccountId),
      ])
      return {
        adAccountId,
        lastCompleteDate: spend.lastCompleteDate,
        spendCents: spend.spendCents,
        hasDeliveringEntity: delivery.hasDeliveringEntity,
        currency: delivery.currency,
      }
    }),
  )

  return {
    clientReferenceDate,
    accounts,
    capCents: config.daily_budget_cap_cents,
    configSource,
  }
}
