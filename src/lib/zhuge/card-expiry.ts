/**
 * Recommendation-card auto-expiry (22.E.S18 前置 · 待办卫生).
 *
 * writeExecutionItems already supersedes an old zhuge card when a NEW card of
 * the same action_type arrives — but a card whose issue stopped being
 * recommended (rankings recovered, keyword dropped out) is never re-issued,
 * so it sits 'pending' forever. 447 such rows had accumulated by 2026-07-31.
 *
 * Rule: a zhuge-sourced card still pending after CARD_EXPIRY_DAYS is no
 * longer today's recommendation — mark it 'superseded' (existing status,
 * same value the persister uses). Human-created cards (source fde/luban)
 * are never touched: those are commitments, not recommendations.
 * SEO weekly-list items (steps_json.loop set) are also never touched here.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const CARD_EXPIRY_DAYS = 14

export interface CardExpiryResult {
  superseded: number
}

/** 「进行中」的卡片多少天没有任何更新就收口。改这个数不需要改清理函数。 */
export const STALE_IN_PROGRESS_DAYS = 30
/** 写进 auto_run_error，事后能分清这是被清理收口的，不是做完也不是人跳过的。 */
export function staleInProgressReason(days: number = STALE_IN_PROGRESS_DAYS): string {
  return `stale_in_progress_${days}d`
}

export interface StaleInProgressResult {
  closed: number
  days: number
}

export function cardExpiryCutoff(now: Date, days: number = CARD_EXPIRY_DAYS): string {
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - days)
  return cutoff.toISOString()
}

export async function supersedeStaleZhugeCards(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<CardExpiryResult> {
  const cutoff = cardExpiryCutoff(now)

  const { data, error } = await supabase
    .from('execution_items')
    .update({ status: 'superseded' })
    .eq('status', 'pending')
    .eq('source', 'zhuge')
    // SEO weekly-list items carry steps_json.loop and run their own expiry
    // (skipped + reason, visible in the weekly report) — never silently superseded.
    .is('steps_json->>loop', null)
    .lt('created_at', cutoff)
    .select('id')

  if (error) throw new Error(`card expiry failed: ${error.message}`)

  return { superseded: (data ?? []).length }
}

/**
 * 「进行中」超过 STALE_IN_PROGRESS_DAYS 天没有任何更新的卡片 → `skipped`。
 *
 * 为什么是 skipped 不是 completed：没人做完它，写 completed 会让看板假装
 * 活干完了。skipped 是现成的终态，原因写在 auto_run_error。
 *
 * 这和自动执行的「认领超时」不是一回事：认领两小时没结果就由
 * `releaseStaleClaims` 放回待做；这里管的是没人碰的卡。认领会刷新
 * updated_at（数据库触发器），所以阈值天级时两者不会互相踩。
 *
 * 和上面一样不碰 SEO 每周清单（steps_json.loop）——它们有自己的过期流程。
 */
export async function closeStaleInProgressCards(
  supabase: SupabaseClient,
  now: Date = new Date(),
  days: number = STALE_IN_PROGRESS_DAYS,
): Promise<StaleInProgressResult> {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString()

  const { data, error } = await supabase
    .from('execution_items')
    .update({ status: 'skipped', auto_run_error: staleInProgressReason(days) })
    .eq('status', 'in_progress')
    .is('steps_json->>loop', null)
    .lt('updated_at', cutoff)
    .select('id')

  if (error) throw new Error(`stale in_progress close failed: ${error.message}`)

  return { closed: (data ?? []).length, days }
}
