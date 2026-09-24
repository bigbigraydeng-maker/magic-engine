/**
 * 取数：从 CRM 触点里读回「要写进表格的线索」。
 *
 * 🔴 **为什么读库而不是挂在每小时那条同步任务里**：
 *    1. `contact_touchpoints` 已经是这条链的真相源，按 (client_id, source, source_ref)
 *       幂等 —— 读它天然能重跑、能补历史、能在同步任务挂掉的那几小时之后自己追上。
 *    2. 每小时那条同步任务（`src/lib/meta/leads-sync.ts` + 它的路由）此刻正在被
 *       另一个 PR 改（#1830）。把写表格的活挂进去 = 两个窗口改同一个文件。
 *    3. 就算挂进去也拿不到广告组名 / 广告系列名 / 表单名 —— Meta 的 lead 节点不返回，
 *       只能另查。所以挂进去并不比读库多拿到东西。
 *
 * 广告组名 / 系列名从 `ad_entity_snapshots`（本地已有的名字缓存）回查；
 * 查不到就留空，**绝不编**。表单名目前没有本地缓存，一律留空 —— 留白是事实。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import type { LeadRecord } from './types'

interface TouchpointRow {
  source_ref: string
  occurred_at: string
  attr_ad_id: string | null
  attr_ad_name: string | null
  attr_adset_id: string | null
  attr_campaign_id: string | null
  contact_id: string | null
  metadata: Record<string, unknown> | null
}

interface ContactRow {
  id: string
  display_name: string | null
  primary_email: string | null
  primary_phone: string | null
}

/**
 * `.in(...)` 的分批上限。
 *
 * 🔴 实测踩过：一个客户 733 条线索 → 733 个 contact id 塞进一个 `.in()`，
 *    URL 长到 PostgREST 直接回 400 Bad Request（报错里一个字都看不出是 URL 太长）。
 *    分批不是优化，是必须。
 */
const IN_CHUNK = 150

/**
 * 回查广告组 / 系列名字时只看这段时间内的快照。
 *
 * 🔴 不加下界的话，为了取一个名字要把这些实体的**全部历史快照**分页拉回来 ——
 *    150 个实体 × 每天一张快照，一年就是五万多行；到 `fetchAll` 的上限会直接抛，
 *    于是这个客户每小时都一行写不进去。名字只需要最近的那一份。
 */
const ENTITY_NAME_LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s === '' ? null : s
}

function answersOf(metadata: Record<string, unknown> | null): Record<string, string> {
  const raw = metadata?.custom_answers
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

function boolOf(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return null
}

/**
 * 查广告组 / 广告系列的名字。查不到的 id 不出现在返回的 map 里 —— 调用方据此留空。
 * `ad_entity_snapshots` 同一个实体可能有多条快照，取最新那条的名字。
 */
export async function loadEntityNames(
  supabase: SupabaseClient,
  clientId: string,
  entityIds: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (entityIds.length === 0) return names

  for (const ids of chunk(entityIds, IN_CHUNK)) {
    const rows = await fetchAll<{ entity_id: string; entity_name: string | null; captured_at: string }>(
      (from, to) =>
        supabase
          .from('ad_entity_snapshots')
          .select('entity_id, entity_name, captured_at')
          .eq('client_id', clientId)
          .in('entity_id', ids)
          // 🔴 分页排序必须带一个唯一键兜底。`ad_entity_snapshots` 是**批量**
          //    快照，同一批写进去的几十个实体 captured_at 完全相同；只按它排，
          //    翻页之间顺序不稳 → 某些实体最新那行被跳过 → 名字静默写成空格子，
          //    而且每次跑结果还不一样（同文件下面那条分页注释是同一个坑）。
          .order('entity_id', { ascending: true })
          .order('captured_at', { ascending: false })
          .order('id', { ascending: true })
          .gte('captured_at', new Date(Date.now() - ENTITY_NAME_LOOKBACK_MS).toISOString())
          .range(from, to),
    )
    // 已按 captured_at 倒序，第一次见到的就是最新的。
    for (const r of rows) {
      const name = str(r.entity_name)
      if (name && !names.has(r.entity_id)) names.set(r.entity_id, name)
    }
  }
  return names
}

/**
 * 读这个客户从 `since` 起的全部 Meta 表单线索。
 *
 * `since` 取所有路线里最早的 `backfill_since`（调用方算好传进来）——
 * 别把整张表拉回来，库里可能攒了几百上千条历史。
 */
export async function loadLeadsSince(
  supabase: SupabaseClient,
  clientId: string,
  since: string | null,
): Promise<LeadRecord[]> {
  const touchpoints = await fetchAll<TouchpointRow>((from, to) => {
    let q = supabase
      .from('contact_touchpoints')
      .select(
        'source_ref, occurred_at, attr_ad_id, attr_ad_name, attr_adset_id, attr_campaign_id, contact_id, metadata',
      )
      .eq('client_id', clientId)
      .eq('channel', 'meta_lead_form')
      .not('source_ref', 'is', null)
    if (since) q = q.gte('occurred_at', since)
    // 🔴 分页按 source_ref 排（唯一键），不按时间戳 —— 同一毫秒多条会让翻页漏行。
    return q.order('source_ref', { ascending: true }).range(from, to)
  })

  const contactIds = [...new Set(touchpoints.map((t) => t.contact_id).filter((v): v is string => !!v))]
  const contacts = new Map<string, ContactRow>()
  for (const ids of chunk(contactIds, IN_CHUNK)) {
    const rows = await fetchAll<ContactRow>((from, to) =>
      supabase
        .from('contacts')
        .select('id, display_name, primary_email, primary_phone')
        .eq('client_id', clientId)
        .in('id', ids)
        .order('id', { ascending: true })
        .range(from, to),
    )
    for (const c of rows) contacts.set(c.id, c)
  }

  const entityIds = [
    ...new Set(
      touchpoints
        .flatMap((t) => [t.attr_adset_id, t.attr_campaign_id])
        .filter((v): v is string => !!v),
    ),
  ]
  const names = await loadEntityNames(supabase, clientId, entityIds)

  return touchpoints.map((t) => {
    const c = t.contact_id ? contacts.get(t.contact_id) : undefined
    return {
      leadId: t.source_ref,
      occurredAt: t.occurred_at,
      name: str(c?.display_name),
      email: str(c?.primary_email),
      phone: str(c?.primary_phone),
      adId: t.attr_ad_id,
      adName: t.attr_ad_name,
      adsetId: t.attr_adset_id,
      adsetName: t.attr_adset_id ? (names.get(t.attr_adset_id) ?? null) : null,
      campaignId: t.attr_campaign_id,
      campaignName: t.attr_campaign_id ? (names.get(t.attr_campaign_id) ?? null) : null,
      formId: str(t.metadata?.form_id),
      // 本地没有表单名缓存 —— 留空是事实，不去别处凑一个像的名字。
      formName: null,
      platform: str(t.metadata?.meta_platform),
      isOrganic: boolOf(t.metadata?.is_organic),
      answers: answersOf(t.metadata),
    }
  })
}
