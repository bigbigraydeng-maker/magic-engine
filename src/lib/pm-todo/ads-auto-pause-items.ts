/**
 * Ads D3 自动暂停：等人批准的暂停建议 → 下发待办。
 *
 * 这条是「一键批准」流程唯一的待办——`ads-d3-auto-pause.ts` 只提交到 Kernel，
 * 停在 `pending_approval`；PM/FDE 必须从这里点进去才能看到、才能批准/驳回
 * （见 `src/lib/action-submission/ads-auto-pause.ts` 顶部注释）。
 *
 * 🔴 通用 handoff 对这个动作的等批准**不再发待办**（它登记在
 *    `kernel/dedicated-approval-entries.ts`）。所以这里：
 *      · 读 Kernel 真相（`action_runs`），账表漏记的那条也要列出来；
 *      · 读失败也要下发一条「读不出来」，不能只打日志 —— 否则等批准的暂停
 *        在今日待办里整批消失，没有别处兜底；
 *      · 审批记录对不上的那条不写「点批准」（点了也批不了），写「回我一句」。
 *
 * 🔴 **被拦下的也要下发**（2026-11-04）：内核拒了、安全闸拦了的暂停建议只记在
 *    `flywheel_actions`（payload.status='blocked'），从来不进「等你点头」——广告照常
 *    花钱、PM 看不到。这里把近 7 天的 blocked 也收进来（同一个广告组只出一条）。
 *    只收 blocked：`dry_run_logged`（演练）要不要也报是 PM 另一个决定，不在这里加。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import { listPendingAdsAutoPauseAllClients, type PendingAdsAutoPause } from '@/lib/ads-strategy/auto-pause-pending'
import { dedicatedApprovalEntryFor } from '@/lib/kernel/dedicated-approval-entries'
import { ADS_AUTO_PAUSE_ACTION_KEY } from '@/lib/action-submission/ads-auto-pause-key'

export type AdsAutoPauseItemKind = 'ads_auto_pause_pending' | 'ads_auto_pause_blocked'

const APP_BASE = 'https://app.magicengine.com.au'

/** 被拦下的只看近 7 天：更早的诊断日早就过了，再列只是噪声。 */
export const BLOCKED_LOOKBACK_DAYS = 7
/** 一次最多读这么多行被拦记录；读满了要说出来，不静默截掉。 */
export const BLOCKED_READ_LIMIT = 200

function adsHealthHref(clientId: string, tab: 'settings' | 'ads'): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/ads-health?tab=${tab}`
}

function entryHref(clientId: string): string {
  const entry = dedicatedApprovalEntryFor(ADS_AUTO_PAUSE_ACTION_KEY)
  // 登记表里没有这一行 = 代码配置错了；给空链接（渲染器不画按钮），不编一个假的
  return entry ? `${APP_BASE}${entry.path(clientId)}` : ''
}

function toManualItem(p: PendingAdsAutoPause, nameOf: (id: string) => string): ManualItem {
  const adsetLabel = p.adsetName ?? p.adsetId ?? '一个广告组'
  const base = { kind: 'ads_auto_pause_pending' as const, client_id: p.clientId, client_name: nameOf(p.clientId) }
  if (!p.expectedDecisionId) {
    return {
      ...base,
      what: `「${adsetLabel}」有一条暂停建议卡住了：它的审批记录对不上，谁点都批不了。它不会自己执行，广告照常在投。`,
      how: '这条不用你去点 —— 回我一句「查一下这条暂停建议」，我去把审批记录理顺。',
      href: entryHref(p.clientId),
    }
  }
  return {
    ...base,
    what: `${p.diagnosisTitle ?? `「${adsetLabel}」连续花钱没结果`}——系统建议暂停，等你点头。`,
    how: '打开广告健康页的「等你点头」标签，点「批准」立刻暂停（不用去 Meta 后台），点「驳回」就不停。',
    href: entryHref(p.clientId),
  }
}

export async function pushAdsAutoPauseItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
  now: Date = new Date(),
): Promise<void> {
  const pendingRunIds = await pushPendingItems(supabase, items, nameOf)
  await pushBlockedItems(supabase, items, nameOf, now, pendingRunIds)
}

/** 等批准的那一栏；返回已列出的 run id（被拦那一栏用来去重）。 */
async function pushPendingItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
): Promise<ReadonlySet<string>> {
  let pending: Awaited<ReturnType<typeof listPendingAdsAutoPauseAllClients>>
  try {
    pending = await listPendingAdsAutoPauseAllClients(supabase)
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 160)
    items.push({
      kind: 'ads_auto_pause_pending',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `「广告自动暂停等你批准」这一栏今天读不出来（${message}）—— 可能有暂停建议在等你，但这里看不到。不报 ≠ 没有。`,
      how: '这条不用你动手 —— 回我一句「广告暂停待批准读不出来」，我去查。在那之前没有任何广告会被自动暂停。',
      href: '',
    })
    return new Set()
  }
  for (const p of pending.items) items.push(toManualItem(p, nameOf))
  if (pending.hasMore) {
    items.push({
      kind: 'ads_auto_pause_pending',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `等你批准的广告暂停超过 ${pending.items.length} 条，这里只列了最新的 ${pending.items.length} 条，更早的没显示。`,
      how: '先处理上面这些；处理完明天会接着显示更早的。积压这么多不正常 —— 回我一句「暂停建议积压了」，我去看是哪里在刷。',
      href: '',
    })
  }
  return new Set(pending.items.map((p) => p.runId))
}

// ── 被拦下的暂停建议（payload.status='blocked'）──────────────────────────────

interface BlockedPayload {
  status?: unknown
  adset_id?: unknown
  adset_name?: unknown
  reason?: unknown
  action_run_id?: unknown
}

interface BlockedRow {
  client_id: string
  created_at: string
  payload: BlockedPayload | null
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

/** 原因字段原文 → 给 PM 看的一句话。内核的拒绝原因本来就是写给人看的，原样引用；只翻译内部代号。 */
function plainReason(raw: string | null): string {
  if (raw === null) return '系统没记下原因'
  if (raw === 'kernel_inconsistent_pending_approval') return '提交到了审批，但审批记录没挂上，谁点都批不了'
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw
}

async function readRecentBlocked(supabase: SupabaseClient, now: Date): Promise<BlockedRow[]> {
  const since = new Date(now.getTime() - BLOCKED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('flywheel_actions')
    .select('client_id, created_at, payload')
    .eq('flywheel', 'ads')
    .eq('action_type', ADS_AUTO_PAUSE_ACTION_KEY)
    .eq('payload->>status', 'blocked')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(BLOCKED_READ_LIMIT)
  if (error) throw new Error(error.message)
  return (data ?? []) as BlockedRow[]
}

function toBlockedItem(row: BlockedRow, times: number, nameOf: (id: string) => string): ManualItem {
  const p = row.payload ?? {}
  const adsetLabel = text(p.adset_name) ?? text(p.adset_id) ?? '一个广告组'
  const byKernel = text(p.action_run_id) !== null
  const repeat = times > 1 ? `（近 ${BLOCKED_LOOKBACK_DAYS} 天被拦了 ${times} 次）` : ''
  return {
    kind: 'ads_auto_pause_blocked',
    client_id: row.client_id,
    client_name: nameOf(row.client_id),
    what:
      `「${adsetLabel}」花钱没结果，系统想暂停它，但这条建议被拦下了，没进「等你点头」${repeat}——这个广告组还在照常花钱。` +
      `被拦的原因：${plainReason(text(p.reason))}`,
    how: byKernel
      ? '这类暂停按规矩应该进「等你点头」，被拦说明执行规则跟设置对不上。链接打开的是这个客户广告健康页的「目标与设置」，能看到它现在的自动化设置；执行规则不用你去改 —— 回我一句「查一下这条暂停被拦」，我去核这个客户的执行规则。'
      : '这是系统的安全闸拦下的（确认不了广告组归属或是共用账户），不是规则配错。打开广告健康页「每条广告」看这个广告组，停不停你来定；拿不准就回我一句「查一下这条暂停被拦」。',
    href: adsHealthHref(row.client_id, byKernel ? 'settings' : 'ads'),
  }
}

async function pushBlockedItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
  now: Date,
  pendingRunIds: ReadonlySet<string>,
): Promise<void> {
  let rows: BlockedRow[]
  try {
    rows = await readRecentBlocked(supabase, now)
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 160)
    items.push({
      kind: 'ads_auto_pause_blocked',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `「广告暂停建议被拦下」这一栏今天读不出来（${message}）—— 可能有该停没停的广告组，但这里看不到。不报 ≠ 没有。`,
      how: '这条不用你动手 —— 回我一句「广告暂停被拦读不出来」，我去查。',
      href: '',
    })
    return
  }
  // 同一个客户的同一个广告组只出一条（取最新那次），已在「等你点头」里的 run 不重复列
  const latest = new Map<string, { row: BlockedRow; times: number }>()
  for (const row of rows) {
    const p = row.payload ?? {}
    const runId = text(p.action_run_id)
    if (runId !== null && pendingRunIds.has(runId)) continue
    const key = `${row.client_id}:${text(p.adset_id) ?? text(p.adset_name) ?? row.created_at}`
    const seen = latest.get(key)
    if (seen) seen.times += 1
    else latest.set(key, { row, times: 1 })
  }
  for (const { row, times } of latest.values()) items.push(toBlockedItem(row, times, nameOf))
  if (rows.length >= BLOCKED_READ_LIMIT) {
    items.push({
      kind: 'ads_auto_pause_blocked',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `近 ${BLOCKED_LOOKBACK_DAYS} 天被拦下的广告暂停建议超过 ${BLOCKED_READ_LIMIT} 条，这里只按最新的 ${BLOCKED_READ_LIMIT} 条列了，更早的没显示。`,
      how: '被拦这么多不正常 —— 回我一句「暂停建议被拦太多了」，我去看是哪条规则在挡。',
      href: '',
    })
  }
}
