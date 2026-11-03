/**
 * 广告起草器的读数层（只读）。
 *
 * 分两段：
 *  1. `buildAdsDraftFacts` —— 纯函数，把已经读到的原始行拼成 `AdsDraftFacts`，可单测。
 *  2. `loadAdsDraftFacts` —— 只读数据库，把每个读失败按规则落到 null / failed，
 *     绝不抛错、绝不把「读不到」当成 0（0 会被起草器当成真实数据用）。
 *
 * 口径与 `launch-budget-headroom.ts` 一致：预算余量交给 `computeLaunchHeadroom` 算，
 * 这里只负责把行喂进去、把结果搬出来。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { loadAdStrategyConfigWithSource } from './config'
import { accountDayKey } from './account-timezone'
import { latestSnapshotsAsOf } from './portfolio/diagnostics/loader'
import { D4_AUDIENCE_FLOOR } from './portfolio/diagnostics/thresholds'
import { computeLaunchHeadroom } from './launch-budget-headroom'
import { DELIVERING_STATUSES } from './portfolio/diagnostics/context'
import type { EntitySnapshotRow } from './portfolio/snapshot'
import type { AdsDraftFacts, HeadroomFact, DailySpendFact, AudiencePoolItem, CreativePoolFact } from '@/lib/marketing-plan/promo/draft-ads'
import type { PromoPlaybook } from '@/lib/marketing-plan/promo/playbooks'

/** 起草器读数的原始输入；每个「读失败」用 null 或 *_read_failed 表示，不用 0 冒充。 */
export interface RawDraftInput {
  now: Date
  /** 广告设置；读失败传 null */
  config: { daily_budget_cap_cents: number | null; approved_creatives: string[]; creative_pool?: CreativePoolFact[] } | null
  /** 该账户日上限（分）；账户行读到了但没设 = null；读失败用 account_cap_read_failed 表示 */
  account_cap_minor: number | null
  account_cap_read_failed: boolean
  /** 近 35 天该账户快照（所有层级，含历史多行）；读失败传 null */
  snapshots: EntitySnapshotRow[] | null
  /** 近 30 天战役层逐日；读失败传 null */
  insights: { insight_date: string; spend: number | string | null; results: number | null; fetched_at: string | null }[] | null
  /** 受众层最新一轮抓取记录；没有记录传 null；读失败 captures_read_failed=true */
  audience_capture: { complete: boolean; skipped_shared: boolean } | null
  captures_read_failed: boolean
  ad_account_id: string
  /** 客户名下全部广告账户编号；传了就会逐个核对「有没有系列层快照 / 快照新不新」 */
  owned_account_ids?: string[]
  committed_minor: number
  committed_all_minor?: number
  budget_share_of_headroom: number
  min_audience_size: number
  max_creatives: number
}

/** 把可能是字符串的金额转成数字；转不出来当 0（只用于逐日汇总，读不到整段会走 null 分支）。 */
function toNumber(v: number | string | null): number {
  if (v === null) return 0
  if (typeof v === 'number') return v
  return Number(v)
}

/** 取 YYYY-MM-DD 部分；拿不到返回 null。 */
function dayOf(ts: string | null): string | null {
  if (typeof ts !== 'string' || ts.length < 10) return null
  return ts.slice(0, 10)
}

/** 在历史快照里，找 captured_at 的日期 ≤ d 的最新一条账户行，取其 account_status。 */
function accountStatusAsOf(rows: readonly EntitySnapshotRow[], d: string): number | null {
  let best: EntitySnapshotRow | null = null
  for (const r of rows) {
    if (r.level !== 'account') continue
    const day = dayOf(r.captured_at)
    if (day === null || day > d) continue
    if (best === null || Date.parse(r.captured_at) > Date.parse(best.captured_at)) best = r
  }
  return best === null ? null : best.account_status
}

/** 现在还有「在投的」广告组挂着这个受众吗：只看最新态快照里在投的广告组，取其最新抓取日期；没有 = null。 */
function lastUsedOn(latestOwn: readonly EntitySnapshotRow[], ref: string): string | null {
  let best: EntitySnapshotRow | null = null
  for (const r of latestOwn) {
    if (r.level !== 'adset') continue
    if (!DELIVERING_STATUSES.has(r.effective_status ?? '')) continue
    const ids = r.included_audience_ids
    if (!Array.isArray(ids) || !ids.includes(ref)) continue
    if (best === null || Date.parse(r.captured_at) > Date.parse(best.captured_at)) best = r
  }
  return best === null ? null : dayOf(best.captured_at)
}

/** 最新态快照里 captured_at 最大的时间戳；没有则 null。 */
function latestCapturedAt(rows: readonly EntitySnapshotRow[]): string | null {
  let best: string | null = null
  for (const r of rows) {
    if (best === null || Date.parse(r.captured_at) > Date.parse(best)) best = r.captured_at
  }
  return best
}

/** 汇总逐日：同一天多行相加；account_status 取该日账户历史快照。 */
function buildDaily(
  insights: RawDraftInput['insights'],
  snapshots: readonly EntitySnapshotRow[],
): { daily: DailySpendFact[] | null; asOf: string | null } {
  if (insights === null) return { daily: null, asOf: null }

  const byDate = new Map<string, { spend: number; results: number }>()
  let asOf: string | null = null
  for (const row of insights) {
    const d = row.insight_date
    const cur = byDate.get(d) ?? { spend: 0, results: 0 }
    const spendNum = toNumber(row.spend)
    // 金额读出来不是有限数字 = 数据有问题，整段逐日当读不到（不能悄悄当成 0 花费）
    if (!Number.isFinite(spendNum)) return { daily: null, asOf: null }
    cur.spend += spendNum
    cur.results += row.results ?? 0
    byDate.set(d, cur)
    if (row.fetched_at !== null && (asOf === null || row.fetched_at > asOf)) asOf = row.fetched_at
  }

  const daily: DailySpendFact[] = []
  for (const d of [...byDate.keys()].sort()) {
    const agg = byDate.get(d)
    if (agg === undefined) continue
    daily.push({
      date: d,
      spend_cents: Math.round(agg.spend * 100),
      results: agg.results,
      account_status: accountStatusAsOf(snapshots, d),
    })
  }
  return { daily, asOf }
}

/** 从最新态快照里取受众池；size_lower 为 null 的保留（过滤在起草器里做）。 */
function buildAudiences(
  latest: readonly EntitySnapshotRow[],
  all: readonly EntitySnapshotRow[],
): AudiencePoolItem[] {
  const out: AudiencePoolItem[] = []
  for (const r of latest) {
    if (r.level !== 'audience') continue
    out.push({
      ref: r.entity_id,
      name: r.entity_name,
      size_lower: r.audience_count_lower,
      last_used_on: lastUsedOn(latest, r.entity_id),
      subtype: r.audience_subtype,
      as_of: r.captured_at,
    })
  }
  return out
}

/** 最新态快照里，在投广告组正在用的排除受众（按用到的广告组数降序，同数按编号升序）。 */
function excludedInUse(latestOwn: readonly EntitySnapshotRow[]): { ref: string; adsets: number }[] {
  const counts = new Map<string, number>()
  for (const r of latestOwn) {
    if (r.level !== 'adset' || !DELIVERING_STATUSES.has(r.effective_status ?? '')) continue
    for (const id of r.excluded_audience_ids ?? []) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts]
    .map(([ref, adsets]) => ({ ref, adsets }))
    .sort((a, b) => b.adsets - a.adsets || (a.ref < b.ref ? -1 : 1))
}

/** 受众层这一轮是否读全：读失败 / 没记录 → null；跳过了共享受众 → false；否则看 complete。 */
function resolveAudiencesComplete(raw: RawDraftInput): boolean | null {
  if (raw.captures_read_failed) return null
  if (raw.audience_capture === null) return null
  if (raw.audience_capture.skipped_shared) return false
  return raw.audience_capture.complete
}

/** 每个账户最新态快照里 captured_at 最大的时间；没有行的账户不出现。 */
function latestCapturePerAccount(latest: readonly EntitySnapshotRow[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of latest) {
    const cur = m.get(r.ad_account_id)
    if (cur === undefined || Date.parse(r.captured_at) > Date.parse(cur)) m.set(r.ad_account_id, r.captured_at)
  }
  return m
}

/** 各账户里最旧的那个「最新抓取时间」（一个账户新鲜不能盖住另一个账户过期）。 */
function oldestAccountCapture(raw: RawDraftInput, latest: readonly EntitySnapshotRow[]): string | null {
  const ids = raw.owned_account_ids ?? [raw.ad_account_id]
  const per = latestCapturePerAccount(latest)
  let oldest: string | null = null
  for (const id of ids) {
    const t = per.get(id)
    if (t === undefined) continue
    if (oldest === null || Date.parse(t) < Date.parse(oldest)) oldest = t
  }
  return oldest
}

const STALE_SNAPSHOT_DAYS = 2

/**
 * 预算余量按「客户全部账户在投预算合计」算，所以每个账户都得读全且够新：
 *  - 任何账户没有系列 / 广告组层快照（共用账户只写账户层，或抓取没跑）→ 它的在投预算会被当成 0，余量被高估，直接读不全；
 *  - 任何账户的快照超过 2 天没更新 → 旧数据会被当成现在在投的预算。
 */
function coverageProblem(raw: RawDraftInput, latest: readonly EntitySnapshotRow[]): string | null {
  const ids = raw.owned_account_ids
  if (ids === undefined) return null
  const per = latestCapturePerAccount(latest)
  for (const id of ids) {
    const hasEntityRows = latest.some(r => r.ad_account_id === id && (r.level === 'campaign' || r.level === 'adset'))
    if (!hasEntityRows) return `广告账户 ${id} 没有系列层快照（共用账户只读账户层，或快照任务没跑），算不出全客户的在投预算`
    const t = per.get(id)
    if (t !== undefined) {
      const ageDays = (raw.now.getTime() - Date.parse(t)) / 86_400_000
      if (ageDays > STALE_SNAPSHOT_DAYS) return `广告账户 ${id} 的快照已 ${Math.floor(ageDays)} 天没更新，在投预算不可信`
    }
  }
  return null
}

/** 纯函数：把原始行拼成起草器要的 facts。不碰数据库、不抛错。 */
export function buildAdsDraftFacts(raw: RawDraftInput): AdsDraftFacts {
  const { now, config, ad_account_id } = raw

  // 1. today：优先用账户快照的时区
  // 快照可能含客户名下全部账户（预算余量要按全客户合计算）；时区 / 状态 / 受众只认选中的这个账户
  const ownSnapshots = raw.snapshots === null ? null : raw.snapshots.filter(r => r.ad_account_id === ad_account_id)
  let tz: string | null = null
  if (ownSnapshots !== null) {
    let bestAccount: EntitySnapshotRow | null = null
    for (const r of ownSnapshots) {
      if (r.level !== 'account') continue
      if (bestAccount === null || Date.parse(r.captured_at) > Date.parse(bestAccount.captured_at)) bestAccount = r
    }
    if (bestAccount !== null) tz = bestAccount.timezone_name
  }
  const today = accountDayKey(tz, now)

  // 2. 最新态快照（已去掉 disappeared）
  const latest = raw.snapshots === null ? [] : latestSnapshotsAsOf(raw.snapshots, now.getTime())
  const latestOwn = latest.filter(r => r.ad_account_id === ad_account_id)

  // 3. headroom
  let headroom: HeadroomFact
  if (config === null) {
    headroom = { ok: false, reason: '广告设置读不出来' }
  } else if (config.daily_budget_cap_cents === null) {
    headroom = { ok: false, reason: '客户日预算总上限没设置' }
  } else if (raw.account_cap_read_failed) {
    headroom = { ok: false, reason: '账户日上限读不出来' }
  } else if (raw.snapshots === null) {
    headroom = { ok: false, reason: '广告快照读不出来' }
  } else if (coverageProblem(raw, latest) !== null) {
    headroom = { ok: false, reason: coverageProblem(raw, latest) as string }
  } else {
    const h = computeLaunchHeadroom({
      rows: latest,
      capMinor: config.daily_budget_cap_cents,
      committed: [],
    })
    if (h.ok === false) {
      headroom = { ok: false, reason: h.reason }
    } else {
      headroom = {
        ok: true,
        headroom_minor: h.headroomAfterMinor,
        delivering_minor: h.deliveringTotalMinor,
        cap_minor: h.capMinor,
        currency: h.currency,
        as_of: oldestAccountCapture(raw, latest) ?? latestCapturedAt(latest),
      }
    }
  }

  // 4. 账户在投合计 / 账户上限
  let account_delivering_minor: number | null = null
  if (headroom.ok === true) {
    const h = computeLaunchHeadroom({
      rows: latest,
      capMinor: headroom.cap_minor,
      committed: [],
    })
    if (h.ok === true) account_delivering_minor = h.perAccountMinor[ad_account_id] ?? 0
  }
  const account_cap_minor = raw.account_cap_read_failed ? null : raw.account_cap_minor

  // 4b. 账户现在的状态（最新一条账户级快照）
  let account_status: number | null = null
  if (ownSnapshots !== null) {
    let newest: EntitySnapshotRow | null = null
    for (const r of ownSnapshots) {
      if (r.level !== 'account') continue
      if (newest === null || Date.parse(r.captured_at) > Date.parse(newest.captured_at)) newest = r
    }
    account_status = newest === null ? null : newest.account_status
  }

  // 5. 逐日
  const { daily, asOf } = buildDaily(raw.insights, ownSnapshots ?? [])

  // 6. 受众池
  const audiences = ownSnapshots === null ? null : buildAudiences(latestOwn, ownSnapshots)

  // 7. 受众层是否读全
  const audiences_complete = resolveAudiencesComplete(raw)

  // 8. 已批准素材
  const approved_creatives = config === null ? null : config.approved_creatives

  return {
    today,
    headroom,
    account_delivering_minor,
    account_cap_minor,
    committed_minor: raw.committed_minor,
    committed_all_minor: raw.committed_all_minor ?? raw.committed_minor,
    daily,
    insights_as_of: asOf,
    account_status,
    audiences,
    audiences_complete,
    approved_creatives,
    creative_pool: config === null ? null : (config.creative_pool ?? null),
    excluded_in_use: ownSnapshots === null ? null : excludedInUse(latestOwn),
    budget_share_of_headroom: raw.budget_share_of_headroom,
    min_audience_size: raw.min_audience_size,
    max_creatives: raw.max_creatives,
  }
}

/** 分页读快照 / 逐日：单键排序分页会漏行，所以用多键稳定排序。 */
const PAGE_SIZE = 1000
const MAX_PAGES = 10

/** 客户名下的广告账户编号；读失败 = null（不当成「没有账户」）。 */
async function readOwnedAccountIds(clientId: string): Promise<string[] | null> {
  const { data, error } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .select('ad_account_id')
    .eq('client_id', clientId)
  if (error) return null
  return ((data ?? []) as { ad_account_id: string }[]).map(r => r.ad_account_id)
}

async function readSnapshots(
  clientId: string,
  adAccountId: string,
  sinceIso: string,
): Promise<EntitySnapshotRow[] | null> {
  const out: EntitySnapshotRow[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabaseAdmin
      .from('ad_entity_snapshots')
      .select('*')
      .eq('client_id', clientId)
      .eq('ad_account_id', adAccountId)
      .gte('captured_at', sinceIso)
      .order('captured_at', { ascending: false })
      .order('level', { ascending: true })
      .order('entity_id', { ascending: true })
      .range(from, to)
    if (error) return null
    const rows = (data ?? []) as EntitySnapshotRow[]
    out.push(...rows)
    if (rows.length < PAGE_SIZE) return out
  }
  // 翻满页数仍然是满页 = 数据被截断：宁可当成读不全，也不拿一份缺了老实体的快照去算余量
  return null
}

async function readInsights(
  clientId: string,
  adAccountId: string,
  sinceDate: string,
): Promise<RawDraftInput['insights']> {
  const out: NonNullable<RawDraftInput['insights']> = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabaseAdmin
      .from('ad_daily_insights')
      .select('insight_date, spend, results, fetched_at')
      .eq('client_id', clientId)
      .eq('ad_account_id', adAccountId)
      .eq('level', 'campaign')
      .gte('insight_date', sinceDate)
      .order('insight_date', { ascending: true })
      .order('fetched_at', { ascending: true })
      .range(from, to)
    if (error) return null
    const rows = (data ?? []) as NonNullable<RawDraftInput['insights']>
    out.push(...rows)
    if (rows.length < PAGE_SIZE) return out
  }
  // 同上：翻满仍是满页 = 被截断（正序读，被截掉的是最新几天），当成读不全
  return null
}

/** 只读：把数据库里的行读出来，交给纯函数拼 facts。任何读失败都落到 null / failed，不抛错。 */
export async function loadAdsDraftFacts(args: {
  clientId: string
  adAccountId: string
  committedMinor: number
  committedAllMinor?: number
  playbook: PromoPlaybook
  now?: Date
}): Promise<AdsDraftFacts> {
  const now = args.now ?? new Date()
  const { clientId, adAccountId } = args

  // 广告设置
  let config: RawDraftInput['config'] = null
  const loaded = await loadAdStrategyConfigWithSource(clientId)
  if (loaded.source !== 'fallback') {
    config = {
      daily_budget_cap_cents: loaded.config.daily_budget_cap_cents,
      approved_creatives: loaded.config.creative_pool
        .filter((p) => p.status === 'approved')
        .map((p) => p.ref),
      creative_pool: loaded.config.creative_pool.map((p) => ({
        ref: p.ref,
        status: p.status,
        ...(p.promo_window ? { promo_window: p.promo_window } : {}),
      })),
    }
  }

  // 账户日上限
  let account_cap_minor: number | null = null
  let account_cap_read_failed = false
  {
    const { data, error } = await supabaseAdmin
      .from('client_meta_ad_accounts')
      .select('daily_budget_cap_cents')
      .eq('client_id', clientId)
      .eq('ad_account_id', adAccountId)
      .maybeSingle()
    if (error || data === null) {
      account_cap_read_failed = true
    } else {
      const v = data.daily_budget_cap_cents
      account_cap_minor = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
    }
  }

  // 快照（近 35 天）：预算余量按客户总上限算，所以要读客户名下**全部**广告账户的在投预算
  const sinceIso = new Date(now.getTime() - 35 * 86_400_000).toISOString()
  const ownedIds = await readOwnedAccountIds(clientId)
  let snapshots: EntitySnapshotRow[] | null = null
  if (ownedIds !== null && ownedIds.includes(adAccountId)) {
    snapshots = []
    for (const acctId of ownedIds) {
      const part = await readSnapshots(clientId, acctId, sinceIso)
      if (part === null) { snapshots = null; break }
      snapshots.push(...part)
    }
  }

  // 逐日（近 30 天）
  const sinceDate = accountDayKey(null, new Date(now.getTime() - 30 * 86_400_000))
  const insights = await readInsights(clientId, adAccountId, sinceDate)

  // 受众抓取记录
  let audience_capture: RawDraftInput['audience_capture'] = null
  let captures_read_failed = false
  {
    const { data, error } = await supabaseAdmin
      .from('ad_snapshot_captures')
      .select('complete, skipped_shared')
      .eq('client_id', clientId)
      .eq('ad_account_id', adAccountId)
      .eq('level', 'audience')
      .order('captured_at', { ascending: false })
      .limit(1)
    if (error) {
      captures_read_failed = true
    } else if (data !== null && data.length > 0) {
      const row = data[0]
      audience_capture = {
        complete: row.complete === true,
        skipped_shared: row.skipped_shared === true,
      }
    }
  }

  return buildAdsDraftFacts({
    now,
    config,
    account_cap_minor,
    account_cap_read_failed,
    snapshots,
    insights,
    audience_capture,
    captures_read_failed,
    ad_account_id: adAccountId,
    owned_account_ids: ownedIds ?? undefined,
    committed_minor: args.committedMinor,
    committed_all_minor: args.committedAllMinor ?? args.committedMinor,
    budget_share_of_headroom: args.playbook.draftBudgetShareOfHeadroom,
    min_audience_size: D4_AUDIENCE_FLOOR,
    max_creatives: args.playbook.draftMaxCreatives,
  })
}
