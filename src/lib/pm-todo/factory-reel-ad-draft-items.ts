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
  | 'factory_reel_ad_may_be_spending'
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
  /** 账号级每日总上限，键是 `${client_id}|${规范化广告账号 id}`（见 normaliseAdAccountId）。 */
  accountCapsUsd?: Map<string, number | null>
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
const ADS_MANAGER_HREF = 'https://adsmanager.facebook.com/adsmanager/manage/campaigns'

/** 回读时发现对象没暂停的原文 —— 出现它且补暂停没确认成功，就是「可能正在花钱」。 */
const NOT_PAUSED_MARKER = '回读发现有对象不是暂停状态'

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
  client_mismatch: '工单和事件对不上（客户或工单号）',
  page_mismatch: '发布记录里的主页和事件对不上',
  video_mismatch: '发布记录里的视频和事件对不上',
  published_at_mismatch: '发布记录的时间和事件对不上',
  bad_published_at: '发布时间不合法',
  unhandled_failure: '函数在建意图行之前就出错了',
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

/** 规范化广告账号 id：去空白、转小写、去掉开头的 'act_'。 */
export function normaliseAdAccountId(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.trim().toLowerCase().replace(/^act_/, '')
}

/** 广告账号尾号（后 4 位）；没有记录时给一句人话。 */
function accountSuffix(raw: string | null | undefined): string {
  const id = normaliseAdAccountId(raw)
  if (!id) return '（账号没记录）'
  return id.slice(-4)
}

/** 结束日期按奥克兰时区算（客户和 PM 都在那边，UTC 会差一天）。 */
function aucklandDatePlusDays(iso: string, days: number): string {
  const base = Date.parse(iso)
  const ms = (Number.isFinite(base) ? base : Date.now()) + days * 24 * 60 * 60 * 1000
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

/**
 * 把「Meta 上可能留下的对象」拼成一句人话：广告账号尾号、名字标签、系列 / 广告组 /
 * 广告 / 未清理的对象。给 PM 去 Meta 后台照着找。
 */
function objectIdentifiers(
  payload: Record<string, unknown>,
  draft: DraftRow | undefined,
  workOrderId: string | null,
): string {
  const draftPayload = draft?.payload
  const adAccountId = asString(payload.ad_account_id) ?? (draftPayload ? asString(draftPayload.adAccountId) : null)
  const campaignId = asString(payload.campaign_id) ?? (draftPayload ? asString(draftPayload.campaignId) : null)
  const adSetId = asString(payload.ad_set_id) ?? (draftPayload ? asString(draftPayload.adSetId) : null)
  const adIds = asStringArray(payload.ad_ids).length > 0
    ? asStringArray(payload.ad_ids)
    : draftPayload
      ? asStringArray(draftPayload.adIds)
      : []
  const orphans = asStringArray(payload.orphans).length > 0
    ? asStringArray(payload.orphans)
    : draftPayload
      ? asStringArray(draftPayload.orphans)
      : []

  const parts: string[] = [`广告账号尾号 ${accountSuffix(adAccountId)}`]
  if (workOrderId) parts.push(`名字以「[ME-DRAFT] ${workOrderId.slice(0, 8)}」开头`)
  if (campaignId) parts.push(`系列 ${campaignId}`)
  if (adSetId) parts.push(`广告组 ${adSetId}`)
  if (adIds.length > 0) parts.push(`广告 ${adIds.join('、')}`)
  if (orphans.length > 0) parts.push(`未清理的 ${orphans.join('、')}`)
  return parts.join('，')
}

/** 补暂停是否确认成功：草稿行缺失也算没确认。 */
function autoPauseConfirmed(draft: DraftRow | undefined): boolean {
  const autoPause = draft ? asRecord(draft.payload.autoPause) : null
  return autoPause?.ok === true
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
  payload: Record<string, unknown>,
  draft: DraftRow | undefined,
): ManualItem {
  let what = `${clientName}：工厂 Reel 自动起草广告没成功（${reason}）。`
  if (providerImpact === 'paused_objects_created') {
    what += ` Meta 上建出了暂停状态的对象（没有花钱），需要核对或清理：${objectIdentifiers(payload, draft, workOrderId)}。`
  } else if (providerImpact === 'unknown') {
    what += ` Meta 上可能留着对象，是否已暂停没确认，请去 Meta 后台核对：${objectIdentifiers(payload, draft, workOrderId)}。`
  } else {
    what += ' 没有建任何 Meta 对象，没有花钱。'
  }
  if (autoPauseConfirmed(draft)) {
    what += ' 补暂停已成功。'
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

/** 可能正在花钱：回读发现对象没暂停、补暂停也没确认成功。 */
function mayBeSpendingItem(
  clientId: string,
  clientName: string,
  payload: Record<string, unknown>,
  draft: DraftRow | undefined,
  workOrderId: string | null,
): ManualItem {
  return {
    kind: 'factory_reel_ad_may_be_spending',
    client_id: clientId,
    client_name: clientName,
    what: `${clientName}：工厂 Reel 自动起草的广告在回读时发现有对象不是暂停状态，补暂停也没确认成功，可能正在花钱！${objectIdentifiers(payload, draft, workOrderId)}。`,
    how: '现在就去 Meta 广告后台，把上面这几个对象手动暂停，然后回我一句「已手动暂停」。',
    href: ADS_MANAGER_HREF,
  }
}

export function buildFactoryReelAdDraftItems(
  snapshot: FactoryReelAdDraftSnapshot,
  nameOf: (clientId: string) => string,
  now: Date,
): ManualItem[] {
  const items: ManualItem[] = []
  const nowMs = now.getTime()

  const draftFor = (intent: IntentRow): DraftRow | undefined => {
    const draftActionId = asString(intent.payload.draft_action_id)
    return draftActionId ? snapshot.drafts.get(draftActionId) : undefined
  }

  const isMayBeSpending = (payload: Record<string, unknown>, draft: DraftRow | undefined): boolean => {
    const err = asString(payload.error) ?? ''
    return err.includes(NOT_PAUSED_MARKER) && !autoPauseConfirmed(draft)
  }

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
        items.push(devItem(clientId, clientName, '草稿账本行找不到', payload.provider_impact, asString(payload.work_order_id), payload, undefined))
        continue
      }
      const draftStatus = asString(draft.payload.status)
      if (draftStatus !== 'awaiting_approval') continue

      const draftObj = asRecord(draft.payload.draft)
      const dailyBudget = draftObj ? asNumber(draftObj.dailyBudget) : null
      const durationDays = draftObj ? asNumber(draftObj.durationDays) : null
      const budgetText = dailyBudget === null ? '?' : String(dailyBudget)
      const durationText = durationDays === null ? '?' : String(durationDays)
      const endDate = durationDays === null ? '?' : aucklandDatePlusDays(intent.created_at, durationDays)

      const workOrderId = asString(payload.work_order_id)
      const permalink = workOrderId ? snapshot.permalinks.get(workOrderId) ?? null : null

      const adAccountId = asString(payload.ad_account_id) ?? asString(draft.payload.adAccountId)
      const accountKey = `${clientId}|${normaliseAdAccountId(adAccountId)}`
      const accountCap = snapshot.accountCapsUsd?.get(accountKey)
      const clientCap = snapshot.clientCapsUsd.get(clientId)
      let cap: string
      if (typeof accountCap === 'number') {
        cap = `这个账号每日总上限 $${accountCap}（账户币种）`
      } else if (typeof clientCap === 'number') {
        cap = `这个客户每日总上限 $${clientCap}（账户币种）`
      } else {
        cap = '没读到这个账号/客户的每日总上限'
      }
      cap += '（上限数字仅供参考，批准时系统不会替你拦）'

      const what =
        `${clientName}：视频工厂刚发布的 Reel 已自动起草了一条「暂停」的广告（每天最多 $${budgetText}，共 ${durationText} 天，约 ${endDate} 到期）。` +
        `建在广告账号尾号 ${accountSuffix(adAccountId)} 下。` +
        `你批了才会开。受众池是账号级的：要给池子补新人，这条视频还得先加进池子的收人规则，且池子必须挂在同一个广告账号下。` +
        `自动起草单条上限 $${MAX_AUTO_DAILY_BUDGET}；${cap}。Reel：${permalinkText(permalink)}`

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
      items.push(devItem(clientId, clientName, plainReason(code), payload.provider_impact, workOrderId, payload, draftFor(intent)))
      continue
    }

    if (status === 'draft_blocked') {
      const workOrderId = asString(payload.work_order_id)
      const draft = draftFor(intent)
      if (isMayBeSpending(payload, draft)) {
        items.push(mayBeSpendingItem(clientId, clientName, payload, draft, workOrderId))
        continue
      }
      items.push(devItem(clientId, clientName, '起草后被闸门拦下', payload.provider_impact, workOrderId, payload, draft))
      continue
    }

    if (status === 'failed') {
      const err = asString(payload.error)
      const reason = err ? err.slice(0, 120) : '未知原因'
      const workOrderId = asString(payload.work_order_id)
      const draft = draftFor(intent)
      if (isMayBeSpending(payload, draft)) {
        items.push(mayBeSpendingItem(clientId, clientName, payload, draft, workOrderId))
        continue
      }
      items.push(devItem(clientId, clientName, reason, payload.provider_impact, workOrderId, payload, draft))
      continue
    }

    if (status === 'started') {
      const updatedAt = asString(payload.updated_at) ?? intent.created_at
      const updatedMs = Date.parse(updatedAt)
      const ageMs = Number.isFinite(updatedMs) ? nowMs - updatedMs : 0
      if (ageMs > STUCK_AFTER_MINUTES * 60 * 1000) {
        // 卡住的起草：不知道 Meta 上留没留对象，一律按「没确认」说，别替它保证没花钱。
        items.push(devItem(clientId, clientName, '跑了很久还没结果，卡住了', 'unknown', asString(payload.work_order_id), payload, draftFor(intent)))
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

  if (snapshot.truncated) {
    items.push({
      kind: 'factory_reel_ad_draft_dev_issue',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `工厂 Reel 起草记录太多，待办只读了最近 ${INTENT_LIMIT} 条，更早的失败/被拦记录没显示。`,
      how: '这条不用你动手 —— 回我一句「工厂 Reel 起草记录太多」，我去看。',
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
    .neq('payload->>mode', 'dry_run')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(INTENT_LIMIT)

  if (intentsRes.error) return { ok: false, error: intentsRes.error.message }

  // 第二查：不带时间窗，专门捞「还在等人批」的草稿 —— 一条草稿可能等超过 7 天，
  // 「没报」绝不能等于「没有在等的」。
  const waitingRes = await supabase
    .from('flywheel_actions')
    .select('id, client_id, created_at, payload')
    .eq('action_type', 'ads.factory_reel_draft')
    .eq('payload->>status', 'drafted')
    .neq('payload->>mode', 'dry_run')
    .order('created_at', { ascending: false })
    .limit(INTENT_LIMIT)

  if (waitingRes.error) return { ok: false, error: waitingRes.error.message }

  const rawWindowed = Array.isArray(intentsRes.data) ? intentsRes.data : []
  const rawWaiting = Array.isArray(waitingRes.data) ? waitingRes.data : []

  const seenIds = new Set<string>()
  const intents: IntentRow[] = []
  for (const row of [...rawWindowed, ...rawWaiting]) {
    const r = asRecord(row)
    if (!r) continue
    const payload = asRecord(r.payload)
    if (!payload) continue
    const id = asString(r.id)
    const clientId = asString(r.client_id)
    const createdAt = asString(r.created_at)
    if (!id || !clientId || !createdAt) continue
    if (seenIds.has(id)) continue
    seenIds.add(id)
    intents.push({ id, client_id: clientId, created_at: createdAt, payload })
  }
  intents.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))

  const truncated = rawWindowed.length === INTENT_LIMIT

  const draftIds: string[] = []
  for (const intent of intents) {
    const status = asString(intent.payload.status)
    if (status !== 'drafted' && status !== 'draft_blocked' && status !== 'failed') continue
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

  const accountCapsUsd = new Map<string, number | null>()
  const accountPairs: Array<{ clientId: string; accountId: string }> = []
  for (const intent of intents) {
    if (asString(intent.payload.status) !== 'drafted') continue
    const accountId = normaliseAdAccountId(asString(intent.payload.ad_account_id))
    if (!accountId) continue
    if (!accountPairs.some((p) => p.clientId === intent.client_id && p.accountId === accountId)) {
      accountPairs.push({ clientId: intent.client_id, accountId })
    }
  }
  if (accountPairs.length > 0) {
    const accountClientIds = Array.from(new Set(accountPairs.map((p) => p.clientId)))
    const capRes = await supabase
      .from('client_meta_ad_accounts')
      .select('client_id, ad_account_id, daily_budget_cap_cents')
      .in('client_id', accountClientIds)
    // 读不到账号级上限不算致命：退回客户级上限，别让整栏消失。
    if (!capRes.error) {
      const rawAccountCaps = Array.isArray(capRes.data) ? capRes.data : []
      for (const row of rawAccountCaps) {
        const r = asRecord(row)
        if (!r) continue
        const clientId = asString(r.client_id)
        const accountId = normaliseAdAccountId(asString(r.ad_account_id))
        if (!clientId || !accountId) continue
        const cents = asNumber(r.daily_budget_cap_cents)
        accountCapsUsd.set(`${clientId}|${accountId}`, cents !== null && cents > 0 ? cents / 100 : null)
      }
    }
  }

  return {
    ok: true,
    snapshot: { intents, drafts, permalinks, clientCapsUsd, accountCapsUsd, truncated },
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
