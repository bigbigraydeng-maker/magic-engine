/**
 * 把 AI 摘要接进 CRM 名单。
 *
 * PM 2026-10-10：销售只需要一个概念「该做什么」，所以意向等级和 AI 建议的
 * 下一步动作要跟分段一起喂给 next-action。意向只能抬、不能压 —— 这里只负责
 * 把最新一张摘要取出来，怎么用由 next-action 决定。
 *
 * 两次整批查询（conversations / conversation_briefs 都带 client_id），在内存里
 * 按 conversation_id 连起来 —— 不用 `.in()`，免得 PostgREST URL 被几百个 id 撑爆。
 *
 * 查询失败不抛：返回空 Map，列表照常显示，只是没有意向抬升。摘要是辅助信息，
 * 不能让整页打不开。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { INTENT_LEVELS, type IntentLevel } from './next-action'

/** 一个人最新一张 AI 摘要里跟「该做什么」有关的两样东西。 */
export interface ContactBrief {
  intent: IntentLevel | null
  nextAction: string | null
  /** AI 对这位客人最近一段对话的摘要（库里 conversation_briefs.summary）；列表「该做什么」列显示它。 */
  summary: string | null
  generatedAt: string
}

export type BriefByContact = ReadonlyMap<string, ContactBrief>

/** 把库里的 intent_level 文本收口成四个合法值；别的一律 null（不猜）。 */
export function normaliseIntent(raw: unknown): IntentLevel | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  for (const level of INTENT_LEVELS) {
    if (level === trimmed) return level
  }
  return null
}

/** 纯函数：给 conversations(id→contact_id) 和 briefs 行，按 contact 取 generated_at 最新的一张。导出是为了测。 */
export function latestBriefPerContact(
  convs: Array<{ id: string; contact_id: string | null }>,
  briefs: Array<{
    conversation_id: string
    intent_level: unknown
    next_action: unknown
    summary: unknown
    generated_at: string | null
  }>,
): Map<string, ContactBrief> {
  const contactOfConv = new Map<string, string>()
  for (const conv of convs) {
    if (typeof conv.contact_id === 'string' && conv.contact_id.length > 0) {
      contactOfConv.set(conv.id, conv.contact_id)
    }
  }

  const latest = new Map<string, ContactBrief>()
  const latestAt = new Map<string, number>()

  for (const brief of briefs) {
    const contactId = contactOfConv.get(brief.conversation_id)
    if (contactId === undefined) continue

    const at = typeof brief.generated_at === 'string' ? Date.parse(brief.generated_at) : NaN
    const stamp = Number.isNaN(at) ? 0 : at
    const prev = latestAt.get(contactId)
    if (prev !== undefined && prev >= stamp) continue

    const trimmed = typeof brief.next_action === 'string' ? brief.next_action.trim() : ''
    const summaryTrim = typeof brief.summary === 'string' ? brief.summary.trim() : ''
    latest.set(contactId, {
      intent: normaliseIntent(brief.intent_level),
      nextAction: trimmed.length > 0 ? trimmed : null,
      summary: summaryTrim.length > 0 ? summaryTrim : null,
      generatedAt: typeof brief.generated_at === 'string' ? brief.generated_at : '',
    })
    latestAt.set(contactId, stamp)
  }

  return latest
}

/**
 * 这个客户每个人最新一张 AI 摘要。两次整批查询（conversations / conversation_briefs 都带 client_id），
 * 在内存里按 conversation_id 连起来 —— 不用 `.in()`，免得 PostgREST URL 被几百个 id 撑爆。
 * 查询失败不抛：返回空 Map，列表照常显示，只是没有意向抬升（摘要是辅助信息，不能让整页打不开）。
 */
async function loadBriefsOrThrow(clientId: string): Promise<BriefByContact> {
  const convs = await fetchAll<{ id: string; contact_id: string | null }>((from, to) =>
    supabaseAdmin
      .from('conversations')
      .select('id, contact_id')
      .eq('client_id', clientId)
      .not('contact_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, to),
  )

  const briefs = await fetchAll<{
    conversation_id: string
    intent_level: unknown
    next_action: unknown
    summary: unknown
    generated_at: string | null
  }>((from, to) =>
    supabaseAdmin
      .from('conversation_briefs')
      .select('conversation_id, intent_level, next_action, summary, generated_at')
      .eq('client_id', clientId)
      .order('id', { ascending: true })
      .range(from, to),
  )

  return latestBriefPerContact(convs, briefs)
}

function logBriefFailure(clientId: string, err: unknown): void {
  // 吞错但不哑：没这一行，真故障（例如 fetchAll 撞上限抛错）会变成「整页正常、全员无抬升」，
  // 没人发现（子牙 2026-10-10 实施后复审）。响应里不带标记是为了不多一个字段，先靠日志。
  console.error('[brief-lookup] load failed, falling back to no briefs', clientId, err instanceof Error ? err.message : err)
}

export async function loadLatestBriefByContact(clientId: string): Promise<BriefByContact> {
  try {
    return await loadBriefsOrThrow(clientId)
  } catch (err) {
    logBriefFailure(clientId, err)
    return new Map()
  }
}

/**
 * 同上，但短时间内同一客户只查一次。搜索框每敲一个字都会触发一次名单请求，而这份
 * 「全客户摘要」跟搜什么无关、占了请求里最长的一段（实测约 0.7 秒）。摘要只是辅助信息，
 * 晚几十秒更新没有关系。失败不缓存（下一次请求重试），也不抛。
 */
const BRIEF_CACHE = new Map<string, { at: number; promise: Promise<BriefByContact> }>()

export function resetBriefCacheForTests(): void {
  BRIEF_CACHE.clear()
}

export async function loadLatestBriefByContactCached(
  clientId: string,
  maxAgeMs: number = 30_000,
  now: () => number = Date.now,
): Promise<BriefByContact> {
  const hit = BRIEF_CACHE.get(clientId)
  if (hit !== undefined && now() - hit.at < maxAgeMs) {
    try {
      return await hit.promise
    } catch {
      // the shared load failed; fall through and try once ourselves
    }
  }
  const promise = loadBriefsOrThrow(clientId)
  BRIEF_CACHE.set(clientId, { at: now(), promise })
  try {
    return await promise
  } catch (err) {
    if (BRIEF_CACHE.get(clientId)?.promise === promise) BRIEF_CACHE.delete(clientId)
    logBriefFailure(clientId, err)
    return new Map()
  }
}
