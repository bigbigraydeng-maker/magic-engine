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
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import { listPendingAdsAutoPauseAllClients, type PendingAdsAutoPause } from '@/lib/ads-strategy/auto-pause-pending'
import { dedicatedApprovalEntryFor } from '@/lib/kernel/dedicated-approval-entries'
import { ADS_AUTO_PAUSE_ACTION_KEY } from '@/lib/action-submission/ads-auto-pause-key'

export type AdsAutoPauseItemKind = 'ads_auto_pause_pending'

const APP_BASE = 'https://app.magicengine.com.au'

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
): Promise<void> {
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
    return
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
}
