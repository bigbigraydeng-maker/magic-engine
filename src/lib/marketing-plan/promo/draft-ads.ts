/** 一条依据：PM 看到的「凭什么是这个数」 */
export interface Basis {
  label: string
  value: string
  source: string
  as_of: string | null
}

/**
 * 判别联合：有值就必须有依据；没值就必须写原因。类型层面写不出 { value: 0, basis: [] }，
 * 「读不到」只能落到 ok:false，不可能被悄悄填成 0。
 */
export type Suggestion<T> =
  | { ok: true; value: T; basis: [Basis, ...Basis[]] }
  | { ok: false; why_empty: string }

export interface AdsDraft {
  daily_budget_cents: Suggestion<number>
  audience_ref: Suggestion<string>
  creative_refs: Suggestion<string[]>
  /** 给 PM 的提醒，每条一句话 */
  warnings: string[]
}

export interface DailySpendFact {
  date: string
  spend_cents: number
  results: number
  account_status: number | null
}

export interface AudiencePoolItem {
  ref: string
  name: string | null
  size_lower: number | null
  last_used_on: string | null
  as_of: string | null
}

/** 预算余量：由调用方用 computeLaunchHeadroom 算好传进来。ok:false 表示读不全，不给预算建议 */
export type HeadroomFact =
  | {
      ok: true
      headroom_minor: number
      delivering_minor: number
      cap_minor: number
      currency: string
      as_of: string | null
    }
  | { ok: false; reason: string }

export interface AdsDraftFacts {
  today: string
  headroom: HeadroomFact
  /** 该账户在投预算合计（最小货币单位）；读不到为 null */
  account_delivering_minor: number | null
  /** 该账户日上限（最小货币单位）；没设或读不到为 null */
  account_cap_minor: number | null
  /** 本计划里同账户其它广告步骤已经占用的日预算（最小货币单位），起草时要先扣掉 */
  committed_minor: number
  /** 近 30 天逐日；null = 读不到；[] = 读到了但窗口里没有数据 */
  daily: DailySpendFact[] | null
  insights_as_of: string | null
  /** 现有受众池（已排除「消失」的）；null = 读不到 */
  audiences: AudiencePoolItem[] | null
  /** 受众层这一轮是否读全；null = 不知道。读不全时「池子是空的」不能当成「真没有受众」 */
  audiences_complete: boolean | null
  /** 已批准素材 ref；null = 读不到 */
  approved_creatives: string[] | null
  /** 剧本参数 */
  budget_share_of_headroom: number
  min_audience_size: number
  max_creatives: number
}

/** YYYY-MM-DD 转成「第几天」（按 UTC 日历算，跨月 / 跨年也正确），仅用于窗口切分 */
function dayIndex(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

/** 取 today 之前连续 N 天（不含 today）的逐日数据 */
function windowBefore(daily: DailySpendFact[], today: string, n: number): DailySpendFact[] {
  const t = dayIndex(today)
  return daily.filter(row => {
    const idx = dayIndex(row.date)
    return idx < t && idx >= t - n
  })
}

/** 中位数（不修改入参） */
function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

interface WindowCost {
  /** 窗口天数 */
  days: number
  /** 有效样本结果数 */
  results: number
  /** 有效样本总花费 */
  spend: number
  /** 单条成本；样本不足时为 null */
  cost: number | null
  /** 被剔掉的日期（用于 warnings） */
  dropped: string[]
}

/** 计算某个窗口的历史单条成本，剔除异常日 */
function windowCost(daily: DailySpendFact[], today: string, days: number): WindowCost {
  const rows = windowBefore(daily, today, days)
  const dropped: string[] = []

  // 先按 account_status 剔除
  const afterStatus: DailySpendFact[] = []
  for (const row of rows) {
    if (row.account_status !== null && row.account_status !== 1) {
      dropped.push(row.date)
    } else {
      afterStatus.push(row)
    }
  }

  // 再按「追补暴冲」剔除：该日花费 >= 剔除前窗口内日花费中位数 × 2.5
  const med = median(rows.map((r) => r.spend_cents))
  const kept: DailySpendFact[] = []
  for (const row of afterStatus) {
    if (med > 0 && row.spend_cents >= med * 2.5) {
      dropped.push(row.date)
    } else {
      kept.push(row)
    }
  }

  let spend = 0
  let results = 0
  for (const row of kept) {
    spend += row.spend_cents
    results += row.results
  }

  const cost = results < 20 ? null : spend / results
  return { days, results, spend, cost, dropped }
}

/** 起草日预算建议 */
function draftBudget(f: AdsDraftFacts, warnings: string[]): Suggestion<number> {
  const headroom = f.headroom
  if (headroom.ok === false) {
    return { ok: false, why_empty: `读不全预算余量，这一格留空：${headroom.reason}` }
  }

  // 可用余量 base
  let base = headroom.headroom_minor - f.committed_minor
  if (f.account_cap_minor !== null && f.account_delivering_minor !== null) {
    const accountRoom = f.account_cap_minor - f.account_delivering_minor - f.committed_minor
    base = Math.min(base, accountRoom)
  }
  if (base <= 0) {
    return { ok: false, why_empty: '预算余量已经用完（或被本计划其它广告步骤占满）' }
  }

  let suggested = Math.floor(base * f.budget_share_of_headroom)
  if (suggested <= 0) {
    return { ok: false, why_empty: '余量太小，按比例算不出有意义的预算' }
  }

  const basis: Basis[] = []

  // 预算余量依据
  basis.push({
    label: '预算余量',
    value: `客户上限 ${headroom.cap_minor}，在投合计 ${headroom.delivering_minor}，余量 ${headroom.headroom_minor}（${headroom.currency}）`,
    source: '广告设置 + 广告快照',
    as_of: headroom.as_of,
  })

  // 采用比例依据
  basis.push({
    label: '采用比例',
    value: `按余量的 ${f.budget_share_of_headroom} 取整`,
    source: '剧本参数',
    as_of: null,
  })

  // 近 7 天真实日花费核对
  if (f.daily === null) {
    warnings.push('读不到逐日花费，没法核对真实日花费')
  } else {
    const recent = windowBefore(f.daily, f.today, 7)
    let maxSpend = 0
    for (const row of recent) {
      if (row.spend_cents > maxSpend) maxSpend = row.spend_cents
    }
    if (maxSpend >= headroom.cap_minor * 0.95) {
      suggested = Math.floor(suggested / 2)
      warnings.push('最近真实日花费已经贴近上限，这个建议已经压低')
    }
  }

  // 历史单条成本：30 / 14 / 7 三个窗口
  if (f.daily === null || f.daily.length === 0) {
    basis.push({
      label: '结果换算',
      value: '没有逐日数据，没法换算成结果数',
      source: '广告快照',
      as_of: f.insights_as_of,
    })
  } else {
    const w30 = windowCost(f.daily, f.today, 30)
    const w14 = windowCost(f.daily, f.today, 14)
    const w7 = windowCost(f.daily, f.today, 7)

    for (const w of [w30, w14, w7]) {
      if (w.cost === null) {
        basis.push({
          label: `单条成本（${w.days} 天）`,
          value: `样本不足（${w.results} 条结果），判不了`,
          source: '广告快照',
          as_of: f.insights_as_of,
        })
      } else {
        basis.push({
          label: `单条成本（${w.days} 天）`,
          value: `${Math.round(w.cost)}（${w.results} 条结果）`,
          source: '广告快照',
          as_of: f.insights_as_of,
        })
      }
      if (w.dropped.length > 0) {
        warnings.push(`${w.days} 天窗口剔除了这些日子：${w.dropped.join('、')}`)
      }
    }

    // 只有最近的有效窗口用来换算
    const effective = w7.cost !== null ? w7 : w14.cost !== null ? w14 : w30.cost !== null ? w30 : null
    if (effective === null || effective.cost === null) {
      basis.push({
        label: '结果换算',
        value: '没有可用的单条成本，没法换算成结果数',
        source: '广告快照',
        as_of: f.insights_as_of,
      })
    } else {
      const n = Math.floor(suggested / effective.cost)
      basis.push({
        label: '结果换算',
        value:
          n === 0
            ? `按 ${effective.days} 天口径，这个预算不足 1 条结果`
            : `按 ${effective.days} 天口径，这个预算约等于每天 ${n} 条结果`,
        source: '广告快照',
        as_of: f.insights_as_of,
      })
    }
  }

  return { ok: true, value: suggested, basis: basis as [Basis, ...Basis[]] }
}

/** 起草受众建议 */
function draftAudience(f: AdsDraftFacts): Suggestion<string> {
  if (f.audiences === null) {
    return { ok: false, why_empty: '读不到这个客户的受众池' }
  }
  if (f.audiences.length === 0) {
    if (f.audiences_complete === true) {
      return { ok: false, why_empty: '这个客户名下还没有可用的受众池' }
    }
    return { ok: false, why_empty: '受众快照没读全，不能判断是真没有受众还是没读到' }
  }

  const basis: Basis[] = []
  let unknownSize = 0
  const eligible: AudiencePoolItem[] = []
  for (const item of f.audiences) {
    if (item.size_lower === null) {
      unknownSize += 1
      continue
    }
    if (item.size_lower >= f.min_audience_size) {
      eligible.push(item)
    }
  }

  if (unknownSize > 0) {
    basis.push({
      label: '人数未知',
      value: `${unknownSize} 个人数未知被跳过`,
      source: '受众快照',
      as_of: null,
    })
  }

  if (eligible.length === 0) {
    return { ok: false, why_empty: '受众池里没有人数读得到且达到门槛的受众' }
  }

  // 按 last_used_on 降序（null 最后）、ref 升序
  const sorted = [...eligible].sort((a, b) => {
    const au = a.last_used_on
    const bu = b.last_used_on
    if (au === null && bu === null) return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0
    if (au === null) return 1
    if (bu === null) return -1
    if (au !== bu) return au < bu ? 1 : -1
    return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0
  })

  const chosen = sorted[0]
  basis.push({
    label: '受众',
    value: chosen.name === null ? chosen.ref : chosen.name,
    source: '受众快照',
    as_of: chosen.as_of,
  })
  basis.push({
    label: '人数下限',
    value: chosen.size_lower === null ? '未知' : String(chosen.size_lower),
    source: '受众快照',
    as_of: chosen.as_of,
  })
  basis.push({
    label: '最近被用过',
    value: chosen.last_used_on === null ? '没被用过' : chosen.last_used_on,
    source: '受众快照',
    as_of: chosen.as_of,
  })

  return { ok: true, value: chosen.ref, basis: basis as [Basis, ...Basis[]] }
}

/** 起草素材建议 */
function draftCreatives(f: AdsDraftFacts): Suggestion<string[]> {
  if (f.approved_creatives === null) {
    return { ok: false, why_empty: '读不到素材池' }
  }
  if (f.approved_creatives.length === 0) {
    return { ok: false, why_empty: '素材池里还没有已批准的素材' }
  }

  const taken = f.approved_creatives.slice(0, f.max_creatives)
  const basis: Basis[] = [
    {
      label: '素材',
      value: `已批准共 ${f.approved_creatives.length} 个，取了前 ${taken.length} 个`,
      source: '素材库',
      as_of: null,
    },
  ]
  return { ok: true, value: taken, basis: basis as [Basis, ...Basis[]] }
}

export function draftAdsStep(f: AdsDraftFacts): AdsDraft {
  const warnings: string[] = []
  const daily_budget_cents = draftBudget(f, warnings)
  const audience_ref = draftAudience(f)
  const creative_refs = draftCreatives(f)
  // 固定提醒：不管建议有没有给出来都要说（没有月预算口径，不能让人以为日上限守住了月度总预算）
  warnings.push('这里只按日预算上限算，库里没有月预算口径，月度总预算要另外核。')
  warnings.push('单条成本用的结果口径可能中途改过，库里没有版本记录，请自己核对。')
  return { daily_budget_cents, audience_ref, creative_refs, warnings }
}
