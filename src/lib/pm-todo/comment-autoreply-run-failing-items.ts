/**
 * 评论自动回复「整轮扫描连续失败」→ 下发到待办（开发栏）。
 *
 * 🔴 2026-10-10 实测（生产 cron_run_logs，CTS）：8/25–9/7 拿不到主页令牌、9/10–9/22
 *    每半小时一次 Meta 回「一次要的数据太多」，这个任务每一轮都被记成 `completed`、
 *    0 条评论 —— 约一个月没人知道它其实什么都没读到。
 *
 * 判据只看这个任务自己的运行记录：最近连续 N 轮都有客户的扫描没跑完
 * （运行状态是失败，或结果里有 `ok:false`）。偶发一两轮失败（Meta 抖动）机器会自己
 * 在下一轮重试，不下发，免得制造噪音。
 *
 * 不猜根因：只把最近一次的失败原因归成一类大白话，原文截断放进说明。不含评论内容。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { APP_BASE } from './binding-request-items'

export const JOB_NAME = 'social-comment-autoreply'
/** 每 30 分钟一轮，连续 6 轮 ≈ 3 小时都没扫完才算「卡住」。 */
export const CONSECUTIVE_FAILED_RUNS = 6
/** 最新一轮必须是这么多天以内的；更旧的「该跑没跑」归 cron 健康检查管。 */
const RUN_STALE_DAYS = 2

/** 这条读得到的字段是已落库的旧数据，当外部输入处理。 */
export interface CommentRunLogRow {
  status: string | null
  finished_at: string | null
  failed_count: number | null
  error_message: string | null
  summary: { results?: Array<{ client_id?: unknown; ok?: unknown; error?: unknown }> } | null
}

export interface CommentAutoreplyRunFailingTodo {
  kind: 'comment_autoreply_run_failing'
  client_id: string
  what: string
  how: string
  href: string
}

function runFailedForClient(run: CommentRunLogRow, clientId: string): boolean {
  const results = Array.isArray(run.summary?.results) ? run.summary!.results! : []
  const mine = results.find((r) => r && r.client_id === clientId)
  if (mine) return mine.ok === false
  // 这一轮没有该客户的结果（客户刚开启、或这轮被熔断）：没数据不算失败，
  // 否则别的客户一直失败时，新开的客户会被误报
  return false
}

function describeReason(raw: string): string {
  if (/reduce the amount of data/i.test(raw)) return 'Meta 说一次要的帖子数据太多（已自动减半重试仍不行）'
  if (/page_not_verified|could not resolve Page access token|no Meta token/i.test(raw)) return '拿不到这个主页的授权'
  if (/token|\b190\b|OAuth/i.test(raw)) return '主页授权被 Meta 拒了'
  return '读取帖子/评论时 Meta 报错'
}

/** 运行记录（新→旧）+ 客户 id 列表 → 每个连续失败的客户最多一条待办。纯函数。 */
export function buildCommentAutoreplyRunFailingTodos(
  runsNewestFirst: readonly CommentRunLogRow[],
  clientIds: readonly string[],
  now: Date,
): CommentAutoreplyRunFailingTodo[] {
  const newest = runsNewestFirst[0]
  if (!newest || runsNewestFirst.length < CONSECUTIVE_FAILED_RUNS) return []
  const finished = Date.parse(newest.finished_at ?? '')
  if (Number.isNaN(finished) || (now.getTime() - finished) / 86_400_000 > RUN_STALE_DAYS) return []

  const todos: CommentAutoreplyRunFailingTodo[] = []
  for (const clientId of clientIds) {
    const recent = runsNewestFirst.slice(0, CONSECUTIVE_FAILED_RUNS)
    if (!recent.every((r) => runFailedForClient(r, clientId))) continue

    const mine = (newest.summary?.results ?? []).find((r) => r && r.client_id === clientId)
    const rawReason = typeof mine?.error === 'string' ? mine.error : (newest.error_message ?? '')
    todos.push({
      kind: 'comment_autoreply_run_failing',
      client_id: clientId,
      what:
        `评论自动回复已开启，但最近连续 ${CONSECUTIVE_FAILED_RUNS} 轮（约 3 小时）都没扫完这个客户的 Facebook 主页：` +
        `${describeReason(rawReason)}。这段时间里客人的新留言系统一条都没读到，也就不会有人回。`,
      how:
        '交给开发看：先打开链接确认评论自动回复开关和主页是否正确；再查 Render 日志里 ' +
        'social-comment-autoreply 最近一轮的报错原文（说明里只有截断的原因）。' +
        '机器已经会自动减半重试，仍然失败说明不是数据量问题，要看授权或 Meta 接口变化。',
      href: `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/settings`,
    })
  }
  return todos
}

export async function fetchCommentAutoreplyRunFailingTodos(
  supabase: SupabaseClient,
  now: Date,
): Promise<CommentAutoreplyRunFailingTodo[]> {
  const { data: cfg, error: cfgError } = await supabase
    .from('social_comment_config')
    .select('client_id')
    .eq('enabled', true)
  if (cfgError || !cfg || cfg.length === 0) return []

  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('status, finished_at, failed_count, error_message, summary')
    .eq('job_name', JOB_NAME)
    .neq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(CONSECUTIVE_FAILED_RUNS)
  if (error || !data) return []

  return buildCommentAutoreplyRunFailingTodos(
    data as CommentRunLogRow[],
    (cfg as Array<{ client_id: string }>).map((c) => c.client_id),
    now,
  )
}
