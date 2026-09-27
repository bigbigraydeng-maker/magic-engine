/**
 * 受限自治信封的**事实来源**（spec 2026-09-24 §3 G5）。
 *
 * Kernel 刻意不认识广告表；它只拿着 `EnvelopeFactsResolver` 这个接口。
 * 这个文件是广告域的实现：把「这一次要改什么」翻成信封判据要的那几项事实。
 *
 * 🔴 **一个字都不从提交方的 input 里取事实。** input 只允许说
 *    「要动哪个实体、想改成多少」；改动前是多少、账户合计多少、日上限多少、
 *    距上次变动几小时、在不在学习期、在不在实验里 —— 全部从
 *    `ad_entity_snapshots` / `ad_strategy_configs` 读。让被约束者自报约束
 *    等于没有约束。
 *
 * 🔴 **读不到一律返回 null / unavailable，交给判据拒绝。**
 *    这里不做「读不到就当没有」的兜底：那会让一次读失败等于一次静默放行。
 *
 * 🔴 **判据要落在正确的实体上。** 这一条踩过：
 *    换素材的 input 给的是**广告** id、新建广告组给的是**广告系列** id，
 *    只按广告组级去查的话这两类永远读不到事实、永远被拒 —— 功能看着上线了其实是死的。
 *    现在逐类解析「跟钱和学习期相关的那个广告组」：
 *      · 暂停 / 砍预算 / 加预算 → input.adset_id 本身
 *      · 换素材           → 这条广告所属的广告组（换素材会重置该组的学习期）
 *      · 新建再营销广告组   → 还不存在的东西没有学习期，判据**不适用**；
 *                          实验归属看它要挂进去的那个广告系列
 *      · 挪预算           → 计划级动作，单实体判据不适用 → 走人工
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { EnvelopeFactsResolver } from '@/lib/kernel/deps'
import type { EnvelopeChangeKind, EnvelopeFacts, EnvelopeRequest } from '@/lib/kernel/autonomy-envelope'
import type { CapabilityImplementation } from '@/lib/kernel/types'
import { DELIVERING_STATUSES } from '@/lib/ads-strategy/portfolio/diagnostics/context'

/** 每个广告动作对花费的性质。信封按性质分流（暂停不走变动比例，等等）。 */
const CHANGE_KIND: Readonly<Record<string, EnvelopeChangeKind>> = {
  'ads.pause_unit': 'pause',
  'ads.cut_unit_budget': 'budget_change',
  'ads.scale_unit_budget': 'budget_change',
  'ads.budget_move_plan': 'budget_change',
  'ads.add_retargeting_adset': 'new_spend',
  'ads.swap_creative': 'creative_only',
}

interface SnapRow {
  level: string
  entity_id: string
  adset_id: string | null
  campaign_id: string | null
  budget_level: string | null
  daily_budget_minor: number | null
  learning_stage: string | null
  ad_studies: unknown
  effective_status: string | null
  capture_reason: string
  captured_at: string
}

const SNAP_COLUMNS =
  'level, entity_id, adset_id, campaign_id, budget_level, daily_budget_minor, learning_stage, ad_studies, effective_status, capture_reason, captured_at'

/**
 * 只有这些投放状态算「在花钱」，用来加总账户当日预算。
 *
 * 🔴 直接从诊断层 `context.ts` import —— 卫青 WP2 复审抓出：原本在这里另写了
 *    一份，跟诊断层不一致，还把 `CAMPAIGN_PAUSED`（其实是「所属系列被暂停」的
 *    信号，没在投放）当成在投放。真实场景是账户里但凡有几个历史关停的系列，
 *    「账户当日预算合计」就会一直虚高，把以后合法的加预算动作误挡。
 *    统一到诊断层的一份，改只改一处，两边不会分家。
 */
const DELIVERING = DELIVERING_STATUSES

function studyCount(raw: unknown): number {
  return Array.isArray(raw) ? raw.length : 0
}

function latestOf(rows: readonly SnapRow[]): SnapRow | null {
  let best: SnapRow | null = null
  for (const r of rows) {
    if (!best || Date.parse(r.captured_at) > Date.parse(best.captured_at)) best = r
  }
  return best
}

/**
 * 距这个实体上一次**真实设置变化**过了多少小时。
 *
 * 🔴 判据是 `capture_reason = 'changed'` —— 那是「跟上一条快照比设置真的变了」
 *    才写的一行，所以**人工在 Ads Manager 里改的也算**（§14 K12：72 小时按真实
 *    变化算，不是只算 ME 自己的动作）。`daily` 那种例行抓取不算变化。
 *    完全没有快照 = 读不到（null）；有快照但没有一条 changed = 确实从没变过。
 */
function hoursSinceLastRealChange(rows: readonly SnapRow[], now: Date): number | null {
  if (rows.length === 0) return null
  const changed = rows.filter(r => r.capture_reason === 'changed')
  if (changed.length === 0) return Number.MAX_SAFE_INTEGER
  const ms = now.getTime() - Date.parse(latestOf(changed)!.captured_at)
  return Number.isFinite(ms) ? ms / 3_600_000 : null
}

/** 这次动作的「跟钱和学习期相关的那个实体」解析结果。 */
interface Subject {
  /** 要读事实的实体 id。 */
  entityId: string
  /** 它在快照表里的层级。 */
  level: 'adset' | 'campaign'
  /** 学习期判据适不适用（新建的东西还不存在，不适用）。 */
  learningApplicable: boolean
}

export interface AdsEnvelopeFactsDeps {
  sb: SupabaseClient
  /** 用来回答「这个动作有没有注册撤回处理函数」。 */
  capabilities: Readonly<Record<string, CapabilityImplementation>>
  now?: () => Date
}

export function createAdsEnvelopeFactsResolver(deps: AdsEnvelopeFactsDeps): EnvelopeFactsResolver {
  const now = deps.now ?? (() => new Date())

  return async ({ clientId, actionKey, input, at }) => {
    const unavailable = (why: string) => ({ unavailable: why } as const)

    const kind = CHANGE_KIND[actionKey]
    if (!kind) return unavailable(`「${actionKey}」不是已知的广告自治动作，判不了信封`)

    const adAccountId = typeof input.ad_account_id === 'string' ? input.ad_account_id : null
    if (!adAccountId) return unavailable('input 里没有 ad_account_id，读不到这个账户的预算')

    const str = (k: string): string | null =>
      typeof input[k] === 'string' && input[k] ? (input[k] as string) : null

    // 这个账户全部快照一次读出来：目标实体的事实、它的父子关系、账户合计都要用。
    // 共用账户按 §14 M9 本来就不抓广告组级 → 读到空 → 走到「读不到 → 拒绝」，符合预期。
    const { data, error } = await deps.sb
      .from('ad_entity_snapshots')
      .select(SNAP_COLUMNS)
      .eq('client_id', clientId)
      .eq('ad_account_id', adAccountId)
      .in('level', ['adset', 'campaign', 'ad'])
      .order('captured_at', { ascending: false })
      .limit(4000)
    if (error) return unavailable(`读广告设置快照失败：${error.message}`)
    const rows = (data ?? []) as SnapRow[]

    // 🔴 `pre_provider` 只能看 `snapshot_pre` 刚抓的那一轮 `kernel_pre` 快照，
    //    不能跟 `daily` / `changed` 等别的抓取轮次混在一起——否则并发或部分
    //    完成的另一轮抓取插入更新行时，这道资金闸会核对到不是「即将执行动作
    //    改前那一刻」的数据。`hoursSinceLastRealChange` 例外：它问的是「距上次
    //    真实设置变化过了多久」，本来就要看全部历史里的 `changed` 行，不受这一轮
    //    快照范围限制。
    const snapshotRows = at === 'pre_provider' ? rows.filter(r => r.capture_reason === 'kernel_pre') : rows

    // ── 解析这次动作真正该看的实体 ──────────────────────────────────────────
    let subject: Subject
    switch (actionKey) {
      case 'ads.pause_unit':
      case 'ads.cut_unit_budget':
      case 'ads.scale_unit_budget': {
        const id = str('adset_id')
        if (!id) return unavailable('input 里没有 adset_id')
        subject = { entityId: id, level: 'adset', learningApplicable: true }
        break
      }
      case 'ads.swap_creative': {
        const adId = str('ad_id')
        if (!adId) return unavailable('input 里没有 ad_id')
        // 换素材会重置**所属广告组**的学习期，所以判据落在那个组上，不是这条广告上。
        const adRow = latestOf(snapshotRows.filter(r => r.level === 'ad' && r.entity_id === adId))
        if (!adRow) return unavailable(`快照里查不到广告 ${adId}，读不到它属于哪个广告组`)
        if (!adRow.adset_id) return unavailable(`广告 ${adId} 的快照里没有所属广告组，判不了学习期`)
        subject = { entityId: adRow.adset_id, level: 'adset', learningApplicable: true }
        break
      }
      case 'ads.add_retargeting_adset': {
        const campaignId = str('campaign_id')
        if (!campaignId) return unavailable('input 里没有 campaign_id')
        // 🔴 要新建的广告组还不存在 → 没有任何东西在学习 → 学习期判据不适用。
        //    这跟「读不到学习期」必须分开，否则这个动作永远过不了闸。
        //    实验归属看它要挂进去的那个广告系列（系列在实验里就别往里加东西）。
        subject = { entityId: campaignId, level: 'campaign', learningApplicable: false }
        break
      }
      case 'ads.budget_move_plan':
        return unavailable('挪预算是计划级动作（先减后加、总额不变），单实体信封判据不适用，这一类走人工放行')
      default:
        return unavailable(`「${actionKey}」没有实体解析规则`)
    }

    const subjectRows = snapshotRows.filter(r => r.level === subject.level && r.entity_id === subject.entityId)
    const target = latestOf(subjectRows)
    if (!target) return unavailable(`快照里查不到 ${subject.level} ${subject.entityId}`)
    // `hoursSinceLastRealChange` 要看全部历史里的 `changed` 行，不受这一轮快照范围限制。
    const subjectRowsAllHistory = rows.filter(r => r.level === subject.level && r.entity_id === subject.entityId)

    // ── 账户当日预算合计 ────────────────────────────────────────────────────
    // 🔴 Meta 有两种预算位，只加广告组级会**系统性少算**，让日上限这道闸偏松：
    //      · CBO（`budget_level='cbo'`）—— 预算在**广告系列**上，旗下广告组自己没有数字
    //      · ABO —— 预算在**每个广告组**上，系列没有
    //    所以：CBO 系列取系列的预算，ABO 系列取旗下广告组预算之和。
    //    这跟 `diagnostics/context.ts` 的 `buildUnits` 是同一套口径 ——
    //    两边算出不同的「账户花多少」会让诊断和信封各说一套。
    const latest = (level: string): Map<string, SnapRow> => {
      const m = new Map<string, SnapRow>()
      for (const r of snapshotRows) {
        if (r.level !== level) continue
        const cur = m.get(r.entity_id)
        if (!cur || Date.parse(r.captured_at) > Date.parse(cur.captured_at)) m.set(r.entity_id, r)
      }
      return m
    }
    const latestCampaigns = latest('campaign')
    const latestAdsets = latest('adset')

    let accountTotal: number | null = null
    if (latestAdsets.size > 0 || latestCampaigns.size > 0) {
      accountTotal = 0
      const cboCampaignIds = new Set<string>()
      for (const c of latestCampaigns.values()) {
        if (c.budget_level !== 'cbo') continue
        cboCampaignIds.add(c.entity_id)
        if (!DELIVERING.has(c.effective_status ?? '')) continue
        if (typeof c.daily_budget_minor === 'number') accountTotal += c.daily_budget_minor
      }
      for (const a of latestAdsets.values()) {
        // CBO 旗下的广告组不再单独计入 —— 钱在系列那一层，重复加就翻倍。
        if (a.campaign_id && cboCampaignIds.has(a.campaign_id)) continue
        if (!DELIVERING.has(a.effective_status ?? '')) continue
        if (typeof a.daily_budget_minor === 'number') accountTotal += a.daily_budget_minor
      }
    }

    const { data: cfg, error: cfgErr } = await deps.sb
      .from('ad_strategy_configs')
      .select('daily_budget_cap_cents')
      .eq('client_id', clientId)
      .maybeSingle<{ daily_budget_cap_cents: number | null }>()
    if (cfgErr) return unavailable(`读客户广告配置失败：${cfgErr.message}`)

    // 新建的单位改动前没有预算（0）；其余类型必须真读到，读不到就是 null → 拒绝。
    const beforeCents = kind === 'new_spend'
      ? 0
      : typeof target.daily_budget_minor === 'number' ? target.daily_budget_minor : null

    const afterRaw = input.after_cents
    const afterCents =
      kind === 'pause' ? 0
      : kind === 'creative_only' ? (beforeCents ?? 0)          // 不碰钱，等于没变
      : typeof afterRaw === 'number' ? afterRaw
      : Number.NaN                                              // 该带却没带 → 纯函数判成无效金额

    const request: EnvelopeRequest = { kind, afterCents }
    const facts: EnvelopeFacts = {
      beforeCents,
      accountDailyTotalBeforeCents: accountTotal,
      dailyCapCents: typeof cfg?.daily_budget_cap_cents === 'number' ? cfg.daily_budget_cap_cents : null,
      hoursSinceLastChange: hoursSinceLastRealChange(subjectRowsAllHistory, now()),
      learningPhaseApplicable: subject.learningApplicable,
      learningStage: target.learning_stage,
      adStudyCount: studyCount(target.ad_studies),
      hasRollbackHandler: typeof deps.capabilities[actionKey]?.rollback === 'function',
    }

    return { request, facts }
  }
}
