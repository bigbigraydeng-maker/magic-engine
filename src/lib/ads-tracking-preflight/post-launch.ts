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
import type { Sleep } from './retry'
import type { PostLaunchFacts } from './types'

const ACCOUNT_ID_RE = /^act_\d{6,20}$/
const CAMPAIGN_ID_RE = /^\d{6,20}$/
const MAX_NAME_TOKEN_CHARS = 60
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/

/**
 * 本次投放的广告系列怎么认：编号对得上，或者名字里含全部这些关键词。
 * 为什么要有「名字」这条：用接口建出来的广告系列先躺在广告管理工具的未发布草稿里，
 * 发布之后编号会不会变没法事先验证；名字不会跟着变。两条任意一条对上就算。
 */
export interface CampaignScope {
  ids: readonly string[]
  nameContains: readonly string[]
}

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

function rowInScope(row: Record<string, unknown>, scope: CampaignScope): boolean {
  if (typeof row.campaign_id === 'string' && scope.ids.includes(row.campaign_id)) return true
  const name = row.campaign_name
  return typeof name === 'string' && scope.nameContains.length > 0 && scope.nameContains.every(token => name.includes(token))
}

/**
 * Meta 洞察响应 → 开投后的数字。
 * 给了 scope（按广告系列读）时 Meta 按系列分行返回：只留编号 / 名字对得上的行，每一行各自
 * 「汇总 lead 优先、没有才退用像素留资」，再把各行加起来，免得同一行的两个留资字段重复相加。
 * 不给 scope = 账户级（只有一行）。一行都没有 = 还没花钱 = 全 0。
 */
export function parseInsightsBody(body: unknown, scope?: CampaignScope): PostLaunchNumbers {
  const data = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).data : undefined
  if (!Array.isArray(data)) return { ...ZERO }
  const total: PostLaunchNumbers = { ...ZERO }
  for (const raw of data) {
    if (typeof raw !== 'object' || raw === null) continue
    const row = raw as Record<string, unknown>
    if (scope !== undefined && !rowInScope(row, scope)) continue
    total.spend_cents += Math.round(toNumber(row.spend) * 100)
    total.link_clicks += Math.round(toNumber(row.inline_link_clicks))
    total.landing_page_views += actionValue(row.actions, 'landing_page_view') ?? 0
    // 'lead' 是 Meta 汇总好的留资数；没有汇总才退用像素留资，免得两个相加算重
    total.leads += actionValue(row.actions, 'lead') ?? actionValue(row.actions, 'offsite_conversion.fb_pixel_lead') ?? 0
  }
  return total
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
  /** 本次投放的广告系列编号；和下面的名字关键词任意一条对上就算本次投放。都不给 = 看整个账户 */
  campaignIds?: readonly string[]
  /** 广告系列名字里必须同时含有的关键词（全部含有才算）；草稿发布后编号可能变，名字不会 */
  campaignNameContains?: readonly string[]
  /** 单测里换成不真等的版本；不传就真等 */
  sleep?: Sleep
}

function unread(now: Date, message: string): { facts: PostLaunchFacts; errors: string[] } {
  return { facts: { read: false, error: message, as_of: now.toISOString(), ...ZERO }, errors: [message] }
}

/** 响应里还有下一页吗（paging.next 是字符串）？有 = 我们没读全。 */
function hasNextPage(body: unknown): boolean {
  const paging = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).paging : undefined
  if (typeof paging !== 'object' || paging === null) return false
  return typeof (paging as Record<string, unknown>).next === 'string'
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
  const campaignIds = input.campaignIds ?? []
  const nameContains = input.campaignNameContains ?? []
  if (!campaignIds.every((id) => CAMPAIGN_ID_RE.test(id))) {
    return unread(now, '广告系列编号格式不对（要 6–20 位纯数字）')
  }
  if (!nameContains.every((t) => t.length > 0 && t.length <= MAX_NAME_TOKEN_CHARS && !CONTROL_CHARS_RE.test(t))) {
    return unread(now, '广告系列名称关键词格式不对（不能为空、不超过 60 字）')
  }
  const scope: CampaignScope | undefined =
    campaignIds.length > 0 || nameContains.length > 0 ? { ids: campaignIds, nameContains } : undefined

  const graphGet = makeGraphGet(fetcher, token, input.sleep)

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
  // 按广告系列读：不在服务端过滤（过滤语法没法保证对每种命名都行），拿回按系列分行的结果，在这里按编号 / 名字挑
  const params: Record<string, string> = scope !== undefined
    ? {
        level: 'campaign',
        fields: 'campaign_id,campaign_name,spend,inline_link_clicks,actions',
        time_range: range,
        limit: '500',
      }
    : {
        level: 'account',
        fields: 'spend,inline_link_clicks,actions',
        time_range: range,
      }
  try {
    const body = await graphGet(`${adAccountId}/insights`, params)
    if (hasNextPage(body)) {
      return unread(now, '洞察结果有下一页（广告系列太多，读不全），不当成完整结果')
    }
    return { facts: { read: true, error: null, as_of: now.toISOString(), ...parseInsightsBody(body, scope) }, errors: [] }
  } catch (err) {
    return unread(now, `开投后读回失败：${sanitizeError(err, [token])}`)
  }
}
