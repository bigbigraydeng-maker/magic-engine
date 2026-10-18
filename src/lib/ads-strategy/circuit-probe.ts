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
import type { AutonomyMode } from './config'
import { readSpendWindow } from './circuit-spend-window'
import { accountYesterday, resolveAccountTimezone } from './account-timezone'
import { isDelivering } from './portfolio/diagnostics/context'
import type { EntitySnapshotRow } from './portfolio/snapshot'

/** 快照回看窗口：照 `circuit-cap-facts.ts` 的 48 小时与行数上限，不另定一套。 */
const SNAPSHOT_LOOKBACK_MS = 48 * 60 * 60 * 1000
const SNAPSHOT_ROW_LIMIT = 2000

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
   * 🔴 **分层记「在不在投」—— 这是 A0 要暴露的一处共享层缺陷**（74 号 10-18 给的实证）。
   *
   * `circuit-cap-facts.ts:147,181` 对系列与广告组做 `.some(isDelivering)`，
   * **只要有一个系列 ACTIVE 就算这个账户在投**。而 CTS 的**次账户**（结尾 0470）实情是：
   * 系列开关开着、名下广告组**全部暂停**，预算在广告组层 → **实际不投放**
   * （手册 §29：系列 ACTIVE + 广告组 PAUSED 是最常见的「假在投」）。
   * 2026-10-18 生产库实查：次账户 48h 内 ACTIVE 广告组 0 条、抓到 16 条；
   * 而**主账户**（结尾 7274）同期有 ACTIVE 广告组，是真在投 —— 两个账户形状不同，
   * 所以这条缺陷的证据在次账户上，别拿主账户的数字说它（复审第 6 节纠正了原注释）。
   * 后果：次账户被当成「在投但数据落后」→ `facts:account_data_stale`
   * → **判据 #2 对 CTS 判不了**。
   *
   * A0 只把两层分开记下来，**不改共享层** —— 改它会改变熔断判什么，
   * 要单独立项过审。这两个数就是那次改动的证据。
   */
  readonly deliveringCampaigns: number | null
  readonly deliveringAdsets: number | null
  /**
   * 快照里抓到的广告组条数。
   * `null` = 判不了（读失败 / 窗口里零行 / 撞行数上限）；
   * `0` = 快照有行但没有广告组级（共用账户），那时「没有在投的组」说明不了问题。
   */
  readonly adsetsSeen: number | null
  /**
   * 各候选倍数下，绝对硬顶会不会判 trip。
   *
   * 🔴 判不了的时候**记原因码，不记 null**。复审第 2 节在生产库里证明：
   * 当前三个被观察账户里，CTS 两个有上限没花费、NAL 有花费没上限，
   * 所以这一栏开头会**每天、每个账户、每个倍数全是判不了** ——
   * 这时候「为什么判不了」就是这份回执的全部信息量，不能让四种原因都长成 null。
   */
  readonly absoluteWouldTrip: Readonly<Record<string, AbsoluteCapOutcome>>
}

/**
 * 绝对硬顶在某个候选倍数下的结论。
 * `true`/`false` = 真判过；字符串 = 判不了，且说清缺的是哪一样。
 */
export type AbsoluteCapOutcome =
  | boolean
  | 'cap_missing'
  | 'spend_missing'
  | 'target_date_unknown'
  | 'spend_window_unusable'

/** 一个客户这一天的观察结果。 */
export interface ClientProbe {
  readonly clientId: string
  readonly autonomyMode: AutonomyMode
  /** 非 `bounded_auto` 的客户本来就不会自动动手，不观察，如实记原因 */
  readonly skipped: string | null
  /** 判据 #5：当天 `ads_growth_states`。`missing`（没有行）与 `partial`（有行但不全）分开记 */
  readonly dataCompleteness: 'complete' | 'partial' | 'missing' | 'unknown'
  /** 判据 #2（客户全部账户合计 > 客户总闸 × 1.2） */
  readonly clientCapKind: DetectorVerdict['kind']
  readonly clientCapReason: string | null
  /**
   * 判据 #2 用的**客户级**参考日（各账户时区昨天里最早那个）。
   * 它跟 `AccountProbe.targetDate`（本账户时区的昨天）可以不是同一天 ——
   * 这是两条判据各自的正确口径，不是错，但回执里不记下来读的人会以为对不上。
   */
  readonly clientReferenceDate: string | null
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

/**
 * 分层数「在投的系列」与「在投的广告组」。只读。
 *
 * 读法照抄 `circuit-cap-facts.ts:142-150`（同一张表、同一个 48 小时回看窗口），
 * 区别只在**不把两层折叠成一个布尔**。
 *
 * 导出只为让测试能直接钉住那两道「判不了」闸：到它的生产路径要先过
 * `loadClientCapFacts`，而那个函数用 `supabaseAdmin` 单例、注入不进替身（复审 C 条）。
 */
export async function readDeliveringByLevel(
  sb: SupabaseClient,
  clientId: string,
  adAccountId: string,
  now: Date,
): Promise<{
  deliveringCampaigns: number | null
  deliveringAdsets: number | null
  adsetsSeen: number | null
}> {
  const since = new Date(now.getTime() - SNAPSHOT_LOOKBACK_MS).toISOString()
  const { data, error } = await sb
    .from('ad_entity_snapshots')
    .select('entity_id, level, effective_status, captured_at')
    .eq('client_id', clientId)
    .eq('ad_account_id', adAccountId)
    .in('level', ['campaign', 'adset'])
    .gte('captured_at', since)
    .order('captured_at', { ascending: false })
    .limit(SNAPSHOT_ROW_LIMIT)

  const nothingKnown = { deliveringCampaigns: null, deliveringAdsets: null, adsetsSeen: null }

  if (error || !Array.isArray(data)) return nothingKnown
  // 🔴 下面两道闸照抄 `circuit-cap-facts.ts:163-170`，一道都不许省 ——
  //    省掉就会把「判不了」记成 0，而 A0 的全部价值在于这几个数是真的。
  //    回看窗口里连一行快照都没有：连快照都拿不到，不是「没有在投的」。
  if (data.length === 0) return nothingKnown
  //    撞到行数上限：可能漏了没扫到的实体，数出来的只会偏小且看不出被截断。
  if (data.length === SNAPSHOT_ROW_LIMIT) return nothingKnown

  // 同一实体可能有多行快照，只认最新那行（已按 captured_at 倒序）
  const latest = new Map<string, { level: string; effective_status: string | null }>()
  for (const row of data as Array<{ entity_id: string; level: string; effective_status: string | null }>) {
    if (!latest.has(row.entity_id)) latest.set(row.entity_id, row)
  }

  let deliveringCampaigns = 0
  let deliveringAdsets = 0
  let adsetsSeen = 0
  for (const row of latest.values()) {
    const live = isDelivering({ effective_status: row.effective_status } as EntitySnapshotRow)
    if (row.level === 'campaign' && live) deliveringCampaigns += 1
    if (row.level === 'adset') {
      adsetsSeen += 1
      if (live) deliveringAdsets += 1
    }
  }
  return { deliveringCampaigns, deliveringAdsets, adsetsSeen }
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
  const noLevels = { deliveringCampaigns: null, deliveringAdsets: null, adsetsSeen: null }
  /** 四个候选倍数全判不了，原因一致。 */
  const allUndeterminable = (why: AbsoluteCapOutcome): Record<string, AbsoluteCapOutcome> =>
    Object.fromEntries(CANDIDATE_ABSOLUTE_CAP_MULTIPLES.map((m) => [String(m), why]))

  if (targetDate === null) {
    return {
      // 🔴 nonZeroDays 这里是「没读过库」不是「零天」——有 relativeReason 兜着，
      //    但别把它当统计口径用。
      ...base, ...noLevels, spendCents: null, medianCents: null, nonZeroDays: 0, truncated: false,
      queryError: null, relativeKind: 'undeterminable',
      relativeReason: 'facts:account_target_date_unknown',
      absoluteWouldTrip: allUndeterminable('target_date_unknown'),
    }
  }

  const delivering = await readDeliveringByLevel(sb, clientId, adAccountId, now)
  const window = await readSpendWindow(sb, { clientId, adAccountId, targetDate })

  // 🔴 读失败或被截断 = 这份数据不完整，一律判不了。
  //    拿可能缺行的窗口去算中位数、去比阈值，方向是放行（fail-open）。
  if (window.queryError !== null || window.truncated) {
    return {
      ...base, ...delivering, spendCents: window.targetSpendCents, medianCents: null,
      nonZeroDays: window.previousDays.filter((d) => d.spendCents > 0).length,
      truncated: window.truncated, queryError: window.queryError,
      relativeKind: 'undeterminable',
      relativeReason: window.queryError !== null ? 'facts:spend_window_read_failed' : 'facts:spend_window_truncated',
      absoluteWouldTrip: allUndeterminable('spend_window_unusable'),
    }
  }

  const relative = detectSpendSpike({
    targetDate,
    previousDays: window.previousDays,
    targetSpendCents: window.targetSpendCents,
    absoluteCapCents: ABSOLUTE_BRANCH_OFF,
  })

  const absoluteWouldTrip: Record<string, AbsoluteCapOutcome> = {}
  for (const m of CANDIDATE_ABSOLUTE_CAP_MULTIPLES) {
    // 🔴 上限未配 / 当天花费读不到 → 判不了，不是「没超」；而且两者要分得开：
    //    前者是 FDE 少填了一个字段（去 Settings 补），后者是取数那一侧断了。
    //    观察期开头全是这两种，分不开就等于这份回执什么都没说。
    if (capCents === null) {
      absoluteWouldTrip[String(m)] = 'cap_missing'
      continue
    }
    if (window.targetSpendCents === null) {
      absoluteWouldTrip[String(m)] = 'spend_missing'
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
    ...delivering,
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
    /**
     * 🔴 收成 `AutonomyMode` 而不是 `string`：下面那句 `!== 'bounded_auto'` 是
     * **唯一**决定观不观察的闸，拼错一个字母会让所有客户静默跳过、回执全是 skipped。
     * 用枚举类型让编译器替这件事把关。
     */
    readonly autonomyMode: AutonomyMode
    readonly now?: Date
  },
): Promise<ClientProbe> {
  const { clientId, autonomyMode } = args
  const now = args.now ?? new Date()

  if (autonomyMode !== 'bounded_auto') {
    return {
      clientId, autonomyMode, skipped: 'not_bounded_auto',
      dataCompleteness: 'unknown', clientCapKind: 'undeterminable',
      clientCapReason: 'skipped:not_bounded_auto', clientReferenceDate: null, accounts: [],
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
    clientReferenceDate: capFacts.clientReferenceDate,
    accounts,
  }
}
