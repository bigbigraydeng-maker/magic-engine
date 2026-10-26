/**
 * 马良 · 出片自检的待办出口。
 *
 * 拉模式：读近 14 天 Creatomate 成片（content_factory_render_jobs，status
 * ready_for_review / needs_rework），再读对应 content_posts 的
 * `generation_context_snapshot.maliang_check`：
 *   - 过关 → 「马良：已自检过关，等你审片」（署名，PM 动手栏）
 *   - 不过关 → 「返工还是放弃」问 PM（这条片已标 needs_rework，不在审片队列）
 *   - 检不了 → 系统欠账
 *   - 成片落库 2 小时后仍没有自检记录 → 「没检」进系统欠账
 *     （事件丢了也不能静默）
 *
 * 只出待办，不发布、不改片、不重跑。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { readMaliangFromSnapshot } from '@/lib/maliang/render-check'
import { MACHINE_REVIEWED_KEY } from '@/lib/maliang/review-disposition'
import { isRemotionBrief } from '@/lib/factory/render-mode'
import { NEEDS_REWORK_STATUS } from '@/lib/inngest/functions/maliang-render-check'

export type MaliangItemKind =
  | 'maliang_render_passed'
  | 'maliang_render_failed'
  | 'maliang_check_unverifiable'
  | 'maliang_check_missing'

export interface MaliangTodo {
  kind: MaliangItemKind
  client_id: string
  what: string
  how: string
  href: string
}

export const RENDER_LOOKBACK_DAYS = 14
export const CHECK_GRACE_HOURS = 2

export interface RenderJobRow {
  id: string
  client_id: string
  content_post_id: string
  status: string
  updated_at: string
}

export interface PostRow {
  id: string
  title: string | null
  generation_context_snapshot: unknown
}

export function boardUrl(clientId: string): string {
  return `https://app.magicengine.com.au/dashboard/clients/${clientId}/content-factory`
}

export function factoryReviewUrl(): string {
  return 'https://app.magicengine.com.au/dashboard/factory'
}

function hoursSince(iso: string, now: Date): number {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 0
  return Math.max(0, Math.round((now.getTime() - then) / 3_600_000))
}

export function buildMaliangTodo(
  job: RenderJobRow,
  post: PostRow | undefined,
  now: Date,
): MaliangTodo | null {
  const title = post?.title ?? '(无标题)'
  const check = post ? readMaliangFromSnapshot(post.generation_context_snapshot) : null
  const href = boardUrl(job.client_id)

  if (!check) {
    if (job.status !== 'ready_for_review') return null
    const hours = hoursSince(job.updated_at, now)
    if (hours < CHECK_GRACE_HOURS) return null
    return {
      kind: 'maliang_check_missing',
      client_id: job.client_id,
      what: `马良还没检《${title}》这条成片（出片 ${hours} 小时了）—— 没检 ≠ 没问题，别直接发`,
      how: '这条不用你动手 —— 是自检事件没发出去或没跑。回我一句「马良重查」我去补',
      href,
    }
  }

  if (check.status === 'unverifiable') {
    return {
      kind: 'maliang_check_unverifiable',
      client_id: job.client_id,
      what: `马良看不了《${title}》：${check.reasons.join('；')}`,
      how:
        '这条不用你动手 —— 多半是模型钥匙没配或视频下载不了。回我一句「查一下马良」我去看；' +
        '这条片在审片队列里，你审的时候请自己逐镜看',
      href,
    }
  }

  if (check.status === 'fail') {
    const head = check.reasons.slice(0, 4).join('；')
    const tail = check.reasons.length > 4 ? `；另有 ${check.reasons.length - 4} 处` : ''
    return {
      kind: 'maliang_render_failed',
      client_id: job.client_id,
      what: `马良：《${title}》9 宫格自检不过关，没放进你的审片队列 —— ${head}${tail}`,
      how: `打开内容工厂看板看一眼这条视频，二选一回我：「返工 ${title}」我重做，「放弃 ${title}」我归档`,
      href,
    }
  }

  if (check.status === 'pass' && job.status === 'ready_for_review') {
    return {
      kind: 'maliang_render_passed',
      client_id: job.client_id,
      what: `马良：《${title}》9 宫格自检过关（图 / 字 / logo 都对），等你审片`,
      how: '打开内容工厂看板 → 出片段 → 这条视频 → 看完点通过或打回',
      href,
    }
  }

  return null
}

export async function fetchMaliangTodos(
  supabase: SupabaseClient,
  now: Date,
): Promise<MaliangTodo[]> {
  const sinceIso = new Date(now.getTime() - RENDER_LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data: jobData, error: jobError } = await supabase
    .from('content_factory_render_jobs')
    .select('id, client_id, content_post_id, status, updated_at')
    .eq('render_engine', 'creatomate')
    .in('status', ['ready_for_review', NEEDS_REWORK_STATUS])
    .gte('updated_at', sinceIso)
    .order('updated_at', { ascending: false })
    .limit(50)
  if (jobError) throw new Error(`maliang render jobs query failed: ${jobError.message}`)

  const jobs = (jobData ?? []) as RenderJobRow[]
  if (jobs.length === 0) return []

  const postIds = Array.from(new Set(jobs.map((j) => j.content_post_id).filter(Boolean)))
  const { data: postData, error: postError } = await supabase
    .from('content_posts')
    .select('id, title, generation_context_snapshot')
    .in('id', postIds)
  if (postError) throw new Error(`maliang posts query failed: ${postError.message}`)

  const postsById = new Map<string, PostRow>()
  for (const p of (postData ?? []) as PostRow[]) postsById.set(p.id, p)

  const todos: MaliangTodo[] = []
  for (const job of jobs) {
    const todo = buildMaliangTodo(job, postsById.get(job.content_post_id), now)
    if (todo) todos.push(todo)
  }
  const remotion = await fetchRemotionMaliangTodos(supabase, now)
  todos.push(...remotion)
  return todos
}

export interface RemotionOrderRow {
  id: string
  client_id: string
  status: string
  angle: string | null
  output: unknown
  updated_at: string
  brief: unknown
}

function machineReviewedFlag(output: unknown): boolean | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null
  const flag = (output as Record<string, unknown>)[MACHINE_REVIEWED_KEY]
  return typeof flag === 'boolean' ? flag : null
}

/** Template-render orders use the same todo kinds. The video link is the factory review screen. */
export function buildRemotionMaliangTodo(row: RemotionOrderRow, now: Date): MaliangTodo | null {
  if (!isRemotionBrief(row.brief)) return null
  const title = row.angle?.trim() || '(未命名)'
  const href = factoryReviewUrl()
  const check = readMaliangFromSnapshot(row.output)
  if (!check) {
    if (row.status !== 'in_review' || machineReviewedFlag(row.output) !== false) return null
    const hours = hoursSince(row.updated_at, now)
    if (hours < CHECK_GRACE_HOURS) return null
    return {
      kind: 'maliang_check_missing',
      client_id: row.client_id,
      what: `马良还没检《${title}》这条成片（出片 ${hours} 小时了）—— 没检 ≠ 没问题，别直接发`,
      how: '这条不用你动手 —— 是自检事件没发出去或没跑。回我一句「马良重查」我去补',
      href,
    }
  }
  if (check.status === 'unverifiable') {
    return {
      kind: 'maliang_check_unverifiable',
      client_id: row.client_id,
      what: `马良看不了《${title}》：${check.reasons.join('；')}`,
      how: '这条片已在审片队列里，标成还没经过机器审。你审的时候请自己逐镜看',
      href,
    }
  }
  if (check.status === 'fail') {
    const head = check.reasons.slice(0, 4).join('；')
    const tail = check.reasons.length > 4 ? `；另有 ${check.reasons.length - 4} 处` : ''
    return {
      kind: 'maliang_render_failed',
      client_id: row.client_id,
      what: `马良：《${title}》9 宫格自检不过关，没放进你的审片队列 —— ${head}${tail}`,
      how: `这条已经从待审里拿掉了，原因在上面。要重做就回我「返工 ${title}」，不要就回「放弃 ${title}」`,
      href,
    }
  }
  if (check.status === 'pass' && row.status === 'in_review') {
    return {
      kind: 'maliang_render_passed',
      client_id: row.client_id,
      what: `马良：《${title}》9 宫格自检过关（图 / 字 / logo 都对），等你审片`,
      how: '打开审片台看完这条，再点通过或打回',
      href,
    }
  }
  return null
}

export async function fetchRemotionMaliangTodos(
  supabase: SupabaseClient,
  now: Date,
): Promise<MaliangTodo[]> {
  const sinceIso = new Date(now.getTime() - RENDER_LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('content_work_orders')
    .select('id, client_id, status, angle, output, updated_at, brief')
    .in('status', ['in_review', 'review_rejected'])
    .gte('updated_at', sinceIso)
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(`maliang work orders query failed: ${error.message}`)
  const todos: MaliangTodo[] = []
  for (const row of (data ?? []) as RemotionOrderRow[]) {
    const todo = buildRemotionMaliangTodo(row, now)
    if (todo) todos.push(todo)
  }
  return todos
}

export async function pushMaliangRenderItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const todos = await fetchMaliangTodos(supabase, now)
  for (const todo of todos) {
    items.push({
      kind: todo.kind,
      client_id: todo.client_id,
      client_name: nameOf(todo.client_id),
      what: todo.what,
      how: todo.how,
      href: todo.href,
    })
  }
}
