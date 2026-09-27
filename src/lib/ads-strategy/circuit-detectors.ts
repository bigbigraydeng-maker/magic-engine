/** 一条判据算出来的结论。 */
export type DetectorVerdict =
  | { readonly kind: 'trip'; readonly reason: string; readonly sticky: boolean; readonly evidence: Record<string, unknown> }
  | { readonly kind: 'no_trip'; readonly evidence: Record<string, unknown> }
  | { readonly kind: 'undeterminable'; readonly reason: string; readonly evidence: Record<string, unknown> }

/** `ad_daily_insights` 里按天汇总后的一行（调用方已按账户 + 日期 group 过）。 */
export interface DailySpendPoint {
  /** ISO 日期，形如 '2026-09-26' */
  readonly insightDate: string
  /** 当天该账户总花费，单位**分**（调用方已换算，这里不做单位换算） */
  readonly spendCents: number
}

/** `ads_growth_states` 那一天的行。查不到行时调用方传 null。 */
export interface GrowthStateRow {
  readonly dataCompleteness: string
}

/** 中位数样本下限：少于这个数，倍数判据没有统计意义。 */
const MIN_NON_ZERO_DAYS = 5

/** 相对倍数阈值：严格大于才熔断。 */
const SPIKE_MULTIPLIER = 3

/**
 * 偶数个样本时取中间两个的平均，奇数个取正中间。
 * 单独抽出来是因为"中位数怎么算"是判据的核心语义，混在 detectSpendSpike 里会看不清。
 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[mid]
  }
  return (sorted[mid - 1] + sorted[mid]) / 2
}

export function detectSpendSpike(args: {
  /** 要判的那一天（"完整前一天"，调用方按账户时区算好） */
  readonly targetDate: string
  /** targetDate 之前 7 天的花费点（不含 targetDate 本身），顺序不保证 */
  readonly previousDays: readonly DailySpendPoint[]
  /** targetDate 当天的花费，分。null = 当天根本没有数据行 */
  readonly targetSpendCents: number | null
  /** 绝对硬顶，分。超过它无论中位数多少都熔断 */
  readonly absoluteCapCents: number
}): DetectorVerdict {
  const { targetDate, previousDays, targetSpendCents, absoluteCapCents } = args

  const nonZeroSpends = previousDays
    .map((point) => point.spendCents)
    .filter((spend) => spend > 0)
  const nonZeroDayCount = nonZeroSpends.length
  const medianCents = nonZeroDayCount > 0 ? median(nonZeroSpends) : null

  const evidence: Record<string, unknown> = {
    targetDate,
    targetSpendCents,
    nonZeroDayCount,
    medianCents,
    absoluteCapCents,
  }

  // 不知道花了多少，就不能说"没超"——缺失事实必须显式暴露，不能被当成安全。
  if (targetSpendCents === null) {
    return { kind: 'undeterminable', reason: 'facts:spend_missing_for_target_day', evidence }
  }

  // 绝对硬顶不依赖历史，所以必须排在中位数之前：历史不足时相对判据会 undeterminable，
  // 那时绝对硬顶是唯一还能说话的判据。
  if (targetSpendCents > absoluteCapCents) {
    return { kind: 'trip', reason: 'circuit:absolute_spend_cap', sticky: false, evidence }
  }

  // 样本太少时算出来的倍数没有意义——这是"判不了"，不是"没超"。
  if (nonZeroDayCount < MIN_NON_ZERO_DAYS) {
    return { kind: 'undeterminable', reason: 'facts:not_enough_spend_days', evidence }
  }

  // medianCents 在 nonZeroDayCount >= 5 时必然非 null，这里只是让类型收窄。
  if (medianCents !== null && targetSpendCents > medianCents * SPIKE_MULTIPLIER) {
    return { kind: 'trip', reason: 'circuit:spend_spike', sticky: false, evidence }
  }

  return { kind: 'no_trip', evidence }
}

export function detectDataCompleteness(args: {
  readonly targetDate: string
  /** 那一天的行。**查不到行时传 null** */
  readonly row: GrowthStateRow | null
}): DetectorVerdict {
  const { targetDate, row } = args
  const dataCompleteness = row === null ? null : row.dataCompleteness
  const evidence: Record<string, unknown> = { targetDate, dataCompleteness }

  // 查不到行 = 这一天根本没算过，和"算过但数据不全"根因不同、处置不同，
  // 所以 reason 必须分开，不能合并。
  if (row === null) {
    return { kind: 'undeterminable', reason: 'facts:growth_state_missing', evidence }
  }

  if (row.dataCompleteness === 'complete') {
    return { kind: 'no_trip', evidence }
  }

  // 数据不全时当天不动手，第二天数据补上自然恢复——这是"当轮冻结"，不是熔断，
  // 返回 trip 会让它变成需要人解除的熔断事件，那是错的。
  return { kind: 'undeterminable', reason: 'facts:data_partial', evidence }
}

/** 配置从哪来的。照抄 `./config.ts` 里那个同名类型的取值，不要 import 它。 */
export type DetectorConfigSource = 'row' | 'default' | 'fallback'

/** 一个广告账户的花费事实（调用方已从库里取好）。 */
export interface AccountSpendFact {
  readonly adAccountId: string
  /** 这个账户自己**最后一个完整**的数据日期（ISO，如 '2026-09-26'）。null = 完全没有数据 */
  readonly lastCompleteDate: string | null
  /** 那一天的花费，分。`lastCompleteDate` 为 null 时必须为 null */
  readonly spendCents: number | null
  /**
   * 快照里这个账户**有没有在投的实体**。
   * true = 还在花钱 · false = 主动停投了 · null = 拿不到快照
   */
  readonly hasDeliveringEntity: boolean | null
  /** 账户币种，如 'NZD'。null = 拿不到 */
  readonly currency: string | null
}

/** 单个账户的贡献判定结果：要么给出贡献值，要么给出卡住的原因。 */
type AccountContribution =
  | { readonly ok: true; readonly contributedCents: number }
  | { readonly ok: false; readonly reason: string }

/**
 * 判一个账户往客户级合计里贡献多少花费。
 * 抽出来是因为"哪种情况算 0、哪种情况算判不了"是这条判据的核心语义，
 * 混在主函数里会看不清，也容易在改动时把"主动停投"误改成"一律作废"。
 */
function accountContribution(
  account: AccountSpendFact,
  clientReferenceDate: string,
): AccountContribution {
  const { lastCompleteDate, spendCents, hasDeliveringEntity } = account

  // 数据比参考日还新：不该发生，说明调用方算错了参考日或数据串了，不能猜。
  if (lastCompleteDate !== null && lastCompleteDate > clientReferenceDate) {
    return { ok: false, reason: 'facts:account_date_ahead' }
  }

  // 数据正好是参考日：直接用当天花费。spendCents 缺失按 0 处理（有行但没值）。
  if (lastCompleteDate === clientReferenceDate) {
    return { ok: true, contributedCents: spendCents ?? 0 }
  }

  // 到这里 lastCompleteDate 要么是 null，要么严格早于参考日。
  // 主动停投（hasDeliveringEntity === false）时数据会一直落后，但知道它没在花钱，
  // 所以按 0 计入、继续判——否则被永久停投的账户会让上限闸永远不生效（fail-open）。
  if (hasDeliveringEntity === false) {
    return { ok: true, contributedCents: 0 }
  }

  // 没数据、也不知道在不在花钱：合计里缺一个账户的数，不能拿去比上限。
  if (lastCompleteDate === null) {
    return { ok: false, reason: 'facts:account_data_missing' }
  }

  // 数据落后 + 在投 = 可能在花但看不见。
  if (hasDeliveringEntity === true) {
    return { ok: false, reason: 'facts:account_data_stale' }
  }

  // 数据落后 + 连快照都拿不到。
  return { ok: false, reason: 'facts:snapshot_unavailable' }
}

export function detectClientSpendOverCap(args: {
  /** 客户时区下的「完整前一天」，所有账户都跟它比 */
  readonly clientReferenceDate: string
  readonly accounts: readonly AccountSpendFact[]
  /** 客户级日预算上限，分。null = 没配 */
  readonly capCents: number | null
  readonly configSource: DetectorConfigSource
}): DetectorVerdict {
  const { clientReferenceDate, accounts, capCents, configSource } = args

  const baseEvidence: Record<string, unknown> = {
    clientReferenceDate,
    capCents,
    configSource,
    accountCount: accounts.length,
    totalCents: null,
    perAccount: null,
  }

  // 第一组：配置取不到就别判。三条互斥、reason 必须不同——
  // 「读配置失败」是不知道（要喊人），后两条是已知的没有（正常状态），处置不同。
  if (configSource === 'fallback') {
    return { kind: 'undeterminable', reason: 'facts:config_read_failed', evidence: baseEvidence }
  }
  if (configSource === 'default') {
    return { kind: 'undeterminable', reason: 'facts:no_strategy_config', evidence: baseEvidence }
  }
  if (capCents === null) {
    return { kind: 'undeterminable', reason: 'facts:cap_not_configured', evidence: baseEvidence }
  }

  // 没有账户就没有花费可合计，这是确定的"没超"，不是判不了。
  if (accounts.length === 0) {
    return { kind: 'no_trip', evidence: baseEvidence }
  }

  // 第二组：逐个账户算贡献。任何一个判不了，整条判据就判不了。
  const perAccount: { adAccountId: string; contributedCents: number }[] = []
  let totalCents = 0
  for (const account of accounts) {
    const contribution = accountContribution(account, clientReferenceDate)
    if (!contribution.ok) {
      return {
        kind: 'undeterminable',
        reason: contribution.reason,
        evidence: { ...baseEvidence, blockedByAccountId: account.adAccountId },
      }
    }
    perAccount.push({ adAccountId: account.adAccountId, contributedCents: contribution.contributedCents })
    totalCents += contribution.contributedCents
  }

  const evidence: Record<string, unknown> = { ...baseEvidence, totalCents, perAccount }

  // 第三组：币种闸。只看贡献 > 0 的账户——贡献 0 的没往合计里加钱，币种无关。
  const payingAccounts = accounts.filter((_, index) => perAccount[index].contributedCents > 0)
  const currencies = new Set<string>()
  for (const account of payingAccounts) {
    if (account.currency === null) {
      return { kind: 'undeterminable', reason: 'facts:currency_unknown', evidence }
    }
    currencies.add(account.currency)
  }
  // 把 NZD 和 AUD 的分数加起来去比一个上限，得到的数没有意义，所以不许默默相加。
  if (currencies.size > 1) {
    return { kind: 'undeterminable', reason: 'facts:currency_mismatch', evidence }
  }

  // 第四组：比上限。用整数运算避免 capCents * 1.2 的浮点误差，判据是严格大于。
  if (totalCents * 10 > capCents * 12) {
    return { kind: 'trip', reason: 'circuit:client_daily_cap_exceeded', sticky: false, evidence }
  }

  return { kind: 'no_trip', evidence }
}
