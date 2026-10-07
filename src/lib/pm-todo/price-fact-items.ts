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
import { judgePostPriceFacts, loadOfferPriceFacts } from '@/lib/content/price-fact-gate'

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
    const text = [bundle.post.hook, bundle.post.body, bundle.post.cta].join('\n\n')
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
  const dates = blocked.map((b) => b.date)
  const firstMessage = blocked[0]?.message ?? ''
  return {
    kind: 'price_fact_unverified',
    client_id: clientId,
    client_name: clientName,
    what: `${clientName} 本周发布计划里有 ${blocked.length} 条帖子的价格数字核对不过（${dates.join('、')}）。发布时系统会把整批拦下，一条都发不出去。第一条的问题：${firstMessage}`,
    how: '两条路选一条：① 价格写错了 —— 打开链接，在每日计划里把对应日期文案里的价格改成客户官网上的数字，再重新审核；② 价格没错、只是系统里没有这个团的价格资料 —— 去客户设置 →「视频工厂配置」→ 资料包，给该团补上官网上的原话价格（例如 NZD $2,699、单人房加价 NZD $400）和团名，再回来重新演练。',
    href: `https://app.magicengine.com.au/dashboard/clients/${clientId}/daily-plan`,
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
