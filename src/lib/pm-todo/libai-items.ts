/**
 * 李白的两个待办出口。
 *
 * ① 文案溯源：拉模式读近 14 天的 content_posts，
 *    `generation_context_snapshot.libai_provenance` 里「未证实」句 > 0 → 三件套（署名「李白」）；
 *    标成 unverifiable → 系统欠账；有逐字稿却 2 小时后仍没有溯源记录 → 「没检」进系统欠账
 *    （事件丢了也不能静默）。
 * ② 提示词库月检：读最近一次 `libai-prompt-library-monthly` 回执（≤ 27 天，未 skipped），
 *    有 findings → 一条平台治理待办，只报告不改。
 *
 * 判据取自机器自己写进快照 / 运行记录的那份回执（跟 `simaqian-review-items.ts` 同一个套路）：
 * 说的话跟机器真做的事永远一致，也不用再查一遍官网。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { readProvenanceFromSnapshot } from '@/lib/content/libai-provenance'
import {
  LIBAI_PROMPT_AUDIT_JOB,
  LIBAI_PROMPT_AUDIT_FRESH_DAYS,
} from '@/lib/inngest/functions/libai-prompt-library-monthly'

export type LibaiItemKind =
  | 'libai_copy_unverified'
  | 'libai_check_unverifiable'
  | 'libai_check_missing'
  | 'libai_prompt_library_stale'

export interface LibaiTodo {
  kind: LibaiItemKind
  client_id: string
  what: string
  how: string
  href: string
}

/** 文案溯源只看近 14 天的稿子——更早的早该改完了。 */
export const COPY_LOOKBACK_DAYS = 14
/** 有逐字稿却超过这么久还没溯源记录 → 判「没检」（事件丢了也不能静默）。 */
export const CHECK_GRACE_HOURS = 2
/** what 里最多列几句未证实，多了就让人去看看板。 */
export const MAX_UNVERIFIED_IN_WHAT = 4

export interface PostRow {
  id: string
  client_id: string
  title: string | null
  script: string | null
  created_at: string
  status: string
  generation_context_snapshot: unknown
}

/** 内容工厂看板——客户维度的稳定入口。 */
export function boardUrl(clientId: string): string {
  return `https://app.magicengine.com.au/dashboard/clients/${clientId}/content-factory`
}

/** 生成多久了（小时）。时间戳读不出 → null。 */
function hoursSince(iso: string, now: Date): number | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / 3_600_000
}

/** 一条 content_post → 最多一条待办。 */
export function buildCopyTodo(post: PostRow, now: Date): LibaiTodo | null {
  const title = post.title ?? '（无标题）'
  const href = boardUrl(post.client_id)
  const prov = readProvenanceFromSnapshot(post.generation_context_snapshot)

  if (prov === null) {
    if (!post.script || post.script.trim().length === 0) return null
    const hours = hoursSince(post.created_at, now)
    if (hours === null || hours <= CHECK_GRACE_HOURS) return null
    return {
      kind: 'libai_check_missing',
      client_id: post.client_id,
      what: `李白还没检《${title}》的文案溯源（生成 ${Math.floor(hours)} 小时了）—— 没检 ≠ 句句有依据`,
      how: '这条不用你动手 —— 是溯源事件没发出去或没跑。回我一句「李白重查」我去补',
      href,
    }
  }

  if (prov.status === 'unverifiable') {
    return {
      kind: 'libai_check_unverifiable',
      client_id: post.client_id,
      what: `李白检不了《${title}》：${prov.reason}`,
      how: '这条不用你动手 —— 多半是客户官网网址没配或读不到。回我一句「查一下李白」我去看',
      href,
    }
  }

  if (prov.unverified_count <= 0) return null

  const unverified = prov.sentences.filter(s => s.label === 'unverified')
  const shown = unverified.slice(0, MAX_UNVERIFIED_IN_WHAT)
  const lines = shown.map(s => `「${s.text}」（${s.note}）`).join('；')
  const extra = unverified.length > MAX_UNVERIFIED_IN_WHAT
    ? `；另有 ${unverified.length - MAX_UNVERIFIED_IN_WHAT} 句`
    : ''

  return {
    kind: 'libai_copy_unverified',
    client_id: post.client_id,
    what: `李白：《${title}》有 ${prov.unverified_count} 句在官网和 brief 里都找不到依据：${lines}${extra}`,
    how: '打开内容工厂看板 → 找到这条选题 → 逐字稿里把这几句二选一：改成官网写过的说法，或直接删掉。改完回我一句「李白重查 <标题>」',
    href,
  }
}

/** 拉近 14 天的稿子，逐条判。查询失败 → 抛错（由调用方隔离）。 */
export async function fetchLibaiCopyTodos(
  supabase: SupabaseClient,
  now: Date,
): Promise<LibaiTodo[]> {
  const sinceIso = new Date(now.getTime() - COPY_LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('content_posts')
    .select('id, client_id, title, script, created_at, status, generation_context_snapshot')
    .in('status', ['draft', 'approved', 'scheduled'])
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) throw new Error(error.message)

  const rows = (data ?? []) as unknown as PostRow[]
  const todos: LibaiTodo[] = []
  for (const row of rows) {
    const todo = buildCopyTodo(row, now)
    if (todo) todos.push(todo)
  }
  return todos
}

interface PromptFinding {
  file: string
  line: number
  reference: string
  reason: string
}

function isFinding(v: unknown): v is PromptFinding {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.file === 'string' &&
    typeof o.line === 'number' &&
    typeof o.reference === 'string' &&
    typeof o.reason === 'string'
  )
}

/** 月检回执 summary → 最多一条平台治理待办。 */
export function buildPromptLibraryTodo(summary: unknown): LibaiTodo | null {
  if (typeof summary !== 'object' || summary === null) return null
  const o = summary as Record<string, unknown>
  if (o.skipped === true) return null
  if (!Array.isArray(o.findings)) return null
  const findings = o.findings.filter(isFinding)
  if (findings.length === 0) return null

  const shown = findings
    .slice(0, 3)
    .map(f => `${f.file}:${f.line} ${f.reference}（${f.reason}）`)
    .join('；')

  return {
    kind: 'libai_prompt_library_stale',
    client_id: 'infra',
    what: `李白月检：提示词库有 ${findings.length} 处疑似过期，比如 ${shown}`,
    how: '这条不用你动手 —— 提示词库是李白管的文档。回我一句「修提示词库」我去改；这次只报告，没改任何文件',
    href: 'https://github.com/bigbigraydeng-maker/magic-engine/tree/main/docs/agents/prompt-library',
  }
}

/** 上一轮月检跑完多久了。跑到一半没写完 finished_at 的当作太旧，不用。 */
function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / 86_400_000
}

/** 读最近一次月检回执，够新且未 skipped 才出待办。 */
export async function fetchPromptLibraryTodo(
  supabase: SupabaseClient,
  now: Date,
): Promise<LibaiTodo | null> {
  const { data } = await supabase
    .from('cron_run_logs')
    .select('finished_at, summary, status')
    .eq('job_name', LIBAI_PROMPT_AUDIT_JOB)
    .order('started_at', { ascending: false })
    .limit(1)

  const run = (data ?? [])[0] as
    | { finished_at: string | null; summary: unknown; status: string | null }
    | undefined
  if (!run) return null
  if (run.status !== 'completed') return null

  const age = daysSince(run.finished_at, now)
  if (age === null || age > LIBAI_PROMPT_AUDIT_FRESH_DAYS) return null

  return buildPromptLibraryTodo(run.summary)
}

/** 把待办推进今日待办三件套。 */
export async function pushLibaiItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const copyTodos = await fetchLibaiCopyTodos(supabase, now)
  for (const todo of copyTodos) {
    items.push({
      kind: todo.kind,
      client_id: todo.client_id,
      client_name: nameOf(todo.client_id),
      what: todo.what,
      how: todo.how,
      href: todo.href,
    })
  }

  const promptTodo = await fetchPromptLibraryTodo(supabase, now)
  if (promptTodo) {
    items.push({
      kind: promptTodo.kind,
      client_id: promptTodo.client_id,
      client_name: 'Magic Engine 平台治理',
      what: promptTodo.what,
      how: promptTodo.how,
      href: promptTodo.href,
    })
  }
}
