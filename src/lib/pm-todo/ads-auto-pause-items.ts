/**
 * Ads D3 自动暂停：等人批准的暂停建议 → 下发待办。
 *
 * 这条是「一键批准」流程唯一的入口——`ads-d3-auto-pause.ts` 只提交到 Kernel，
 * 停在 `pending_approval`；PM/FDE 必须从这里点进去才能看到、才能批准/驳回
 * （见 `src/lib/action-submission/ads-auto-pause.ts` 顶部注释：通用审批面
 * `kernel-approval/` 目前只支持签批准、不支持顺手执行，这一个动作专门建了
 * 自己的一键批准+执行入口，不复用那条通用但半成品的路）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'

export type AdsAutoPauseItemKind = 'ads_auto_pause_pending'

const APP_BASE = 'https://app.magicengine.com.au'

interface PendingPauseRow {
  id: string
  client_id: string
  created_at: string
  payload: {
    status?: string
    diagnosis_title?: string
    adset_name?: string | null
    adset_id?: string
    ad_account_id?: string
    action_run_id?: string
  } | null
}

export async function pushAdsAutoPauseItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
): Promise<void> {
  const { data, error } = await supabase
    .from('flywheel_actions')
    .select('id, client_id, created_at, payload')
    .eq('flywheel', 'ads')
    .eq('action_type', 'ads.auto_pause_on_d3')
    .eq('payload->>status', 'awaiting_approval')
    .order('created_at', { ascending: true })
    .limit(100)

  if (error) {
    console.warn('[manual-items] Ads D3 自动暂停待批准读取失败:', error.message)
    return
  }

  for (const row of (data ?? []) as PendingPauseRow[]) {
    const p = row.payload ?? {}
    const adsetLabel = p.adset_name ?? p.adset_id ?? '一个广告组'
    items.push({
      kind: 'ads_auto_pause_pending',
      client_id: row.client_id,
      client_name: nameOf(row.client_id),
      what: `${p.diagnosis_title ?? `「${adsetLabel}」连续花钱没结果`}——系统建议暂停，等你点头。`,
      how: '打开广告健康页的「自动暂停待批准」，点「批准」立刻暂停（不用去 Meta 后台），点「驳回」就不停。',
      href: `${APP_BASE}/dashboard/clients/${row.client_id}/ad-health/auto-pause`,
    })
  }
}
