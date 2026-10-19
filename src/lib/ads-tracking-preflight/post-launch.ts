/**
 * 开投后读回：自开投那天起，官方广告账户的花费 / 链接点击 / 落地页浏览 / 留资（只读）。
 *
 * 用法：开投后 1 小时、24 小时各读一次，交给 judge.judgePostLaunch 判灯。
 * 日期按「广告账户自己的时区」算——Meta 的 time_range 就是按账户时区解释的，
 * 用 UTC 日期去问，新西兰上午开投的广告会差一天。
 *
 * 🔴 只读：只发 GET，令牌只进 Authorization 头；读不到就 read=false，绝不当成 0 去判。
 * 🔴 平台通用：不点名任何客户。
 */

import { makeGraphGet } from './meta-reader'
import { sanitizeError } from './sanitize'
import type { PostLaunchFacts } from './types'

const ACCOUNT_ID_RE = /^act_\d{6,20}$/

export type PostLaunchNumbers = Pick<PostLaunchFacts, 'spend_cents' | 'link_clicks' | 'landing_page_views' | 'leads'>

const ZERO: PostLaunchNumbers = { spend_cents: 0, link_clicks: 0, landing_page_views: 0, leads: 0 }

/** 这一刻在指定时区里是哪一天（YYYY-MM-DD）。时区不认识 / 为空 → 退回 UTC 日期。 */
export function dateInTimezone(date: Date, timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone && timezone.length > 0 ? timezone : 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(n) ? n : 0
}

function actionValue(actions: unknown, type: string): number | null {
  if (!Array.isArray(actions)) return null
  for (const raw of actions) {
    if (typeof raw !== 'object' || raw === null) continue
    const a = raw as Record<string, unknown>
    if (a.action_type === type) return toNumber(a.value)
  }
  return null
}

/** Meta 洞察响应（账户级、整个区间合计）→ 开投后的数字。一行都没有 = 还没花钱 = 全 0。 */
export function parseInsightsBody(body: unknown): PostLaunchNumbers {
  const data = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).data : undefined
  const row = Array.isArray(data) && typeof data[0] === 'object' && data[0] !== null ? (data[0] as Record<string, unknown>) : null
  if (row === null) return { ...ZERO }
  return {
    spend_cents: Math.round(toNumber(row.spend) * 100),
    link_clicks: Math.round(toNumber(row.inline_link_clicks)),
    landing_page_views: actionValue(row.actions, 'landing_page_view') ?? 0,
    // 'lead' 是 Meta 汇总好的留资数；没有汇总才退用像素留资，免得两个相加算重
    leads: actionValue(row.actions, 'lead') ?? actionValue(row.actions, 'offsite_conversion.fb_pixel_lead') ?? 0,
  }
}

export interface PostLaunchReadInput {
  adAccountId: string
  token: string
  fetcher: typeof fetch
  now: Date
  /** 开投时刻（ISO） */
  launchedAt: string
  /** 直接指定起始日期（YYYY-MM-DD，广告账户时区）；给了就不再用 launchedAt 去推 */
  sinceDate?: string
}

function unread(now: Date, message: string): { facts: PostLaunchFacts; errors: string[] } {
  return { facts: { read: false, error: message, as_of: now.toISOString(), ...ZERO }, errors: [message] }
}

/** 永不 reject。 */
export async function readPostLaunchFacts(input: PostLaunchReadInput): Promise<{ facts: PostLaunchFacts; errors: string[] }> {
  const { adAccountId, token, fetcher, now } = input
  const launchedMs = Date.parse(input.launchedAt)
  if (!ACCOUNT_ID_RE.test(adAccountId)) return unread(now, '广告账户编号格式不对')
  if (Number.isNaN(launchedMs)) return unread(now, '开投时间读不懂，没法读开投后的数据')
  if (input.sinceDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.sinceDate)) {
    return unread(now, '起始日期格式不对（要 YYYY-MM-DD）')
  }

  const graphGet = makeGraphGet(fetcher, token)

  let timezone: string | null = null
  try {
    const account = await graphGet(adAccountId, { fields: 'timezone_name' })
    const tz = typeof account === 'object' && account !== null ? (account as Record<string, unknown>).timezone_name : null
    timezone = typeof tz === 'string' ? tz : null
  } catch {
    // 查不到账户时区就退用 UTC 日期，不因此放弃读数
  }

  const range = JSON.stringify({
    since: input.sinceDate ?? dateInTimezone(new Date(launchedMs), timezone),
    until: dateInTimezone(now, timezone),
  })
  try {
    const body = await graphGet(`${adAccountId}/insights`, {
      level: 'account',
      fields: 'spend,inline_link_clicks,actions',
      time_range: range,
    })
    return { facts: { read: true, error: null, as_of: now.toISOString(), ...parseInsightsBody(body) }, errors: [] }
  } catch (err) {
    return unread(now, `开投后读回失败：${sanitizeError(err, [token])}`)
  }
}
