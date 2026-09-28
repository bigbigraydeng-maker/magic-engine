import type { SupabaseClient } from '@supabase/supabase-js'
import type { DailySpendPoint } from './circuit-detectors'

/** 每次查最多取这么多行。撞上这个数就认为被截断 —— 见 `truncated` 的注释。 */
export const SPEND_WINDOW_ROW_LIMIT = 2000

export interface SpendWindow {
  /** 目标日当天该账户总花费，分。当天完全没有行 → null */
  readonly targetSpendCents: number | null
  /** 目标日**之前** 7 天，每天一个点（当天没有行的那天不出现） */
  readonly previousDays: readonly DailySpendPoint[]
  /**
   * 🔴 查询是否可能被行数上限截断。
   * true = 这份数据**不完整**，调用方必须当"判不了"处理，
   * **绝不能拿一份可能少了行的合计去跟阈值比** —— 少算花费的方向是放行，是 fail-open。
   */
  readonly truncated: boolean
  /** 查询本身失败时的错误原文；成功为 null */
  readonly queryError: string | null
}

/** 窗口长度：targetDate 往前共 8 天（含 targetDate 本身）。 */
const WINDOW_DAYS = 8

/**
 * 把 ISO 日期（YYYY-MM-DD）按 UTC 平移若干天，再输出回 YYYY-MM-DD。
 * 为什么用 UTC：日期算术只关心日历天，用本地时区会在夏令时切换日多算/少算一天。
 */
function shiftIsoDate(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map((part) => Number(part))
  const base = Date.UTC(y, m - 1, d)
  const shifted = new Date(base + deltaDays * 24 * 60 * 60 * 1000)
  const yy = shifted.getUTCFullYear()
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(shifted.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** 数据库返回的一行（只声明我们真正用到的列）。 */
interface SpendRow {
  readonly insight_date: string
  readonly spend: number | string | null
}

/**
 * 从 `ad_daily_insights` 读出熔断判据 #1 需要的花费窗口。
 *
 * 只做取数，不做判断 —— 判断在 `./circuit-detectors.ts` 的 `detectSpendSpike` 里。
 */
export async function readSpendWindow(
  sb: SupabaseClient,
  args: {
    readonly clientId: string
    readonly adAccountId: string
    /** 目标日（ISO，如 '2026-09-26'），由调用方按账户时区算好 */
    readonly targetDate: string
  },
): Promise<SpendWindow> {
  const { clientId, adAccountId, targetDate } = args
  const windowStart = shiftIsoDate(targetDate, -(WINDOW_DAYS - 1))

  const { data, error } = await sb
    .from('ad_daily_insights')
    .select('insight_date, spend')
    .eq('client_id', clientId)
    // 判据 #1 是单账户判据：混进别的账户的花费就不是它了。
    .eq('ad_account_id', adAccountId)
    // 同一天同一账户有 campaign / adset / ad 三种粒度的行，
    // 不过滤会把同一笔花费重复计入两三次，把没超支的账户判成超支。
    .eq('level', 'campaign')
    .gte('insight_date', windowStart)
    .lte('insight_date', targetDate)
    // 显式设上限并检测截断：超出时是静默截断、不报错，
    // "少了几天的花费"看起来就是"那几天没花钱" —— 少算花费 = fail-open。
    .limit(SPEND_WINDOW_ROW_LIMIT)

  if (error) {
    return {
      targetSpendCents: null,
      previousDays: [],
      truncated: false,
      queryError: error.message,
    }
  }

  const rows = (data ?? []) as readonly SpendRow[]
  const truncated = rows.length === SPEND_WINDOW_ROW_LIMIT

  // 先按天把元累加，最后才乘 100 转分。
  // 逐行 Math.round(spend * 100) 再相加会把每行的小数误差累积起来。
  const sumByDate = new Map<string, number>()
  for (const row of rows) {
    const prev = sumByDate.get(row.insight_date) ?? 0
    // spend 为 null 的行按 0 累加（有行但没值）。
    const value = row.spend === null ? 0 : Number(row.spend)
    sumByDate.set(row.insight_date, prev + value)
  }

  const targetSum = sumByDate.get(targetDate)
  // 当天没有任何行 → null（不是 0）。「没有数据」和「花了 0 元」是两件事。
  const targetSpendCents =
    targetSum === undefined ? null : Math.round(targetSum * 100)

  const previousDays: DailySpendPoint[] = []
  for (const [date, sum] of sumByDate) {
    if (date === targetDate) continue
    previousDays.push({ insightDate: date, spendCents: Math.round(sum * 100) })
  }
  // 日期升序（ISO 字符串按字典序即时间序）。
  previousDays.sort((a, b) =>
    a.insightDate < b.insightDate ? -1 : a.insightDate > b.insightDate ? 1 : 0,
  )

  return {
    targetSpendCents,
    previousDays,
    truncated,
    queryError: null,
  }
}
