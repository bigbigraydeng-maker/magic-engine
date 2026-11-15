/**
 * Pure three-complete-NZ-day cost rule for one ad set.
 * Not called by the daily breaker yet. The single-day campaign rule still runs.
 * No card is issued here, and nothing calls the ad platform.
 */

export const CPL_WINDOW_DAYS = 3

export interface AdSetSpendRow {
  readonly accountId: string
  readonly campaignId: string
  readonly campaignName: string
  readonly adsetId: string
  readonly adsetName: string
  readonly day: string
  readonly spendCents: number
  readonly primaryCount: number | null
  readonly currency: string | null
  readonly adsetLive: boolean
}

export interface AdSetCplInput {
  readonly nzDate: string | null
  readonly primaryResult: 'lead' | 'messaging_started' | null
  readonly targetCplCents: number | null
  readonly cplMultiple: number
  readonly rows: readonly AdSetSpendRow[]
  readonly readable: boolean
}

export interface AdSetCplPause {
  readonly rule: 'cpl_zero_leads' | 'cpl_over_target'
  readonly accountId: string
  readonly campaignId: string
  readonly campaignName: string
  readonly adsetId: string
  readonly adsetName: string
  readonly summary: string
}

const LEAD_ZERO = '最近三个完整日有花费，但没有线索，花费已经高于约定的目标线索成本倍数。系统没有暂停。请在确认卡上点确认，才会暂停这个广告组。'
const CHAT_ZERO = '最近三个完整日有花费，但没有开聊，花费已经高于约定的目标开聊成本倍数。系统没有暂停。请在确认卡上点确认，才会暂停这个广告组。'
const LEAD_OVER = '最近三个完整日的单次线索成本已经高于约定的目标倍数。系统没有暂停。请在确认卡上点确认，才会暂停这个广告组。'
const CHAT_OVER = '最近三个完整日的单次开聊成本已经高于约定的目标倍数。系统没有暂停。请在确认卡上点确认，才会暂停这个广告组。'

export function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

/** Complete calendar days before `day`, newest first. `day` itself is not included. */
export function completeDaysBefore(day: string | null, count = CPL_WINDOW_DAYS): readonly string[] | null {
  if (!day || count < 1) return null
  const days: string[] = []
  let cursor = day
  for (let index = 0; index < count; index += 1) {
    cursor = previousDay(cursor)
    days.push(cursor)
  }
  return days
}

export function judgeAdSetCpl(input: AdSetCplInput): { pauses: AdSetCplPause[]; unreadable: boolean } {
  const ready = readyGroups(input)
  if (!ready) return { pauses: [], unreadable: false }
  const unreadable = ready.groups.some((row) => row.primaryCount === null && row.spendCents > ready.line && row.adsetLive)
  const pauses = ready.groups
    .filter((row) => row.adsetLive && overPrimary(row, ready.line))
    .map((hit) => pauseOf(hit, summaryFor(input, hit)))
  return { pauses, unreadable }
}

function readyGroups(input: AdSetCplInput): { groups: AdSetSpendRow[]; line: number } | null {
  const days = completeDaysBefore(input.nzDate)
  if (!input.readable || input.targetCplCents === null || !days) return null
  const wanted = new Set(days)
  const window = input.rows.filter((row) => wanted.has(row.day))
  const groups = groupAdSets(window).filter((row) => !currenciesClash(window, row))
  return { groups, line: input.targetCplCents * input.cplMultiple }
}

function overPrimary(row: { primaryCount: number | null; spendCents: number }, line: number): boolean {
  if (row.primaryCount === null) return false
  if (row.primaryCount <= 0) return row.spendCents > line
  return row.spendCents > line * row.primaryCount
}

function summaryFor(input: AdSetCplInput, row: { primaryCount: number | null }): string {
  const chat = input.primaryResult === 'messaging_started'
  if ((row.primaryCount ?? 0) <= 0) return chat ? CHAT_ZERO : LEAD_ZERO
  return chat ? CHAT_OVER : LEAD_OVER
}

function pauseOf(row: AdSetSpendRow, summary: string): AdSetCplPause {
  const rule = row.primaryCount === 0 ? 'cpl_zero_leads' : 'cpl_over_target'
  return {
    rule, summary,
    accountId: row.accountId,
    campaignId: row.campaignId,
    campaignName: cleanName(row.campaignName, '在投的广告系列'),
    adsetId: row.adsetId,
    adsetName: cleanName(row.adsetName, '在投的广告组'),
  }
}

function groupAdSets(rows: readonly AdSetSpendRow[]): AdSetSpendRow[] {
  const map = new Map<string, AdSetSpendRow>()
  for (const row of rows) {
    const key = `${row.accountId}:${row.adsetId}`
    const prior = map.get(key)
    if (!prior) {
      map.set(key, row)
      continue
    }
    const primaryCount = prior.primaryCount === null || row.primaryCount === null
      ? null
      : prior.primaryCount + row.primaryCount
    map.set(key, {
      ...prior,
      spendCents: prior.spendCents + row.spendCents,
      primaryCount,
      adsetLive: prior.adsetLive && row.adsetLive,
    })
  }
  return [...map.values()]
}

function currenciesClash(window: readonly AdSetSpendRow[], group: AdSetSpendRow): boolean {
  const rows = window.filter((row) => row.accountId === group.accountId && row.adsetId === group.adsetId && row.spendCents > 0)
  const names = new Set(rows.map((row) => row.currency))
  return names.size > 1 || names.has(null)
}

function cleanName(name: string, fallback: string): string {
  const cleaned = name.replace(/[{}[\]`]/g, '').trim()
  return cleaned.slice(0, 80) || fallback
}
