/**
 * 工厂 Reel 自动起草广告：把「意图行」变成 PM / 开发者的待办。
 *
 * 自动流水线「刚发布的工厂 Reel → 起草一条暂停的 Facebook 广告」每跑一次就往
 * `flywheel_actions`（action_type 'ads.factory_reel_draft'）写一行意图。这里读这些
 * 意图行，翻译成 PM 能看懂的待办：
 *   · 起草成功、等 PM 批准 → 一条「等你点头」的待办（点进去是广告审批页）；
 *   · 被内容检查拦下 → 一条「去工厂补检查清单」的待办；
 *   · 其它失败 / 卡住 → 一条给开发者的待办。
 *
 * 🔴 这里永远不打开任何广告。批准动作在广告审批页，不在这。
 * 🔴 读失败也要下发一条「读不出来」—— 否则等批准的草稿在今日待办里整批消失，
 *    没有别处兜底。不报 ≠ 没有。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { MAX_AUTO_DAILY_BUDGET } from '@/lib/ads-strategy/ad-draft'
import { toPublishedView } from '@/lib/factory/publish/publish-display'

export type FactoryReelAdDraftItemKind =
  | 'factory_reel_ad_awaiting_approval'
  | 'factory_reel_ad_content_blocked'
  | 'factory_reel_ad_draft_dev_issue'

export interface IntentRow {
  id: string
  client_id: string
  created_at: string
  payload: Record<string, unknown>
}

export interface DraftRow {
  id: string
  payload: Record<string, unknown>
}

export interface FactoryReelAdDraftSnapshot {
  intents: IntentRow[]
  drafts: Map<string, DraftRow>
  permalinks: Map<string, string | null>
  clientCapsUsd: Map<string, number | null>
  truncated: boolean
}

export const INTENT_WINDOW_DAYS = 7
export const INTENT_LIMIT = 100
export const STUCK_AFTER_MINUTES = 30

export const CONTENT_BLOCK_CODES: ReadonlySet<string> = new Set([
  'copy_redline_hit',
  'redline_hits_present',
  'checklist_not_passed',
  'approval_missing',
  'copy_unreadable',
])

export const IGNORED_BLOCK_CODES: ReadonlySet<string> = new Set(['stale', 'not_published'])

const APP_BASE = 'https://app.magicengine.com.au'
const APPROVAL_HREF = `${APP_BASE}/dashboard/ad-approval`
const FACTORY_HREF = `${APP_BASE}/dashboard/factory`

const MAX_ITEMS = 30

const REASON_MAP: Record<string, string> = {
  copy_redline_hit: '文案命中了客户的禁用词',
  redline_hits_present: '成片复扫命中了禁用词',
  checklist_not_passed: '检查清单没全部通过',
  approval_missing: '还没有人工审批记录',
  copy_unreadable: '读不到文案',
  redlines_unreadable: '读不到这个客户的禁用词',
  redline_scan_missing: '没有禁用词扫描记录',
  token_missing: '没有可用的广告授权',
  token_shared_fallback: '只找到共享授权，已拒绝使用',
  token_dead: '广告授权失效了',
  page_token_missing: '没有主页授权',
  ad_account_missing: '客户没有广告账号',
  ad_account_not_registered: '广告账号没登记',
  ad_account_unreadable: '读不到广告账号登记',
  page_not_registered: '主页没登记在这个客户名下',
  client_unreadable: '读不到客户信息',
  work_order_unreadable: '读不到工单',
  work_order_not_found: '找不到工单',
  draft_invalid: '广告草稿本身不合规',
}

function plainReason(code: string): string {
  if (code.startsWith('post_unresolved')) return '找不到这条 Reel 对应的可推广帖子'
  const mapped = REASON_MAP[code]
  if (mapped) return mapped
  return code
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  return null
}

function utcDatePlusDays(iso: string, days: number): string {
  const base = Date.parse(iso)
  const ms = Number.isFinite(base) ? base : Date.now()
  const d = new Date(ms + days * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

function permalinkText(permalink: string | null | undefined): string {
  return permalink ?? '（没取到 Reel 链接，请在审批页确认要推的是哪条帖子）'
}

function permalinkTextShort(permalink: string | null | undefined): string {
  return permalink ?? '（没取到链接）'
}

function devItem(
  clientId: string,
  clientName: string,
  reason: string,
  providerImpact: unknown,
  workOrderId: string | null,
): ManualItem {
  let what = `${clientName}：工厂 Reel 自动起草广告没成功（${reason}）。广告没有被打开，没有花钱。`
  if (providerImpact === 'paused_objects_created' || providerImpact === 'unknown') {
    const short = workOrderId ? workOrderId.slice(0, 8) : '????????'
    what += ` Meta 后台可能留着名字以「[ME-DRAFT] ${short}」开头的暂停对象，需要核对或清理。`
  }
  return {
    kind: 'factory_reel_ad_draft_dev_issue',
    client_id: clientId,
    client_name: clientName,
    what,
    how: '这条不用你动手 —— 回我一句「查工厂 Reel 自动起草」，我去看。',
    href: '',
  }
}

export function buildFactoryReelAdDraftItems(
  snapshot: FactoryReelAdDraftSnapshot,
  nameOf: (clientId: string) => string,
  now: Date,
): ManualItem[] {
  const items: ManualItem[] = []
  const nowMs = now.getTime()

  for (const intent of snapshot.intents) {
    if (items.length >= MAX_ITEMS) break

    const payload = intent.payload
    const clientId = intent.client_id
    const clientName = nameOf(clientId)
    const status = asString(payload.status)
    const mode = asString(payload.mode)

    if (mode === 'dry_run') continue
    if (status === 'dry_run_ok') continue

    if (status === 'drafted') {
      const draftActionId = asString(payload.draft_action_id)
      const draft = draftActionId ? snapshot.drafts.get(draftActionId) : undefined
      if (!draft) {
        items.push(devItem(clientId, clientName, '草稿账本行找不到', payload.provider_impact, asString(payload.work_order_id)))
        continue
      }
      const draftStatus = asString(draft.payload.status)
      if (draftStatus !== 'awaiting_approval') continue

      const draftObj = asRecord(draft.payload.draft)
      const dailyBudget = draftObj ? asNumber(draftObj.dailyBudget) : null
      const durationDays = draftObj ? asNumber(draftObj.durationDays) : null
      const budgetText = dailyBudget === null ? '?' : String(dailyBudget)
      const durationText = durationDays === null ? '?' : String(durationDays)
      const endDate = durationDays === null ? '?' : utcDatePlusDays(intent.created_at, durationDays)

      const workOrderId = asString(payload.work_order_id)
      const permalink = workOrderId ? snapshot.permalinks.get(workOrderId) ?? null : null

      const capUsd = snapshot.clientCapsUsd.get(clientId)
      const cap = typeof capUsd === 'number' ? `；这个客户每日总上限 $${capUsd}` : ''

      const what =
        `${clientName}：视频工厂刚发布的 Reel 已自动起草了一条「暂停」的广告（每天最多 $${budgetText}，共 ${durationText} 天，约 ${endDate} 到期）。` +
        `你批了才会开。这条视频目前不在任何受众池的收人规则里，批了也不会给受众池补新人。` +
        `自动起草单条上限 $${MAX_AUTO_DAILY_BUDGET}${cap}。Reel：${permalinkText(permalink)}`

      items.push({
        kind: 'factory_reel_ad_awaiting_approval',
        client_id: clientId,
        client_name: clientName,
        what,
        how: '打开广告审批页，先点上面的 Reel 链接看一眼要推的是不是这条，再决定「批准」或「否决」。批得晚的话，投放时间会比上面写的短。',
        href: APPROVAL_HREF,
      })
      continue
    }

    if (status === 'blocked') {
      const code = asString(payload.block_code) ?? ''
      if (IGNORED_BLOCK_CODES.has(code)) continue
      const workOrderId = asString(payload.work_order_id)
      const permalink = workOrderId ? snapshot.permalinks.get(workOrderId) ?? null : null
      if (CONTENT_BLOCK_CODES.has(code)) {
        items.push({
          kind: 'factory_reel_ad_content_blocked',
          client_id: clientId,
          client_name: clientName,
          what: `${clientName}：这条 Reel 没能自动起草广告，被拦在内容检查上（${plainReason(code)}）。没有建任何广告，也没有花钱。Reel：${permalinkTextShort(permalink)}`,
          how: '看一眼这条 Reel 的文案和检查清单；没问题的话先在工厂把检查清单补齐，然后回我一句「重试工厂 Reel 起草」。',
          href: FACTORY_HREF,
        })
        continue
      }
      items.push(devItem(clientId, clientName, plainReason(code), payload.provider_impact, workOrderId))
      continue
    }

    if (status === 'draft_blocked') {
      items.push(devItem(clientId, clientName, '起草后被闸门拦下', payload.provider_impact, asString(payload.work_order_id)))
      continue
    }

    if (status === 'failed') {
      const err = asString(payload.error)
      const reason = err ? err.slice(0, 120) : '未知原因'
      items.push(devItem(clientId, clientName, reason, payload.provider_impact, asString(payload.work_order_id)))
      continue
    }

    if (status === 'started') {
      const updatedAt = asString(payload.updated_at) ?? intent.created_at
      const updatedMs = Date.parse(updatedAt)
      const ageMs = Number.isFinite(updatedMs) ? nowMs - updatedMs : 0
      if (ageMs > STUCK_AFTER_MINUTES * 60 * 1000) {
        items.push(devItem(clientId, clientName, '跑了很久还没结果，卡住了', payload.provider_impact, asString(payload.work_order_id)))
      }
      continue
    }
  }

  if (snapshot.intents.length > MAX_ITEMS && items.length >= MAX_ITEMS) {
    const more = snapshot.intents.length - MAX_ITEMS
    items.push({
      kind: 'factory_reel_ad_draft_dev_issue',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `工厂 Reel 自动起草广告的待办超过 ${MAX_ITEMS} 条，这里只列了最新的 ${MAX_ITEMS} 条，还有 ${more} 条没显示。`,
      how: '这条不用你动手 —— 回我一句「查工厂 Reel 自动起草」，我去看是哪里在刷。',
      href: '',
    })
  }

  return items
}

export type SnapshotResult =
  | { ok: true; snapshot: FactoryReelAdDraftSnapshot }
  | { ok: false; error: string }

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function loadFactoryReelAdDraftSnapshot(
  supabase: SupabaseClient,
  now: Date,
): Promise<SnapshotResult> {
  const since = new Date(now.getTime() - INTENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const intentsRes = await supabase
    .from('flywheel_actions')
    .select('id, client_id, created_at, payload')
    .eq('action_type', 'ads.factory_reel_draft')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(INTENT_LIMIT)

  if (intentsRes.error) return { ok: false, error: intentsRes.error.message }

  const rawIntents = Array.isArray(intentsRes.data) ? intentsRes.data : []
  const intents: IntentRow[] = []
  for (const row of rawIntents) {
    const r = asRecord(row)
    if (!r) continue
    const payload = asRecord(r.payload)
    if (!payload) continue
    const id = asString(r.id)
    const clientId = asString(r.client_id)
    const createdAt = asString(r.created_at)
    if (!id || !clientId || !createdAt) continue
    intents.push({ id, client_id: clientId, created_at: createdAt, payload })
  }

  const truncated = rawIntents.length === INTENT_LIMIT

  const draftIds: string[] = []
  for (const intent of intents) {
    if (asString(intent.payload.status) !== 'drafted') continue
    const draftActionId = asString(intent.payload.draft_action_id)
    if (draftActionId) draftIds.push(draftActionId)
  }

  const drafts = new Map<string, DraftRow>()
  if (draftIds.length > 0) {
    const draftsRes = await supabase
      .from('flywheel_actions')
      .select('id, payload')
      .in('id', draftIds)
    if (draftsRes.error) return { ok: false, error: draftsRes.error.message }
    const rawDrafts = Array.isArray(draftsRes.data) ? draftsRes.data : []
    for (const row of rawDrafts) {
      const r = asRecord(row)
      if (!r) continue
      const id = asString(r.id)
      const payload = asRecord(r.payload)
      if (!id || !payload) continue
      drafts.set(id, { id, payload })
    }
  }

  const permalinks = new Map<string, string | null>()
  const workOrderIds: string[] = []
  for (const intent of intents) {
    const status = asString(intent.payload.status)
    const workOrderId = asString(intent.payload.work_order_id)
    if (!workOrderId) continue
    if (status === 'drafted') {
      workOrderIds.push(workOrderId)
    } else if (status === 'blocked') {
      const code = asString(intent.payload.block_code) ?? ''
      if (CONTENT_BLOCK_CODES.has(code)) workOrderIds.push(workOrderId)
    }
  }
  if (workOrderIds.length > 0) {
    const woRes = await supabase
      .from('content_work_orders')
      .select('id, published_ref')
      .in('id', workOrderIds)
    if (!woRes.error) {
      const rawWo = Array.isArray(woRes.data) ? woRes.data : []
      for (const row of rawWo) {
        const r = asRecord(row)
        if (!r) continue
        const id = asString(r.id)
        if (!id) continue
        const publishedRef = r.published_ref
        const view = toPublishedView(publishedRef)
        permalinks.set(id, view?.permalink ?? null)
      }
    }
  }

  const clientCapsUsd = new Map<string, number | null>()
  const clientIds: string[] = []
  for (const intent of intents) {
    if (asString(intent.payload.status) !== 'drafted') continue
    if (!clientIds.includes(intent.client_id)) clientIds.push(intent.client_id)
  }
  if (clientIds.length > 0) {
    const capRes = await supabase
      .from('ad_strategy_configs')
      .select('client_id, daily_budget_cap_cents')
      .in('client_id', clientIds)
    if (!capRes.error) {
      const rawCaps = Array.isArray(capRes.data) ? capRes.data : []
      for (const row of rawCaps) {
        const r = asRecord(row)
        if (!r) continue
        const clientId = asString(r.client_id)
        if (!clientId) continue
        const cents = asNumber(r.daily_budget_cap_cents)
        clientCapsUsd.set(clientId, cents !== null && cents > 0 ? cents / 100 : null)
      }
    }
  }

  return {
    ok: true,
    snapshot: { intents, drafts, permalinks, clientCapsUsd, truncated },
  }
}

export async function pushFactoryReelAdDraftItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (clientId: string) => string,
  now: Date,
): Promise<void> {
  try {
    const result = await loadFactoryReelAdDraftSnapshot(supabase, now)
    if (!result.ok) {
      items.push({
        kind: 'factory_reel_ad_draft_dev_issue',
        client_id: 'infra',
        client_name: 'Magic Engine 后台',
        what: `「工厂 Reel 自动起草广告」这一栏今天读不出来（${result.error.slice(0, 160)}）—— 可能有广告草稿在等你批，但这里看不到。不报 ≠ 没有。`,
        how: '这条不用你动手 —— 回我一句「工厂 Reel 草稿待办读不出来」，我去查。',
        href: '',
      })
      return
    }
    for (const item of buildFactoryReelAdDraftItems(result.snapshot, nameOf, now)) {
      items.push(item)
    }
  } catch (e) {
    items.push({
      kind: 'factory_reel_ad_draft_dev_issue',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `「工厂 Reel 自动起草广告」这一栏今天读不出来（${errMessage(e).slice(0, 160)}）—— 可能有广告草稿在等你批，但这里看不到。不报 ≠ 没有。`,
      how: '这条不用你动手 —— 回我一句「工厂 Reel 草稿待办读不出来」，我去查。',
      href: '',
    })
  }
}
