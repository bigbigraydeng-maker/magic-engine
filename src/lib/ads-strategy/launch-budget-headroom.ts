/**
 * 上线前「预算余量」核算——按**设定的日预算**算，不按实际花费算。纯函数，不联网、不写库。
 *
 * 为什么单独成文件：Kernel 的加预算上限检查（`capabilities/ads/envelope-facts.ts`）和
 * 诊断（`portfolio/diagnostics/context.ts`）看的都是「各系列/广告组设定的日预算合计」，
 * 但**建系列/激活这一步不经过 Kernel**（接口直建、PM 说开后才激活），没有任何代码在替
 * 执行方算「加了这个新系列后，合计会不会超客户总上限」。2026-10-06 卫青审查上海团方案时
 * 发现方案按「近期实际花费」算余量，算出来比设定口径宽松 $14——上限判据偏松、没人拦。
 * 这个函数就是给激活前那一步用的：读回快照 → 算出设定口径合计 → 对上限 → 给结论。
 *
 * 口径与 `envelope-facts.ts`（账户当日预算合计）、`diagnostics/context.ts`（buildUnits）一致：
 *   · CBO 系列：预算在系列上，旗下广告组不再重复计入
 *   · ABO：预算在每个广告组上
 *   · 只计「在花钱」的（DELIVERING_STATUSES）；`disappeared` 行不计
 * 三处没有自动对账（envelope-facts 的实现是私有闭包，不能直接调）。改任何一处的口径，
 * 必须同步改另外两处——测试里的口径用例就是用来在你改坏时报警的。
 *
 * 🔴 读不全一律拒绝（`ok: false`），不给默认值：在花钱的单位读不到预算、币种混杂、
 *    上限无效，都不能当成「余量充足」。
 */

import { DELIVERING_STATUSES } from './portfolio/diagnostics/context'
import type { EntitySnapshotRow } from './portfolio/snapshot'

export type HeadroomRow = Pick<
  EntitySnapshotRow,
  | 'ad_account_id'
  | 'level'
  | 'entity_id'
  | 'campaign_id'
  | 'budget_level'
  | 'daily_budget_minor'
  | 'effective_status'
  | 'currency'
  | 'capture_reason'
  | 'captured_at'
>

export interface HeadroomUnit {
  adAccountId: string
  level: 'campaign' | 'adset'
  entityId: string
  dailyMinor: number
}

/** 已拍板、还没生效的加钱动作（新系列、再营销加预算等）。 */
export interface CommittedIncrease {
  /** 人话标签，进报告。 */
  label: string
  minor: number
}

export type LaunchHeadroom =
  | {
      ok: true
      currency: string
      /** 现在在花钱的单位，设定日预算合计。 */
      deliveringTotalMinor: number
      perAccountMinor: Record<string, number>
      /**
       * 现在不花钱（暂停 / 被上层暂停）但设了预算的单位合计——**上限，不是预测**。
       * 它们任何一个被打开都会立刻进入上面的合计，所以激活前要知道有多少「潜在预算」。
       */
      latentTotalMinor: number
      latentPerAccountMinor: Record<string, number>
      latentUnits: HeadroomUnit[]
      capMinor: number
      committed: CommittedIncrease[]
      projectedMinor: number
      /** cap − projected；负数 = 超上限。 */
      headroomAfterMinor: number
      fits: boolean
    }
  | { ok: false; reason: string }

const PAUSED_LIKE = new Set(['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'])

const isValidBudget = (v: number | null): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0

/** 每个实体只留最新一条快照（调用方应只传同一轮快照，这里再兜一层）。 */
function latestPerEntity(rows: readonly HeadroomRow[]): HeadroomRow[] {
  const m = new Map<string, HeadroomRow>()
  for (const r of rows) {
    if (r.level !== 'campaign' && r.level !== 'adset') continue
    const key = `${r.ad_account_id}:${r.level}:${r.entity_id}`
    const cur = m.get(key)
    if (!cur || Date.parse(r.captured_at) > Date.parse(cur.captured_at)) m.set(key, r)
  }
  return [...m.values()].filter((r) => r.capture_reason !== 'disappeared')
}

export function computeLaunchHeadroom(args: {
  rows: readonly HeadroomRow[]
  /** 客户日预算总上限（最小货币单位）。 */
  capMinor: number | null
  committed: readonly CommittedIncrease[]
}): LaunchHeadroom {
  const { capMinor, committed } = args
  if (!isValidBudget(capMinor)) return { ok: false, reason: '客户日预算总上限未配置或无效，没有上限就不判余量' }
  for (const c of committed) {
    if (!Number.isSafeInteger(c.minor) || c.minor < 0) return { ok: false, reason: `「${c.label}」的金额无效` }
  }

  const rows = latestPerEntity(args.rows)
  if (rows.length === 0) return { ok: false, reason: '没有读到任何快照，不能判余量' }
  const split = splitSpend(rows)
  if (!split.ok) return split
  const { currency, delivering, latent } = split

  const perAccountMinor: Record<string, number> = {}
  let deliveringTotalMinor = 0
  for (const u of delivering) {
    perAccountMinor[u.adAccountId] = (perAccountMinor[u.adAccountId] ?? 0) + u.dailyMinor
    deliveringTotalMinor += u.dailyMinor
  }
  const latentPerAccountMinor: Record<string, number> = {}
  for (const u of latent) latentPerAccountMinor[u.adAccountId] = (latentPerAccountMinor[u.adAccountId] ?? 0) + u.dailyMinor
  const committedTotal = committed.reduce((s, c) => s + c.minor, 0)
  const projectedMinor = deliveringTotalMinor + committedTotal
  if (!Number.isSafeInteger(projectedMinor)) return { ok: false, reason: '预算合计溢出' }

  return {
    ok: true,
    currency,
    deliveringTotalMinor,
    perAccountMinor,
    latentTotalMinor: latent.reduce((s, u) => s + u.dailyMinor, 0),
    latentPerAccountMinor,
    latentUnits: latent,
    capMinor,
    committed: [...committed],
    projectedMinor,
    headroomAfterMinor: capMinor - projectedMinor,
    fits: projectedMinor <= capMinor,
  }
}

type SpendSplit =
  | { ok: false; reason: string }
  | { ok: true; currency: string; delivering: HeadroomUnit[]; latent: HeadroomUnit[] }

/** 已在投的日预算合计（最小货币单位）。没有行 = 读到了、没有在投。读不全 = null，不能当成 0。 */
export function sumDeliveringDailyMinor(rows: readonly HeadroomRow[]): number | null {
  const latest = latestPerEntity(rows)
  if (latest.length === 0) return 0
  const split = splitSpend(latest)
  if (!split.ok) return null
  const minor = split.delivering.reduce((sum, unit) => sum + unit.dailyMinor, 0)
  return Number.isSafeInteger(minor) ? minor : null
}

function splitSpend(rows: readonly HeadroomRow[]): SpendSplit {
  const currencies = new Set(rows.map((r) => (r.currency ?? '').trim().toUpperCase()))
  if (currencies.size !== 1 || currencies.has('')) {
    return { ok: false, reason: '币种缺失或混杂，不能把不同币种的预算相加' }
  }
  const currency = [...currencies][0]
  const cboCampaigns = new Set(
    rows.filter((r) => r.level === 'campaign' && r.budget_level === 'cbo').map((r) => r.entity_id),
  )
  const delivering: HeadroomUnit[] = []
  const latent: HeadroomUnit[] = []
  for (const r of rows) {
    const placed = placeRow(r, cboCampaigns)
    if (placed === 'skip') continue
    if (typeof placed === 'string') return { ok: false, reason: placed }
    if (placed.bucket === 'delivering') delivering.push(placed.unit)
    else latent.push(placed.unit)
  }
  return { ok: true, currency, delivering, latent }
}

function placeRow(
  r: HeadroomRow,
  cboCampaigns: ReadonlySet<string>,
): 'skip' | string | { bucket: 'delivering' | 'latent'; unit: HeadroomUnit } {
  const status = r.effective_status ?? ''
  const isDelivering = DELIVERING_STATUSES.has(status)
  const isCbo = r.level === 'campaign' && r.budget_level === 'cbo'
  const isAboAdset = r.level === 'adset' && !(r.campaign_id && cboCampaigns.has(r.campaign_id))
  if (r.level === 'campaign' && r.budget_level !== 'cbo') {
    if (isDelivering && r.budget_level !== 'abo') return `在投系列 ${r.entity_id} 的预算层级读不到，不能判余量`
    return 'skip'
  }
  if (!isCbo && !isAboAdset) return 'skip'
  const unit = { adAccountId: r.ad_account_id, level: r.level as 'campaign' | 'adset', entityId: r.entity_id }
  if (isDelivering) {
    if (!isValidBudget(r.daily_budget_minor)) {
      return `在投的${r.level === 'campaign' ? '系列' : '广告组'} ${r.entity_id} 日预算缺失或无效，不能判余量`
    }
    return { bucket: 'delivering', unit: { ...unit, dailyMinor: r.daily_budget_minor } }
  }
  if (PAUSED_LIKE.has(status) && isValidBudget(r.daily_budget_minor)) {
    return { bucket: 'latent', unit: { ...unit, dailyMinor: r.daily_budget_minor } }
  }
  return 'skip'
}
