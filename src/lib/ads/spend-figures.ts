/**
 * How ad money, account names, and "ROAS is blank" are shown.
 * Pure. No client names, no database. Pages that disagree on spend
 * all call these so the currency and the window stay the same.
 */

const ACT_ID = /^act_\d+$/i

export interface AccountSpendTotal {
  spend: number
  currency: string | null
  period_start: string
  period_end: string
}

export function currencyFromCountry(country: string | null | undefined): 'NZD' | 'AUD' | null {
  const code = (country ?? '').trim().toUpperCase()
  if (code === 'NZ') return 'NZD'
  if (code === 'AU') return 'AUD'
  return null
}

export function adCurrencyPrefix(currency: string | null | undefined): string {
  const code = (currency ?? '').trim().toUpperCase()
  if (code === 'NZD') return 'NZ$'
  if (code === 'AUD') return 'A$'
  if (code === 'USD') return 'US$'
  if (code) return `${code} `
  return ''
}

export function adCurrencyLabel(currency: string | null | undefined): string {
  const code = (currency ?? '').trim().toUpperCase()
  return code || '币种未标明'
}

/** Whole currency units. Never a bare "$", and never compacted to "2.0k". */
export function formatAdMoney(amount: number, currency: string | null | undefined): string {
  if (!Number.isFinite(amount)) return '—'
  const negative = amount < 0
  const [whole, frac] = Math.abs(amount).toFixed(2).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const body = `${negative ? '-' : ''}${grouped}.${frac}`
  const prefix = adCurrencyPrefix(currency)
  if (!prefix) return `${body}（币种未标明）`
  return `${prefix}${body}`
}

export function spendWindowLabel(start: string, end: string): string {
  return `${start} 至 ${end}`
}

/**
 * Name shown to a person. A raw act_ id is an internal account number, not a name.
 * A non-act id (the sample plan's placeholder) is left as written.
 */
export function publicAdAccountName(label: string | null | undefined, id?: string | null): string {
  const clean = label?.trim()
  if (clean && !ACT_ID.test(clean)) return clean
  if (id && !ACT_ID.test(id)) return id
  return '已绑定的广告账户'
}

export interface SpendOutcomeInput {
  roas: number | null
  costPerConversation: number | null
  costPerLead: number | null
  currency: string | null
}

/**
 * Purchase ROAS is null for Messenger / lead accounts on purpose.
 * Show the cost we actually have, or say ROAS does not apply.
 * A dash next to a real spend reads as a broken number.
 */
export function spendOutcome(input: SpendOutcomeInput): { label: string; value: string } {
  if (input.roas != null && Number.isFinite(input.roas)) {
    return { label: 'ROAS', value: `${input.roas.toFixed(2)}×` }
  }
  if (input.costPerConversation != null && Number.isFinite(input.costPerConversation)) {
    return { label: '每次对话成本', value: formatAdMoney(input.costPerConversation, input.currency) }
  }
  if (input.costPerLead != null && Number.isFinite(input.costPerLead)) {
    return { label: '每次线索成本', value: formatAdMoney(input.costPerLead, input.currency) }
  }
  return { label: 'ROAS', value: '不适用（没有成交金额）' }
}

/**
 * Weekly reconcile could not read day-by-day spend.
 * If the data tab's account total exists, cite it and name its window.
 * Do not treat that total as this week's actual.
 */
export function unreadWeeklySpendReason(total: AccountSpendTotal | null | undefined): string {
  if (!total || !Number.isFinite(total.spend) || !total.period_start || !total.period_end) {
    return '广告花费读不出来（数据没同步，或这几天账户没有花费记录，请到广告账户确认是不是停了）'
  }
  const money = formatAdMoney(total.spend, total.currency)
  const window = spendWindowLabel(total.period_start, total.period_end)
  return `本周逐日花费对不上，不能拿来和计划比。广告数据页的账户合计是 ${money}（${window}），那是另一段周期，不是这一周。`
}

export function readObjectiveCosts(raw: unknown): { cost_per_lead: number | null; cost_per_conversation: number | null } {
  if (!raw || typeof raw !== 'object') return { cost_per_lead: null, cost_per_conversation: null }
  const row = raw as Record<string, unknown>
  return {
    cost_per_lead: finiteOrNull(row.cost_per_lead),
    cost_per_conversation: finiteOrNull(row.cost_per_conversation),
  }
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export interface SpendTileReading {
  spend: number | null
  periodLabel: string | null
  currency: string | null
}

/** Spend and its dates are one snapshot. A missing piece blanks both. */
export function accountSpendReading(
  row: { spend?: number | string | null; period_start?: string | null; period_end?: string | null } | null,
  currency: string | null,
): SpendTileReading {
  if (!row?.period_start || !row.period_end) return { spend: null, periodLabel: null, currency }
  const spend = typeof row.spend === 'number' ? row.spend : Number(row.spend)
  if (!Number.isFinite(spend)) return { spend: null, periodLabel: null, currency }
  return { spend, periodLabel: spendWindowLabel(row.period_start, row.period_end), currency }
}

/**
 * Replace a flywheel daily-bucket total with the snapshot it is supposed to describe.
 * Same-day pulls are summed by the bucket, so that total is not one snapshot.
 */
export function alignSpendTile<T extends {
  currentValue: number | null
  value7dAgo: number | null
  value28dAgo: number | null
  deltaPct7d: number | null
  deltaPct28d: number | null
  sparkline: Array<number | null>
  currency?: string | null
  periodLabel?: string | null
}>(tile: T, reading: SpendTileReading): T {
  const sparkline = tile.sparkline.map(() => null as number | null)
  if (reading.spend != null && sparkline.length > 0) sparkline[sparkline.length - 1] = reading.spend
  return {
    ...tile,
    currentValue: reading.spend,
    value7dAgo: null,
    value28dAgo: null,
    deltaPct7d: null,
    deltaPct28d: null,
    sparkline,
    currency: reading.currency,
    periodLabel: reading.periodLabel,
  }
}
