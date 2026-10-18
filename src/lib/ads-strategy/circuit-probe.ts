/**
 * A0 · 只读熔断探针 —— 「熔断到底判不判得出来」的观察期工具。
 *
 * 背景：五条熔断判据早就写好、有测试、**零调用方**，所以生产库 `ads_circuit_events`
 * 一行都没有、执行前那道闸恒放行（解析器其实早挂好了，`kernel/index.ts`）。
 * 两轮四次复审把「直接接上写入」否了，原因见
 * `docs/specs/2026-10-18-wp32-hanxin-implementation-plan-v0.2.md` 顶部：
 * 绝对硬顶没有来源、拿账户上限当硬顶会让 CTS 约三天必 trip，而那个上限本身
 * 已被日常在投预算突破 2.9 倍 —— **基准是假的，没有真实分布之前不该挑数**。
 *
 * 所以这一刀只做观察：
 *
 * 🔴 **本文件没有任何写入路径。** 不写 `ads_circuit_events`、不建表、不发事件、
 *    不碰孔明出口。它只读、只返回一个结论对象，由调用方落进 `cron_run_logs.summary`。
 *    这比「默认关的开关」强一个量级 —— 没有「哪天有人把开关打开」这件事。
 *    `__tests__/circuit-probe.test.ts` 里有一条测试机械地钉住这句话（扫本文件源码）。
 *
 * 🔴 **它不替绝对硬顶挑数**：`CANDIDATE_ABSOLUTE_CAP_MULTIPLES` 里每个候选倍数
 *    各会判什么，都如实记下来。观察期结束后拿真实分布挑，而不是现在拍一个。
 *
 * 判据复用，一行都不重写：`circuit-detectors.ts`（纯判据）、`circuit-cap-facts.ts`
 * （判据 #2 的四样入参，`AccountSpendFact` 由它组装）、`circuit-spend-window.ts`
 * （判据 #1 的花费窗口）、`account-timezone.ts`（账户时区的完整前一天）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  detectSpendSpike,
  detectClientSpendOverCap,
  detectDataCompleteness,
  type DetectorVerdict,
} from './circuit-detectors'
import { loadClientCapFacts } from './circuit-cap-facts'
import { readSpendWindow } from './circuit-spend-window'
import { accountYesterday, resolveAccountTimezone } from './account-timezone'

/**
 * 观察期要试的几个「绝对硬顶 = 账户上限 × N」候选。
 *
 * 为什么是这几个数：复审拿 CTS 主账户近 14 个有数日算过 —— 上限 $40，
 * ×3（$120）有 4/14 天超过、约三天一次必 trip；要让那 14 天零 trip 至少 ×5（$200）、
 * 留两成余量要 ×6（$240）。×1 一并记下来，是为了看「拿上限本身当硬顶」有多离谱。
 *
 * 🔴 这里**不是**在定阈值，是在记「各个候选会判什么」。真实分布出来后再挑一个。
 */
export const CANDIDATE_ABSOLUTE_CAP_MULTIPLES: readonly number[] = [1, 3, 5, 6]

/**
 * 把绝对分支关掉、单独看相对判据（7 天中位数 × 3）会判什么。
 *
 * `detectSpendSpike` 的绝对硬顶**刻意排在中位数之前**（它自己的注释说明了：
 * 历史不足时绝对硬顶是唯一还能说话的判据）。所以想单独观察相对判据，
 * 只能把硬顶抬到不可能命中 —— 用 `MAX_SAFE_INTEGER` 显式表达这个意图，
 * **不是**偷偷塞一个假阈值去当真判据。
 */
const ABSOLUTE_BRANCH_OFF = Number.MAX_SAFE_INTEGER

/** 一个账户这一天的观察结果。 */
export interface AccountProbe {
  readonly adAccountId: string
  readonly timezone: string | null
  /** 账户时区的「完整前一天」。算不出来就是 null，那一天这个账户判不了 */
  readonly targetDate: string | null
  /** `client_meta_ad_accounts.daily_budget_cap_cents`。null = **未配上限**，单列一类，不混进「判不了」 */
  readonly accountCapCents: number | null
  readonly spendCents: number | null
  readonly medianCents: number | null
  readonly nonZeroDays: number
  /** 花费窗口被行数上限截断 = 这份数据不完整，一律当判不了 */
  readonly truncated: boolean
  readonly queryError: string | null
  /** 相对判据（中位数 × 3）在绝对分支关掉的前提下判什么 */
  readonly relativeKind: DetectorVerdict['kind']
  readonly relativeReason: string | null
  /**
   * 快照里这个账户有没有在投的实体。`false` = 主动停投（休眠账户，观察期要能把它排除，
   * 否则它会每天产出一条 `facts:account_data_stale` 把待办刷满）；`null` = 拿不到快照。
   */
  readonly hasDeliveringEntity: boolean | null
  /**
   * 各候选倍数下，绝对硬顶会不会判 trip。
   * `null` = 判不了（上限未配 / 花费读不到），**不是** false。
   */
  readonly absoluteWouldTrip: Readonly<Record<string, boolean | null>>
}

/** 一个客户这一天的观察结果。 */
export interface ClientProbe {
  readonly clientId: string
  readonly autonomyMode: string
  /** 非 `bounded_auto` 的客户本来就不会自动动手，不观察，如实记原因 */
  readonly skipped: string | null
  /** 判据 #5：当天 `ads_growth_states`。`missing`（没有行）与 `partial`（有行但不全）分开记 */
  readonly dataCompleteness: 'complete' | 'partial' | 'missing' | 'unknown'
  /** 判据 #2（客户全部账户合计 > 客户总闸 × 1.2） */
  readonly clientCapKind: DetectorVerdict['kind']
  readonly clientCapReason: string | null
  readonly accounts: readonly AccountProbe[]
}

function reasonOf(v: DetectorVerdict): string | null {
  return v.kind === 'no_trip' ? null : v.reason
}

/** 判据 #5 的取数：当天那一行在不在、全不全。只读。 */
async function readCompleteness(
  sb: SupabaseClient,
  clientId: string,
  date: string,
): Promise<ClientProbe['dataCompleteness']> {
  const { data, error } = await sb
    .from('ads_growth_states')
    .select('data_completeness')
    .eq('client_id', clientId)
    .eq('date', date)
    .maybeSingle<{ data_completeness: string | null }>()
  if (error) return 'unknown'
  const verdict = detectDataCompleteness({
    targetDate: date,
    row: data ? { dataCompleteness: data.data_completeness ?? '' } : null,
  })
  if (verdict.kind === 'no_trip') return 'complete'
  // 判不了分两种，原因码不同：没有行 vs 有行但不全（判据自己已经分开了）
  return verdict.kind === 'undeterminable' && verdict.reason === 'facts:growth_state_missing'
    ? 'missing'
    : 'partial'
}

/** 一个账户的观察。只读。 */
async function probeAccount(
  sb: SupabaseClient,
  clientId: string,
  adAccountId: string,
  capCents: number | null,
  hasDeliveringEntity: boolean | null,
  now: Date,
): Promise<AccountProbe> {
  const timezone = await resolveAccountTimezone(adAccountId)
  // 🔴 判据 #1 的目标日必须按**账户**时区算（判据自己的注释写明「调用方按账户时区算好」），
  //    不能拿 circuit-cap-facts 给的客户级参考日喂它。
  const targetDate = accountYesterday(timezone, now)

  const base = { adAccountId, timezone, targetDate, accountCapCents: capCents, hasDeliveringEntity }
  const noneTried: Record<string, boolean | null> = {}
  for (const m of CANDIDATE_ABSOLUTE_CAP_MULTIPLES) noneTried[String(m)] = null

  if (targetDate === null) {
    return {
      ...base, spendCents: null, medianCents: null, nonZeroDays: 0, truncated: false,
      queryError: null, relativeKind: 'undeterminable',
      relativeReason: 'facts:account_target_date_unknown', absoluteWouldTrip: noneTried,
    }
  }

  const window = await readSpendWindow(sb, { clientId, adAccountId, targetDate })

  // 🔴 读失败或被截断 = 这份数据不完整，一律判不了。
  //    拿可能缺行的窗口去算中位数、去比阈值，方向是放行（fail-open）。
  if (window.queryError !== null || window.truncated) {
    return {
      ...base, spendCents: window.targetSpendCents, medianCents: null,
      nonZeroDays: window.previousDays.filter((d) => d.spendCents > 0).length,
      truncated: window.truncated, queryError: window.queryError,
      relativeKind: 'undeterminable',
      relativeReason: window.queryError !== null ? 'facts:spend_window_read_failed' : 'facts:spend_window_truncated',
      absoluteWouldTrip: noneTried,
    }
  }

  const relative = detectSpendSpike({
    targetDate,
    previousDays: window.previousDays,
    targetSpendCents: window.targetSpendCents,
    absoluteCapCents: ABSOLUTE_BRANCH_OFF,
  })

  const absoluteWouldTrip: Record<string, boolean | null> = {}
  for (const m of CANDIDATE_ABSOLUTE_CAP_MULTIPLES) {
    // 上限未配（null）或当天花费读不到 → 判不了，不是「没超」
    if (capCents === null || window.targetSpendCents === null) {
      absoluteWouldTrip[String(m)] = null
      continue
    }
    const v = detectSpendSpike({
      targetDate,
      previousDays: window.previousDays,
      targetSpendCents: window.targetSpendCents,
      absoluteCapCents: capCents * m,
    })
    absoluteWouldTrip[String(m)] = v.kind === 'trip' && v.reason === 'circuit:absolute_spend_cap'
  }

  const median = typeof relative.evidence.medianCents === 'number' ? relative.evidence.medianCents : null
  const nonZero = typeof relative.evidence.nonZeroDayCount === 'number' ? relative.evidence.nonZeroDayCount : 0

  return {
    ...base,
    spendCents: window.targetSpendCents,
    medianCents: median,
    nonZeroDays: nonZero,
    truncated: false,
    queryError: null,
    relativeKind: relative.kind,
    relativeReason: reasonOf(relative),
    absoluteWouldTrip,
  }
}

/**
 * 观察一个客户这一天的熔断判据。**只读，不写任何表。**
 *
 * 只观察 `bounded_auto` 的客户：`observe` 的客户本来就不会自动动手，
 * 给它们记结论只是噪音（复审建议）。跳过的如实记原因，不静默忽略。
 */
export async function probeClientCircuit(
  sb: SupabaseClient,
  args: {
    readonly clientId: string
    readonly autonomyMode: string
    readonly now?: Date
  },
): Promise<ClientProbe> {
  const { clientId, autonomyMode } = args
  const now = args.now ?? new Date()

  if (autonomyMode !== 'bounded_auto') {
    return {
      clientId, autonomyMode, skipped: 'not_bounded_auto',
      dataCompleteness: 'unknown', clientCapKind: 'undeterminable',
      clientCapReason: 'skipped:not_bounded_auto', accounts: [],
    }
  }

  const capFacts = await loadClientCapFacts(clientId)

  // 判据 #2：入参由 circuit-cap-facts 组装好，这里一行都不拼
  const clientCap = detectClientSpendOverCap({
    clientReferenceDate: capFacts.clientReferenceDate,
    accounts: capFacts.accounts,
    capCents: capFacts.capCents,
    configSource: capFacts.configSource,
  })

  const completeness = await readCompleteness(sb, clientId, capFacts.clientReferenceDate)

  /**
   * 每账户的日上限要自己读 —— `AccountSpendFact` 里**没有**这一列
   * （它只装花费事实）。取不到就当「未配上限」那一类，不当 0。
   */
  const caps = new Map<string, number | null>()
  const { data: capRows } = await sb
    .from('client_meta_ad_accounts')
    .select('ad_account_id, daily_budget_cap_cents')
    .eq('client_id', clientId)
  for (const row of (capRows ?? []) as Array<{ ad_account_id: string; daily_budget_cap_cents: number | null }>) {
    caps.set(row.ad_account_id, row.daily_budget_cap_cents)
  }

  const accounts: AccountProbe[] = []
  for (const account of capFacts.accounts) {
    accounts.push(
      await probeAccount(
        sb,
        clientId,
        account.adAccountId,
        caps.get(account.adAccountId) ?? null,
        account.hasDeliveringEntity,
        now,
      ),
    )
  }

  return {
    clientId,
    autonomyMode,
    skipped: null,
    dataCompleteness: completeness,
    clientCapKind: clientCap.kind,
    clientCapReason: reasonOf(clientCap),
    accounts,
  }
}
