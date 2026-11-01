/**
 * 今天**从「还在名单上」被推进到「不再联系」**的那些人（成交 / 停止营销 / 终态）。
 *
 * 「今天要联系」页（today 路由）和「全部客人」页的两张名单（contacts 路由 view=priority）
 * 共用这一份读取 —— 两处各写一套，同一个人会在一页就地变灰、在另一页掉进先放着
 * （魏征复审 PR #3417 P2-c）。
 *
 * 冻结副本要靠它把 `stageSuppressed` 清掉，让卡片留在原位变灰。
 *
 * ⚠️ **必须看改之前那个阶段抑不抑制，不能只看「今天改过阶段」**（Codex 复审 2026-08-15）：
 * 一个本来就不在名单上的人（已付定金）今天被推到另一个同样不在名单上的阶段（付清了），
 * 光凭「今天改过」就清掉抑制，冻结版会按历史触点把他判成 warm、塞进今天要联系的名单。
 * `from_stage` 为空（第一次挂阶段）当作「本来在名单上」。一天内改了多次只看最早那一条。
 * 读不到就当没有：最坏结果是人照旧当天消失（改动前的行为），不会多打电话。
 */

import { supabaseAdmin } from '@/lib/supabase'

export async function loadStageSuppressedTodayIds(
  clientId: string,
  dayStartMs: number,
  stageSuppressed: (stageKey: string) => boolean,
): Promise<Set<string>> {
  const out = new Set<string>()
  const seen = new Set<string>()
  try {
    const { data: events } = await supabaseAdmin
      .from('contact_stage_events')
      .select('contact_id, from_stage, created_at')
      .eq('client_id', clientId)
      .gte('created_at', new Date(dayStartMs).toISOString())
      .order('created_at', { ascending: true })

    for (const e of events ?? []) {
      const cid = e.contact_id as string
      if (seen.has(cid)) continue
      seen.add(cid)
      const from = e.from_stage as string | null
      if (!from || !stageSuppressed(from)) out.add(cid)
    }
  } catch (err) {
    console.error('[crm/day-list] 读今天的阶段变更失败，按「没改过」算:', err)
  }
  return out
}
