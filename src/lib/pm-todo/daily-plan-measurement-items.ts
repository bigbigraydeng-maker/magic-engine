/**
 * 今日待办里的「Facebook 帖子发出去了，但成绩收不回来」。
 *
 * 数据来源：`daily-plan-post-story-resolve` 工作流写进 `cron_run_logs` 的失败记录
 * （job_name = STORY_RESOLVE_JOB_NAME，status = failed）。不单开表 —— 这条信息本来
 * 就是那次运行的产物，照 `pushPaidSignalReviewItems` 同一个套路读。
 *
 * 拉模式：直接查库，事件丢了、进程重启了，待办照样出得来。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import { STORY_RESOLVE_JOB_NAME } from '@/lib/campaign/daily-plan-publish'

export type DailyPlanMeasurementItemKind = 'daily_plan_post_unmeasured' | 'daily_plan_first_comment_failed'

const APP_BASE = 'https://app.magicengine.com.au'
const LOOKBACK_DAYS = 7
const MAX_ITEMS = 20

interface ResolveFailureSummary {
  outcome?: unknown
  reason?: unknown
  client_id?: unknown
  date?: unknown
  idempotency_key?: unknown
  photo_id?: unknown
  post_id?: unknown
  first_comment_text?: unknown
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 只写眼下真能做的动作。系统目前**没有**「补读成绩」的按钮（已登记 issue），
 * 所以最后一步是把待办原样转给开发，并把开发要用的两个编号写全，不用再问人。
 */
function howFor(reason: string, clientId: string, key: string, objectId: string): { how: string; href: string } {
  const facebookLink = `https://www.facebook.com/${objectId}`
  const handoff = `把这条待办转给开发补读成绩，附上：编号 ${objectId}、防重复编号 ${key}`
  if (reason === 'token_unavailable') {
    return {
      how: `这个客户的 Facebook 主页授权读不到了。① 打开链接 →「平台连接」→ 点「连接 Meta」重新授权；② 打开 ${facebookLink} 确认这条帖子是公开状态；③ 重连之后成绩也不会自己补上，仍需${handoff}`,
      href: `${APP_BASE}/dashboard/clients/${clientId}/settings`,
    }
  }
  return {
    how: `① 打开链接，确认这条帖子在 Facebook 上是公开状态；② 如果打不开或已被删，这条不用再管；③ 如果是公开的，${handoff}`,
    href: facebookLink,
  }
}

/**
 * 帖子发出去了，但第一条评论（放预约链接的那条）没贴上 —— 读者在帖子里找不到预约入口。
 * 文案已经写好，PM 复制即可，不用再问人。
 */
function firstCommentItem(
  clientId: string,
  clientName: string,
  date: string,
  reason: string,
  commentText: string,
  objectId: string,
): ManualItem {
  return {
    kind: 'daily_plan_first_comment_failed',
    client_id: clientId,
    client_name: clientName,
    what: `${clientName} 计划在 ${date || '某天'} 发的 Facebook 帖子已经发出，但第一条评论（放预约链接的那条）没贴上 —— 现在这条帖子里读者找不到预约入口`,
    how: `① 打开链接，确认这条帖子是公开状态；② 用主页身份在这条帖子下面发一条评论，内容照抄下面这段：\n${commentText}\n③ 发完这条待办不用再管。失败原因：${reason || '未记录'}；如果原因是 token_unavailable，先到客户设置「平台连接」点一次「连接 Meta」。`,
    href: `https://www.facebook.com/${objectId}`,
  }
}

export async function pushDailyPlanMeasurementItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  clientNames: Map<string, { name: string }>,
): Promise<void> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('summary, started_at')
    .eq('job_name', STORY_RESOLVE_JOB_NAME)
    .eq('status', 'failed')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`cron_run_logs query failed: ${error.message}`)

  const seen = new Set<string>()
  for (const row of (data ?? []) as Array<{ summary?: ResolveFailureSummary | null }>) {
    const s = row.summary ?? {}
    const clientId = str(s.client_id)
    const key = str(s.idempotency_key)
    // Scheduled photos carry photo_id; immediate posts whose handoff failed carry post_id.
    const objectId = str(s.photo_id) || str(s.post_id)
    const isFirstComment = str(s.outcome) === 'first_comment_failed'
    const dedupKey = `${isFirstComment ? 'first_comment' : 'measurement'}:${key}`
    if (!clientId || !key || !objectId || seen.has(dedupKey)) continue
    seen.add(dedupKey)
    if (seen.size > MAX_ITEMS) break

    const clientName = clientNames.get(clientId)?.name ?? '未知客户'
    const date = str(s.date)
    if (isFirstComment) {
      const commentText = str(s.first_comment_text) || '（内容没记录，请按该日计划里的 CTA 和链接重写一条）'
      items.push(firstCommentItem(clientId, clientName, date, str(s.reason), commentText, objectId))
      continue
    }
    const { how, href } = howFor(str(s.reason), clientId, key, objectId)
    const firstCommentText = str(s.first_comment_text)
    const howWithCommentWarning = firstCommentText
      ? `${how}\n④ 这条帖子的首评（放预约链接的评论）可能也没贴上：打开帖子看一眼，如果没有，用主页身份照抄这段评论：\n${firstCommentText}`
      : how
    items.push({
      kind: 'daily_plan_post_unmeasured',
      client_id: clientId,
      client_name: clientName,
      what: `${clientName} 计划在 ${date || '某天'} 发的 Facebook 帖子已经交给 Facebook 了，但系统没能开始回收它的成绩 —— 这条帖子的点赞、评论、转发不会被自动记下来，后面的「该不该照这个再发」建议也会缺这一条`,
      how: howWithCommentWarning,
      href,
    })
  }
}
