/**
 * 表单留资系列多读的当天数：系列花费和线索、账户花费、各登记账户花费。
 * 只发 GET。令牌只进 Authorization 头（走 makeGraphGet）。读不懂 = null，不是 0。
 */

import { LEAD_ACTION_PRIORITY, pickAction, type MetaActionStat } from '@/lib/meta/objective-metrics'
import { makeGraphGet, type GraphGet } from './meta-reader'
import { dateInTimezone, hasDataArray } from './post-launch'
import type { Sleep } from './retry'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
  return Number.isFinite(n) ? n : null
}

function actionStats(v: unknown): MetaActionStat[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: MetaActionStat[] = []
  for (const raw of v) {
    if (!isRecord(raw) || typeof raw.action_type !== 'string') continue
    const value = typeof raw.value === 'string' ? raw.value : typeof raw.value === 'number' ? String(raw.value) : null
    if (value !== null) out.push({ action_type: raw.action_type, value })
  }
  return out
}

/** 洞察响应加总。没有 data 数组 = 读不懂（null）。空数组 = 当天确实是 0。同一行里的线索只取一种，不把父子动作加在一起。 */
export function parseInsightTotals(body: unknown): { spendCents: number; leads: number } | null {
  if (!hasDataArray(body)) return null
  let spendCents = 0
  let leads = 0
  for (const raw of body.data) {
    if (!isRecord(raw)) return null
    const major = raw.spend === undefined || raw.spend === null ? 0 : num(raw.spend)
    if (major === null) return null
    spendCents += Math.round(major * 100)
    leads += pickAction(actionStats(raw.actions), LEAD_ACTION_PRIORITY)
  }
  return { spendCents, leads }
}

async function readTotals(graphGet: GraphGet, path: string, range: string): Promise<{ spendCents: number; leads: number } | null> {
  try {
    const body = await graphGet(path, { level: path.endsWith('/insights') && path.startsWith('act_') ? 'account' : 'campaign', fields: 'spend,actions', time_range: range, limit: '100' })
    return parseInsightTotals(body)
  } catch {
    return null
  }
}

export interface TodaySpendRead {
  campaignSpendCents: number | null
  campaignLeads: number | null
  accountSpendCents: number | null
  /** 任一登记账户没读到 = null，避免把「少加了一个账户」当成没超总上限 */
  clientSpendCents: number | null
}

/** 按账户时区的今天读花费。时区没有就不读（不退回 UTC）。 */
export async function readTodaySpend(input: {
  graphGet: GraphGet
  adAccountId: string
  campaignId: string
  registeredAccountIds: readonly string[]
  now: Date
  timezone: string | null
}): Promise<TodaySpendRead> {
  if (input.timezone === null) {
    return { campaignSpendCents: null, campaignLeads: null, accountSpendCents: null, clientSpendCents: null }
  }
  const today = dateInTimezone(input.now, input.timezone)
  const range = JSON.stringify({ since: today, until: today })
  const campaign = await readTotals(input.graphGet, `${input.campaignId}/insights`, range)
  const account = await readTotals(input.graphGet, `${input.adAccountId}/insights`, range)
  const perAccount: Array<number | null> = []
  for (const id of input.registeredAccountIds) {
    const accountId = id.startsWith('act_') ? id : `act_${id}`
    if (accountId === input.adAccountId && account !== null) {
      perAccount.push(account.spendCents)
      continue
    }
    const row = await readTotals(input.graphGet, `${accountId}/insights`, range)
    perAccount.push(row === null ? null : row.spendCents)
  }
  const clientSpendCents = perAccount.some(n => n === null) || perAccount.length === 0
    ? null
    : perAccount.reduce((sum, n) => sum + (n ?? 0), 0)
  return {
    campaignSpendCents: campaign === null ? null : campaign.spendCents,
    campaignLeads: campaign === null ? null : campaign.leads,
    accountSpendCents: account === null ? null : account.spendCents,
    clientSpendCents,
  }
}

export async function readAccountTimezone(graphGet: GraphGet, adAccountId: string): Promise<string | null> {
  try {
    const body = await graphGet(adAccountId, { fields: 'timezone_name' })
    const tz = isRecord(body) ? body.timezone_name : null
    return typeof tz === 'string' && tz.length > 0 ? tz : null
  } catch {
    return null
  }
}

export function graphGetFor(fetcher: typeof fetch, token: string, sleep?: Sleep): GraphGet {
  return makeGraphGet(fetcher, token, sleep)
}
