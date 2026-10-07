/**
 * 今日待办里的「价格数字核对不过，整批发不出去」。
 *
 * 数据来源：`social_plans` 里最新的每日计划（plan_kind = campaign_daily_v1）。
 * 发布路由现在会对价格数字对不上的帖子返回 409 —— 但没人看得见 409，
 * 所以要在**发布之前**把这件事摆到待办里：被拦下的帖子必须一直可见，不能悄悄消失。
 *
 * 拉模式：直接查库，事件丢了、进程重启了，待办照样出得来。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { buildPostPriceText, judgePostPriceFacts, loadOfferPriceFacts } from '@/lib/content/price-fact-gate'
import { factoryConfigHref } from '@/lib/factory/config-link'

const LOOKBACK_DAYS = 14
const MAX_PLANS = 60
const NZ_TZ = 'Pacific/Auckland'

/** True for a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a nested property from an unknown value, or undefined. */
function readPath(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined
  return value[key]
}

/** A string, or '' for anything else. */
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

interface PlanPost {
  hook: string
  body: string
  cta: string
  ctaUrl: string | null
}

interface PlanBundle {
  date: string
  post: PlanPost | null
}

/** Narrow one bundle entry; returns null when there is no usable post. */
function narrowBundle(value: unknown): PlanBundle | null {
  if (!isRecord(value)) return null
  const date = str(value.date)
  const postRaw = value.post
  if (!isRecord(postRaw)) return { date, post: null }
  return {
    date,
    post: {
      hook: str(postRaw.hook),
      body: str(postRaw.body),
      cta: str(postRaw.cta),
      ctaUrl: typeof postRaw.cta_url === 'string' ? postRaw.cta_url : null,
    },
  }
}

/** Narrow plan_data.bundles[] defensively. */
function narrowBundles(planData: unknown): PlanBundle[] {
  const raw = readPath(planData, 'bundles')
  if (!Array.isArray(raw)) return []
  const out: PlanBundle[] = []
  for (const entry of raw) {
    const bundle = narrowBundle(entry)
    if (bundle) out.push(bundle)
  }
  return out
}

/** Collect the set of already-published dates from plan_data.publish_meta.published[]. */
function publishedDates(planData: unknown): Set<string> {
  const published = readPath(readPath(planData, 'publish_meta'), 'published')
  const out = new Set<string>()
  if (!Array.isArray(published)) return out
  for (const entry of published) {
    const date = str(readPath(entry, 'date'))
    if (date) out.add(date)
  }
  return out
}

/** YYYY-MM-DD of `now` in Pacific/Auckland. */
function nzDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NZ_TZ }).format(now)
}

interface BlockedPost {
  date: string
  message: string
}

/** Judge every future, not-yet-published post; return the blocked ones. */
function collectBlocked(
  bundles: PlanBundle[],
  published: Set<string>,
  today: string,
  offers: Awaited<ReturnType<typeof loadOfferPriceFacts>>,
): BlockedPost[] {
  const blocked: BlockedPost[] = []
  for (const bundle of bundles) {
    if (!bundle.post) continue
    if (!bundle.date || bundle.date < today) continue
    if (published.has(bundle.date)) continue
    const text = buildPostPriceText({
      hook: bundle.post.hook,
      body: bundle.post.body,
      cta: bundle.post.cta,
      cta_url: bundle.post.ctaUrl,
    })
    const verdict = judgePostPriceFacts({ text, ctaUrl: bundle.post.ctaUrl, offers })
    if (verdict.blocked) blocked.push({ date: bundle.date, message: verdict.message })
  }
  return blocked
}

/** Build the single to-do item for one client's blocked posts. */
function buildItem(
  clientId: string,
  clientName: string,
  blocked: BlockedPost[],
): ManualItem {
  const shown = blocked.slice(0, 3).map((b) => b.date).join('、')
  const dates = blocked.length > 3 ? `${shown} 等` : shown
  const firstMessage = blocked[0]?.message ?? ''
  return {
    kind: 'price_fact_unverified',
    client_id: clientId,
    client_name: clientName,
    what:
      `${clientName} 本周的发布计划整批发不出去：${blocked.length} 条帖子（${dates}）里写的价格，跟客户资料里的价格对不上，系统就把整批暂停了——` +
      `包括价格没问题的那些。第一条的问题：${firstMessage}`,
    how:
      '先对照客户官网上的团页，看帖子里的价格对不对。' +
      '【价格确实写错了】这个页面上改不了文案，回我一句「重出 ' + (blocked[0]?.date ?? '') + ' 的文案」，我按官网价格重出。' +
      '【价格没错，只是资料里没有这一项】点这个链接，打开「视频工厂配置」里的「资料包」，找到这个团（没有就点「+ 新增资料包」），点「+ 加一个字段」逐项补上：' +
      '字段名 tour、值填官网上的团名；字段名 url、值填这个团的网页地址（帖子里的链接）；' +
      '字段名 single_supplement、值填官网原话的单人房加价，例如 NZD $400；字段名 tips、值填官网原话的小费，例如 NZD $10 per day。补完回我一句，我重新演练。',
    href: `https://app.magicengine.com.au${factoryConfigHref(clientId)}`,
  }
}

export async function pushPriceFactItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (clientId: string) => string,
): Promise<void> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('social_plans')
    .select('id, client_id, created_at, plan_data')
    .contains('plan_data', { plan_kind: 'campaign_daily_v1' })
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_PLANS)
  if (error) throw new Error('price-fact-items: social_plans read failed: ' + error.message)

  const today = nzDate(now)
  const seenClients = new Set<string>()
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const clientId = str(row.client_id)
    if (!clientId || seenClients.has(clientId)) continue
    seenClients.add(clientId)

    let offers: Awaited<ReturnType<typeof loadOfferPriceFacts>>
    try {
      offers = await loadOfferPriceFacts(supabase, clientId)
    } catch (e) {
      console.warn(`price-fact-items: offer facts read failed for ${clientId}`, e)
      continue
    }

    const planData = row.plan_data
    const blocked = collectBlocked(narrowBundles(planData), publishedDates(planData), today, offers)
    if (blocked.length === 0) continue

    items.push(buildItem(clientId, nameOf(clientId), blocked))
  }
}
