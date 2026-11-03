import type { EnvelopeVerdict } from '@/lib/kernel/autonomy-envelope'
import { MIN_VIABLE_DAILY_CENTS, STOP_LOSS_CUT_RATIO } from '@/lib/ads-strategy/stop-loss'

export const SCALE_STEPS = { up10: 1.1, up20: 1.2 } as const
export type ScaleKind = keyof typeof SCALE_STEPS // 'up10' | 'up20'

/** B-04：同一对象 72 小时内只改一次（Meta 后台人工改的也算） */
export const B04_MIN_HOURS = 72

/**
 * 加完的金额：向下取整（分）。四舍五入在个位是 3/4/8/9 时会多出 1 分，+20% 变成 20.004%，
 * 内核 ±20% 闸会拒、执行时也会报错（魏征 11-04）。
 */
export function scaledAfterCents(currentCents: number, kind: ScaleKind): number {
  return Math.floor(currentCents * SCALE_STEPS[kind])
}

/** 一次最多减 20% 时最低能减到多少：向上取整（分），避免多减 1 分变成 20.004%。 */
export function minReduceCents(currentCents: number): number {
  return Math.ceil(currentCents * (1 - STOP_LOSS_CUT_RATIO))
}

/** 规则手册里系统还没法自动核对的几条；预览里逐条写「没核对」，不假装查过。 */
export const NOT_CHECKED_RULES: readonly string[] = [
  'E-13 ①：30 / 14 / 7 天三个窗口的单个结果成本都不高于客户目标',
  'E-13 ②：最近窗口留资够数（25 条或 20 条，PM 待定）',
  'E-13 ④：账户状态正常、最近没有付款失败',
  'C-06：这个组最近 7 天内没有真改动（冻结期）',
]

export interface BudgetChangeFacts {
  /** 当场从 Meta 读到的当前日预算（分）。读不到 = null */
  readonly currentCents: number | null
  readonly currency: string | null
  /** 当场从 Meta 读到的 updated_time（ISO）。读不到 = null */
  readonly metaUpdatedTime: string | null
  readonly now: Date
  /** 结构上就不能加的原因（共用账户、CBO 系列下还有别的在投组、预算层级读不清……）。null = 结构上可以加 */
  readonly scaleBlockedReason: string | null
  /** 内核 PM 放量信封对 +10% / +20% 的判定；读不到信封事实 = null */
  readonly envelope: { readonly up10: EnvelopeVerdict | null; readonly up20: EnvelopeVerdict | null }
  /** 读信封事实失败时的原因（例如「读不到客户日预算上限」）。读到了 = null */
  readonly envelopeUnavailable: string | null
  /** 客户所有广告账户共用的日预算上限（分）与当前合计（分）。读不到 = null */
  readonly clientDailyCapCents: number | null
  readonly clientDailyTotalCents: number | null
}

export interface ScaleOption {
  readonly kind: ScaleKind
  readonly afterCents: number | null
  readonly allowed: boolean
  /** 不能点时写人话原因；能点时为空数组 */
  readonly reasons: string[]
}

export interface ReduceOption {
  /** 最低能减到多少（一次最多减 20%，且不低于 MIN_VIABLE_DAILY_CENTS）。不能减 = null */
  readonly minAfterCents: number | null
  /** 最高能填多少（必须比现在少，至少少 1 分）。不能减 = null */
  readonly maxAfterCents: number | null
  readonly allowed: boolean
  readonly reasons: string[]
}

export interface BudgetChangePlan {
  readonly currentCents: number | null
  readonly currency: string | null
  /** 距 Meta 上次修改过了多少小时（向下取整）。读不到 = null */
  readonly hoursSinceMetaUpdate: number | null
  /** 客户日上限还剩多少（分）= cap − total。任一读不到 = null；可以是负数 */
  readonly capHeadroomCents: number | null
  readonly up10: ScaleOption
  readonly up20: ScaleOption
  readonly reduce: ReduceOption
  readonly notChecked: readonly string[]
}

function isValidCents(v: number | null): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0
}

function hoursSince(metaUpdatedTime: string | null, now: Date): number | null {
  if (metaUpdatedTime === null) return null
  const t = Date.parse(metaUpdatedTime)
  if (Number.isNaN(t)) return null
  const hours = Math.floor((now.getTime() - t) / 3_600_000)
  return hours < 0 ? 0 : hours
}

function capHeadroom(cap: number | null, total: number | null): number | null {
  if (typeof cap !== 'number' || typeof total !== 'number') return null
  return cap - total
}

function cooldownReason(hours: number | null): string | null {
  if (hours === null) return '读不到 Meta 上次修改这个对象的时间，按刚改过处理'
  if (hours < B04_MIN_HOURS) {
    return `Meta 上显示 ${hours} 小时前刚改过（改名、开关、改受众也算），72 小时内不再加（反复改会打乱 Meta 学习）`
  }
  return null
}

function envelopeReasons(
  facts: BudgetChangeFacts,
  kind: ScaleKind,
): string[] {
  if (facts.envelopeUnavailable !== null) {
    return [`读不到加钱规则要的数：${facts.envelopeUnavailable}`]
  }
  const verdict = facts.envelope[kind]
  if (verdict === null) return ['读不到加钱规则的判定']
  if (verdict.within === false) return [...verdict.reasons]
  return []
}

function planScale(
  facts: BudgetChangeFacts,
  kind: ScaleKind,
  currentCents: number,
  hours: number | null,
): ScaleOption {
  const afterCents = scaledAfterCents(currentCents, kind)
  const reasons: string[] = []
  if (facts.scaleBlockedReason !== null) reasons.push(facts.scaleBlockedReason)
  const cooldown = cooldownReason(hours)
  if (cooldown !== null) reasons.push(cooldown)
  reasons.push(...envelopeReasons(facts, kind))
  if (afterCents <= currentCents) reasons.push('加完的金额没有变多，不能当加预算')
  return { kind, afterCents, allowed: reasons.length === 0, reasons }
}

function planReduce(currentCents: number): ReduceOption {
  const minAfterCents = minReduceCents(currentCents)
  if (minAfterCents < MIN_VIABLE_DAILY_CENTS) {
    return {
      minAfterCents: null,
      maxAfterCents: null,
      allowed: false,
      reasons: [
        `现在每天只有 ${(currentCents / 100).toFixed(2)}，再减就低于 Meta 能接受的最低预算，要停就直接暂停`,
      ],
    }
  }
  return {
    minAfterCents,
    maxAfterCents: currentCents - 1,
    allowed: true,
    reasons: [],
  }
}

function blockedScale(kind: ScaleKind, reason: string): ScaleOption {
  return { kind, afterCents: null, allowed: false, reasons: [reason] }
}

function blockedReduce(reason: string): ReduceOption {
  return { minAfterCents: null, maxAfterCents: null, allowed: false, reasons: [reason] }
}

export function planBudgetChange(facts: BudgetChangeFacts): BudgetChangePlan {
  const hours = hoursSince(facts.metaUpdatedTime, facts.now)
  const headroom = capHeadroom(facts.clientDailyCapCents, facts.clientDailyTotalCents)

  if (!isValidCents(facts.currentCents)) {
    const reason = '读不到当前日预算'
    return {
      currentCents: null,
      currency: facts.currency,
      hoursSinceMetaUpdate: hours,
      capHeadroomCents: headroom,
      up10: blockedScale('up10', reason),
      up20: blockedScale('up20', reason),
      reduce: blockedReduce(reason),
      notChecked: NOT_CHECKED_RULES,
    }
  }

  const currentCents = facts.currentCents
  return {
    currentCents,
    currency: facts.currency,
    hoursSinceMetaUpdate: hours,
    capHeadroomCents: headroom,
    up10: planScale(facts, 'up10', currentCents, hours),
    up20: planScale(facts, 'up20', currentCents, hours),
    reduce: planReduce(currentCents),
    notChecked: NOT_CHECKED_RULES,
  }
}

export function validateReduceTarget(
  plan: BudgetChangePlan,
  targetCents: number,
): { ok: true } | { ok: false; reason: string } {
  if (!plan.reduce.allowed) {
    return { ok: false, reason: plan.reduce.reasons[0] ?? '这个组现在不能减预算' }
  }
  if (!Number.isSafeInteger(targetCents)) {
    return { ok: false, reason: '目标金额不是有效的整数（分）' }
  }
  const { minAfterCents, maxAfterCents } = plan.reduce
  if (minAfterCents === null || maxAfterCents === null) {
    return { ok: false, reason: '这个组现在不能减预算' }
  }
  if (targetCents < minAfterCents) {
    return {
      ok: false,
      reason: `一次最多减 20%，最低只能减到 ${(minAfterCents / 100).toFixed(2)}`,
    }
  }
  if (targetCents > maxAfterCents) {
    return { ok: false, reason: '目标金额要比现在少' }
  }
  return { ok: true }
}
