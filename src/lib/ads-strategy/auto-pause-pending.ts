/**
 * Ads D3 自动暂停：等人批准的暂停建议 —— 专属批准页和今日待办共用这一份读法。
 *
 * 🔴 真相是 Kernel 的 `action_runs`（`status='pending_approval'`），不是
 *    `flywheel_actions` 那张账表。账表只拿来补展示字段（广告组名、诊断标题）：
 *      · 账表漏记的 run（提交成功、写账失败）照样列出、照样能批；
 *      · 在别处已经有结论的 run（账表还写着 awaiting_approval）不再列出。
 *    通用 handoff 对这个动作的等批准已经不发待办了（见
 *    `kernel/dedicated-approval-entries.ts`），这里读漏 = 这条从所有待办里消失。
 *
 * 🔴 `expectedDecisionId` 取自**此刻** run 上挂着、且确属这条 run 的那份审批请求。
 *    页面渲染时拿到它、点的时候原样带回去 —— 批的就是人看到的那一份。
 *    不用提交时写进账表的那个值：run 一旦被重签，旧值永远对不上，这条就再也批不了。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  listPendingRunsForActionAllClients,
  listPendingRunsForActionForClient,
  type PendingRunForAction,
  type PendingRunsForAction,
} from '@/lib/kernel-approval/action-pending'
import { ADS_AUTO_PAUSE_ACTION_KEY } from '@/lib/action-submission/ads-auto-pause-key'

export interface PendingAdsAutoPause {
  readonly runId: string
  readonly clientId: string
  /** null = 这条的审批请求对不上 / 读不到 —— 谁都不能批，必须如实说。 */
  readonly expectedDecisionId: string | null
  /** 真正会被暂停的那个广告组 —— 来自 run 的入参，不是账表。 */
  readonly adsetId: string | null
  readonly adAccountId: string | null
  readonly insightDate: string | null
  /** 展示用，来自账表；账表漏记时为 null。 */
  readonly adsetName: string | null
  readonly diagnosisTitle: string | null
  readonly createdAt: string
}

export interface PendingAdsAutoPauseList {
  readonly items: PendingAdsAutoPause[]
  readonly hasMore: boolean
}

interface LedgerRow {
  client_id: string
  payload: { action_run_id?: string; adset_name?: string | null; diagnosis_title?: string } | null
}

export async function listPendingAdsAutoPauseForClient(
  sb: SupabaseClient,
  clientId: string,
): Promise<PendingAdsAutoPauseList> {
  return enrich(sb, await listPendingRunsForActionForClient(sb, ADS_AUTO_PAUSE_ACTION_KEY, clientId))
}

export async function listPendingAdsAutoPauseAllClients(sb: SupabaseClient): Promise<PendingAdsAutoPauseList> {
  return enrich(sb, await listPendingRunsForActionAllClients(sb, ADS_AUTO_PAUSE_ACTION_KEY))
}

async function enrich(sb: SupabaseClient, pending: PendingRunsForAction): Promise<PendingAdsAutoPauseList> {
  const ledger = await loadLedger(sb, pending.items.map((i) => i.run.id))
  const items = pending.items.map((item) => {
    const row = ledger.get(item.run.id)
    // 🔴 账表那行必须是同一个客户的 —— 不拿别的客户的广告组名贴到这条上
    return toItem(item, row && row.client_id === item.run.client_id ? row : undefined)
  })
  return { items, hasMore: pending.hasMore }
}

/** 补展示字段。读失败只降级（名字显示为空），不让整批待批准跟着消失。 */
async function loadLedger(sb: SupabaseClient, runIds: string[]): Promise<Map<string, LedgerRow>> {
  if (runIds.length === 0) return new Map()
  const { data, error } = await sb
    .from('flywheel_actions')
    .select('client_id, payload')
    .eq('flywheel', 'ads')
    .eq('action_type', ADS_AUTO_PAUSE_ACTION_KEY)
    .in('payload->>action_run_id', runIds)
  if (error) {
    console.warn('[ads-auto-pause] 读取账表展示字段失败（降级为不显示广告组名）:', error.message)
    return new Map()
  }
  const map = new Map<string, LedgerRow>()
  for (const row of (data ?? []) as LedgerRow[]) {
    const runId = row.payload?.action_run_id
    if (runId) map.set(runId, row)
  }
  return map
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function toItem(item: PendingRunForAction, row: LedgerRow | undefined): PendingAdsAutoPause {
  const { run } = item
  return {
    runId: run.id,
    clientId: run.client_id,
    expectedDecisionId: item.expectedDecisionId,
    adsetId: str(run.input.adset_id),
    adAccountId: str(run.input.ad_account_id),
    insightDate: str(run.input.insight_date),
    adsetName: str(row?.payload?.adset_name),
    diagnosisTitle: str(row?.payload?.diagnosis_title) ?? str(run.rationale),
    createdAt: run.created_at,
  }
}
