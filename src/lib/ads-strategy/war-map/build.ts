import { FATIGUE_FREQUENCY_HIGH } from '../rules/fatigue'
import { D4_AUDIENCE_FLOOR } from '../portfolio/diagnostics/thresholds'
import type {
  WarMapInput,
  WarMapView,
  Light,
  Headline,
  CountdownView,
  AccountView,
  PoolRow,
  PoolTrend,
  FrequencyRow,
  ActionRow,
  ActionSeverity,
  GoalNote,
  AudienceInput,
} from './types'

/** 候选值：目前只有一家客户的证据，换客户观察后再调（红线 7） */
export const POOL_SHRINK_RED = 0.1
export const POOL_GROW_MIN = 0.02
export const POOL_TREND_MIN_DAYS = 5
export const POOL_WINDOW_DAYS = 8
export const MAX_POOL_ROWS = 8

const NZ_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Pacific/Auckland',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function nzDay(iso: string): string {
  return NZ_FORMATTER.format(new Date(iso))
}

export function diffDays(fromDay: string, toDay: string): number {
  const [y1, m1, d1] = fromDay.split('-').map(Number)
  const [y2, m2, d2] = toDay.split('-').map(Number)
  return Math.round(
    (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000,
  )
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

function buildCountdown(input: WarMapInput, today: string): CountdownView {
  if (input.plan === null) {
    return {
      launchDate: null,
      targetDate: null,
      daysToLaunch: null,
      daysToTarget: null,
      phaseName: null,
    }
  }
  const { launchDate, targetDate, phaseName } = input.plan
  return {
    launchDate,
    targetDate,
    daysToLaunch: launchDate ? diffDays(today, launchDate) : null,
    daysToTarget: targetDate ? diffDays(today, targetDate) : null,
    phaseName,
  }
}

function buildAccounts(input: WarMapInput): AccountView[] {
  return input.accounts.map((a) => {
    const name = a.name ?? a.adAccountId
    let light: Light
    let sentence: string
    if (a.statusCode === 1) {
      light = 'green'
      sentence = '正常'
    } else if (a.statusCode === null) {
      light = 'unknown'
      sentence = '读不到账户状态'
    } else if (a.statusCode === 3) {
      light = 'red'
      sentence = '欠款未结，广告停着'
    } else {
      light = 'red'
      sentence = `状态码 ${a.statusCode}，广告可能被限制`
    }
    return {
      adAccountId: a.adAccountId,
      name,
      statusCode: a.statusCode,
      capturedAt: a.capturedAt,
      light,
      sentence,
    }
  })
}

function accountNameMap(accounts: AccountView[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const a of accounts) map.set(a.adAccountId, a.name)
  return map
}

interface TrendResult {
  trend: PoolTrend
  trendNote: string
}

function computeTrend(
  audienceId: string,
  input: WarMapInput,
  today: string,
): TrendResult {
  // 每天只留「最新的一轮」：不依赖输入的排序（读库时是倒序，别的调用方可能是正序）。
  const byDay = new Map<string, { at: string; count: number }>()
  for (const p of input.audienceHistory) {
    if (p.audienceId !== audienceId) continue
    if (p.countLower === null || p.countLower <= D4_AUDIENCE_FLOOR) continue
    const day = nzDay(p.capturedAt)
    const delta = diffDays(day, today)
    if (delta < 0 || delta >= POOL_WINDOW_DAYS) continue
    const cur = byDay.get(day)
    if (!cur || p.capturedAt > cur.at) byDay.set(day, { at: p.capturedAt, count: p.countLower })
  }
  if (byDay.size < POOL_TREND_MIN_DAYS) {
    return {
      trend: 'unknown',
      trendNote: '近 7 天的人数记录不够，长没长判不了',
    }
  }
  const days = [...byDay.keys()].sort()
  const values = days.map((d) => byDay.get(d)?.count ?? 0)
  const firstMed = median(values.slice(0, 3))
  const lastMed = median(values.slice(values.length - 3))
  const change = (lastMed - firstMed) / firstMed
  if (change < -POOL_SHRINK_RED) {
    return {
      trend: 'shrinking',
      trendNote: `近 7 天缩了 ${Math.round(-change * 100)}%`,
    }
  }
  if (change > POOL_GROW_MIN) {
    return {
      trend: 'growing',
      trendNote: `近 7 天在长（+${Math.round(change * 100)}%）`,
    }
  }
  return { trend: 'flat', trendNote: '近 7 天基本没变' }
}

interface SizeResult {
  sizeLower: number | null
  sizeNote: string
  light: Light
  reliable: boolean
}

function computeSize(count: number | null): SizeResult {
  if (count === null || count < 0) {
    return {
      sizeLower: null,
      sizeNote: '人数读不到',
      light: 'unknown',
      reliable: false,
    }
  }
  if (count <= D4_AUDIENCE_FLOOR) {
    return {
      sizeLower: count,
      sizeNote: '显示下限 1,000，真实人数判不了',
      light: 'unknown',
      reliable: false,
    }
  }
  return {
    sizeLower: count,
    sizeNote: `至少 ${fmtInt(count)} 人`,
    light: 'green',
    reliable: true,
  }
}

function countActiveAdsets(audienceId: string, input: WarMapInput): number {
  let count = 0
  for (const adset of input.adsets) {
    if (adset.effectiveStatus !== 'ACTIVE') continue
    if (adset.includedAudienceIds.includes(audienceId)) count += 1
  }
  return count
}

function buildPoolRow(
  a: AudienceInput,
  input: WarMapInput,
  today: string,
  names: Map<string, string>,
): PoolRow {
  const name = a.name ?? a.id
  const accountName = names.get(a.adAccountId) ?? a.adAccountId
  const size = computeSize(a.countLower)

  let trend: PoolTrend
  let trendNote: string
  let light = size.light
  if (!size.reliable) {
    trend = 'unknown'
    trendNote = '近 7 天的人数记录不够，长没长判不了'
  } else {
    const result = computeTrend(a.id, input, today)
    trend = result.trend
    trendNote = result.trendNote
    if (trend === 'shrinking' && light === 'green') light = 'yellow'
  }

  return {
    id: a.id,
    name,
    accountName,
    sizeLower: size.sizeLower,
    sizeNote: size.sizeNote,
    trend,
    trendNote,
    usedByActiveAdsets: countActiveAdsets(a.id, input),
    light,
  }
}

function buildPoolsHeadline(rows: PoolRow[]): Headline {
  const reliable = rows.filter(
    (r) => r.sizeLower !== null && r.sizeLower > D4_AUDIENCE_FLOOR,
  )
  if (reliable.length === 0) {
    return {
      light: 'unknown',
      sentence: '观众池现在判不了：读不到，或者只有显示下限',
    }
  }
  let biggest = 0
  for (const r of reliable) {
    if (r.sizeLower !== null && r.sizeLower > biggest) biggest = r.sizeLower
  }
  const shrinkingCount = rows.filter((r) => r.trend === 'shrinking').length
  if (shrinkingCount > 0) {
    return {
      light: 'yellow',
      sentence: `有 ${shrinkingCount} 个池子近 7 天在缩，最大的池子至少 ${fmtInt(biggest)} 人`,
    }
  }
  const allUnknownTrend = reliable.every((r) => r.trend === 'unknown')
  const tail = allUnknownTrend ? '，近 7 天长没长暂时判不了' : '，没有在缩'
  return {
    light: 'green',
    sentence: `池子够用：最大的至少 ${fmtInt(biggest)} 人${tail}`,
  }
}

function buildPools(
  input: WarMapInput,
  today: string,
  names: Map<string, string>,
): { headline: Headline; rows: PoolRow[]; hiddenCount: number } {
  const allRows = input.audiences.map((a) =>
    buildPoolRow(a, input, today, names),
  )
  const headline = buildPoolsHeadline(allRows)
  const sorted = [...allRows].sort((a, b) => {
    if (a.sizeLower === null && b.sizeLower === null) return 0
    if (a.sizeLower === null) return 1
    if (b.sizeLower === null) return -1
    return b.sizeLower - a.sizeLower
  })
  const rows = sorted.slice(0, MAX_POOL_ROWS)
  const hiddenCount = sorted.length - rows.length
  return { headline, rows, hiddenCount }
}

function buildFrequency(
  input: WarMapInput,
  names: Map<string, string>,
): { headline: Headline; rows: FrequencyRow[] } {
  const active = input.campaigns
    .filter((c) => c.spend7d > 0)
    .sort((a, b) => b.spend7d - a.spend7d)

  const rows: FrequencyRow[] = active.map((c) => {
    const campaignName = c.campaignName ?? c.campaignId
    const accountName = names.get(c.adAccountId) ?? c.adAccountId
    let light: Light
    let note: string
    if (c.frequency7d === null) {
      light = 'unknown'
      note = '没有 7 天频率'
    } else if (c.frequency7d > FATIGUE_FREQUENCY_HIGH) {
      light = 'red'
      note = '高于 3：同一批人在反复看，要换人或降预算'
    } else {
      light = 'green'
      note = '没过红线 3'
    }
    return {
      campaignId: c.campaignId,
      campaignName,
      accountName,
      frequency7d: c.frequency7d,
      spend7d: c.spend7d,
      light,
      note,
    }
  })

  let headline: Headline
  if (rows.length === 0) {
    headline = {
      light: 'unknown',
      sentence: '频率判不了：近 7 天没有花钱的广告',
    }
  } else {
    const redCount = rows.filter((r) => r.light === 'red').length
    const numeric = rows.filter((r) => r.frequency7d !== null)
    if (redCount > 0) {
      headline = {
        light: 'red',
        sentence: `有 ${redCount} 条广告频率高于 3，在反复打扰同一批人`,
      }
    } else if (numeric.length === 0) {
      headline = {
        light: 'unknown',
        sentence: '频率判不了：广告没有 7 天频率',
      }
    } else {
      let max = 0
      for (const r of numeric) {
        if (r.frequency7d !== null && r.frequency7d > max) max = r.frequency7d
      }
      headline = {
        light: 'green',
        sentence: `频率没过高，最高 ${max.toFixed(2)}，红线 3`,
      }
    }
  }

  return { headline, rows }
}

function buildAccountActions(accounts: AccountView[]): ActionRow[] {
  const actions: ActionRow[] = []
  for (const a of accounts) {
    if (a.statusCode === null) {
      actions.push({
        key: `account-status-${a.adAccountId}`,
        severity: 'yellow',
        what: `${a.name} 读不到账户状态`,
        how: '稍后重试；持续读不出来找开发',
        owner: 'dev',
      })
    } else if (a.statusCode !== 1) {
      actions.push({
        key: `account-${a.adAccountId}`,
        severity: 'red',
        what: `${a.name} 广告账户状态异常（状态码 ${a.statusCode}），广告停着`,
        how:
          a.statusCode === 3
            ? '状态码 3 一般是欠款：结清后要看到当天有新数据、线索回流，才算恢复'
            : '去 Ads Manager 看账户提示',
        owner: 'pm',
      })
    }
  }
  return actions
}

function buildCreativeActions(input: WarMapInput): ActionRow[] {
  if (input.creativePoolApproved === 0) {
    return [
      {
        key: 'creative-pool-empty',
        severity: 'red',
        what: '素材池里批准过的素材是 0 条，没有东西可投',
        how: '把过审的视频放进素材池并批准（走视频工厂审查）',
        owner: 'pm',
      },
    ]
  }
  if (input.creativePoolApproved === null) {
    return [
      {
        key: 'creative-pool-unreadable',
        severity: 'yellow',
        what: '读不到素材池',
        how: '稍后重试；持续读不出来找开发',
        owner: 'dev',
      },
    ]
  }
  return []
}

function buildFrequencyActions(rows: FrequencyRow[]): ActionRow[] {
  const actions: ActionRow[] = []
  for (const r of rows) {
    if (r.light !== 'red') continue
    const f = r.frequency7d
    if (f === null) continue
    actions.push({
      key: `freq-${r.campaignId}`,
      severity: 'red',
      what: `${r.campaignName} 频率 ${f.toFixed(2)}，高于 3`,
      how: '先换受众（扩大或轮换），再考虑降预算；改动前先看点击率有没有在掉',
      owner: 'agent',
    })
  }
  return actions
}

function buildPoolActions(rows: PoolRow[]): ActionRow[] {
  const actions: ActionRow[] = []
  for (const r of rows) {
    if (r.trend !== 'shrinking') continue
    actions.push({
      key: `pool-shrink-${r.id}`,
      severity: 'yellow',
      what: `${r.name} 近 7 天缩了`,
      how: '查有没有广告在给它补人；没有就补一条攒池子的视频广告',
      owner: 'agent',
    })
  }
  return actions
}

function buildGrowthActions(input: WarMapInput): ActionRow[] {
  if (input.growth === null) {
    return [
      {
        key: 'growth-missing',
        severity: 'info',
        what: '今天经营视图还没跑',
        how: '等每天巡察；超过一天没有就找开发',
        owner: 'dev',
      },
    ]
  }
  const growth = input.growth
  const anyAccountUnhealthy = input.accounts.some(
    (a) => a.statusCode !== null && a.statusCode !== 1,
  )
  const actions: ActionRow[] = []
  growth.problems.forEach((p, i) => {
    if (p.code === 'D7' && anyAccountUnhealthy) return
    actions.push({
      key: `growth-${p.code}-${i}`,
      severity: 'yellow',
      what: p.title,
      how: p.how ?? '见经营视图',
      owner: 'agent',
    })
  })
  growth.opportunities.forEach((o, i) => {
    actions.push({
      key: `opp-${o.code}-${i}`,
      severity: 'info',
      what: o.title,
      how: '经营视图里有详情；加预算要你本人批',
      owner: 'pm',
    })
  })
  return actions
}

const SEVERITY_ORDER: Record<ActionSeverity, number> = {
  red: 0,
  yellow: 1,
  info: 2,
}

function buildAdjust(
  input: WarMapInput,
  accounts: AccountView[],
  pools: PoolRow[],
  frequencyRows: FrequencyRow[],
): { headline: Headline; actions: ActionRow[] } {
  const actions: ActionRow[] = [
    ...buildAccountActions(accounts),
    ...buildCreativeActions(input),
    ...buildFrequencyActions(frequencyRows),
    ...buildPoolActions(pools),
    ...buildGrowthActions(input),
  ]
  const sorted = actions
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const d = SEVERITY_ORDER[x.a.severity] - SEVERITY_ORDER[y.a.severity]
      return d !== 0 ? d : x.i - y.i
    })
    .map((x) => x.a)

  const redCount = sorted.filter((a) => a.severity === 'red').length
  const yellowCount = sorted.filter((a) => a.severity === 'yellow').length

  let headline: Headline
  if (redCount > 0) {
    const firstRed = sorted.find((a) => a.severity === 'red')
    const what = firstRed ? firstRed.what : ''
    headline = {
      light: 'red',
      sentence: `今天有 ${redCount} 件要处理，最急：${what}`,
    }
  } else if (yellowCount > 0) {
    headline = {
      light: 'yellow',
      sentence: `今天有 ${yellowCount} 件要留意`,
    }
  } else {
    headline = { light: 'green', sentence: '今天没有要调的' }
  }

  return { headline, actions: sorted }
}

function buildGoalNote(input: WarMapInput): GoalNote | null {
  const growth = input.growth
  if (!growth || !growth.goalTitle) return null
  const title = growth.goalTitle
  return {
    title,
    paceReason: growth.paceReason,
    // 🔴 共享代码里不写客户的团名：只说「不是当前推广计划这一轮」。
    warning: `这条进度对的是《${title}》，不是当前推广计划这一轮；停投期间成绩会偏低，别拿它判断新计划`,
  }
}

export function buildWarMap(input: WarMapInput): WarMapView {
  const today = nzDay(input.now)
  const countdown = buildCountdown(input, today)
  const accounts = buildAccounts(input)
  const names = accountNameMap(accounts)
  const pools = buildPools(input, today, names)
  const frequency = buildFrequency(input, names)
  const adjust = buildAdjust(input, accounts, pools.rows, frequency.rows)
  const goalNote = buildGoalNote(input)

  return {
    generatedAt: input.now,
    countdown,
    clocks: input.clocks,
    accounts,
    pools,
    frequency,
    adjust,
    goalNote,
  }
}
