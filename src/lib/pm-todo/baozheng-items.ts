/**
 * 包拯的两个待办出口。
 *
 * ① 复核分歧：读最近一次 `baozheng-weekly` 回执（≤ 9 天），把「AI 判的和复核模型判的不一样」的
 *    判断挑出来，一条判断一条待办，让人认一下谁对（规则书 BZ-19：两周不裁定就过期，算「未知」）。
 * ② 跑失败：整轮失败 → 一条平台治理待办；某个客户失败 → 一条该客户的待办。
 *
 * 判据取自机器自己写进运行记录的那份回执（跟 `libai-items.ts` 同一个套路）：
 * 说的话跟机器真做的事永远一致，也不用再查一遍数据库。
 *
 * 客人原话、姓名、复核理由一律不进 what/how（规则书 R5）—— 这些会随邮件发出去。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { isStoredReview, loadRulings } from '@/lib/baozheng/load'
import { BAOZHENG_JOB, type StoredReview } from '@/lib/baozheng/types'

export type BaozhengItemKind = 'baozheng_review_disagree' | 'baozheng_run_failed'

export interface BaozhengTodo {
  kind: BaozhengItemKind
  client_id: string
  what: string
  how: string
  href: string
}

/** 回执多旧就不再用：每周一轮，9 天（不用 7 的倍数） */
export const BAOZHENG_RECEIPT_FRESH_DAYS = 9
/** 分歧两周没人裁定就过期，算「未知」（规则书 BZ-19） */
export const RULING_EXPIRE_DAYS = 14
const MS_PER_DAY = 86_400_000

/** 复核页——一条判断的稳定入口。 */
export function rulingUrl(clientId: string, judgmentId: string): string {
  return `https://app.magicengine.com.au/dashboard/clients/${clientId}/baozheng/${judgmentId}`
}

/** 平台治理入口（跑失败时用）。 */
const CRON_HEALTH_URL = 'https://app.magicengine.com.au/dashboard/admin/cron-health'

/** 跑失败时统一的那句「不用你动手」。 */
const RUN_FAILED_HOW = '这条不用你动手 —— 回我一句「查一下包拯」我去看'

/** 分歧待办统一的那句「怎么认」。 */
const DISAGREE_HOW =
  '点链接看 AI 判断那一刻的对话，选「原来的 AI 对 / 复核的对 / 都不对」。只记下谁对，不会改客人现在的阶段；两周不点就过期'

/** 这条判断要不要人认：分歧、未裁定、未过期。 */
export function needsRuling(
  r: StoredReview,
  ruled: ReadonlySet<string>,
  nowMs: number,
): boolean {
  if (ruled.has(r.judgment_id)) return false
  if (r.result !== 'disagree') return false
  if (r.kind === 'pool' && r.review_stage === null) return false
  const t = Date.parse(r.reviewed_at)
  if (Number.isNaN(t)) return false
  if (nowMs - t > RULING_EXPIRE_DAYS * MS_PER_DAY) return false
  return true
}

/** 阶段 key → 人话；读不出就用 key 本身。 */
function labelOf(labels: ReadonlyMap<string, string>, key: string): string {
  const v = labels.get(key)
  return v && v.length > 0 ? v : key
}

/** 一条分歧判断 → 一条待办。what/how 里绝不带客人信息。 */
export function buildDisagreeTodo(
  clientId: string,
  r: StoredReview,
  labels: ReadonlyMap<string, string>,
): BaozhengTodo {
  const ai = labelOf(labels, r.ai_stage)
  const review = r.review_stage === null ? '（没读出）' : labelOf(labels, r.review_stage)

  const what =
    r.kind === 'pool'
      ? `包拯：AI 没读出这位客人到了哪一步（放进了「${ai}」），复核模型判成「${review}」—— 可能漏了一位好客人，要你认一下`
      : `包拯：AI 把一位客人判成「${ai}」，复核模型判成「${review}」—— 两个判得不一样，要你认一下谁对`

  return {
    kind: 'baozheng_review_disagree',
    client_id: clientId,
    what,
    how: DISAGREE_HOW,
    href: rulingUrl(clientId, r.judgment_id),
  }
}

interface RunRow {
  status: string | null
  finished_at: string | null
  summary: unknown
}

/**
 * 近 14 天真跑过的回执（跳过的 skipped 行不算），新的在前。查询失败 → 抛错（由调用方隔离）。
 * 读多行而不是只读最新一行：重跑或跳过一次不许把还没裁定的分歧清掉（子牙、魏征 P1）。
 */
async function loadRecentRuns(supabase: SupabaseClient, now: Date): Promise<RunRow[]> {
  const sinceIso = new Date(now.getTime() - RULING_EXPIRE_DAYS * MS_PER_DAY).toISOString()
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('status, finished_at, summary')
    .eq('job_name', BAOZHENG_JOB)
    .eq('summary->>skipped', 'false')
    .gte('started_at', sinceIso)
    .order('started_at', { ascending: false })
    .limit(20)

  if (error) throw new Error(error.message)
  return (data ?? []) as RunRow[]
}

interface ClientBlock {
  clientId: string
  status: string
  reason: string | null
  reviews: StoredReview[]
}

/** summary.clients[] → ClientBlock[]；坏条目跳过，reviews 用 isStoredReview 过滤。 */
export function readClientBlocks(summary: unknown): ClientBlock[] {
  if (typeof summary !== 'object' || summary === null) return []
  const o = summary as Record<string, unknown>
  if (!Array.isArray(o.clients)) return []

  const blocks: ClientBlock[] = []
  for (const raw of o.clients) {
    if (typeof raw !== 'object' || raw === null) continue
    const c = raw as Record<string, unknown>
    if (typeof c.client_id !== 'string' || typeof c.status !== 'string') continue
    const reason = typeof c.reason === 'string' ? c.reason : null
    const reviews = Array.isArray(c.reviews) ? c.reviews.filter(isStoredReview) : []
    blocks.push({ clientId: c.client_id, status: c.status, reason, reviews })
  }
  return blocks
}

/** 读这个客户的阶段标签。查询失败 → 抛错。 */
async function loadLabels(
  supabase: SupabaseClient,
  clientId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('client_pipeline_stages')
    .select('stage_key, label')
    .eq('client_id', clientId)

  if (error) throw new Error(error.message)

  const rows = (data ?? []) as Array<{ stage_key: string; label: string | null }>
  const map = new Map<string, string>()
  for (const row of rows) {
    const label = row.label && row.label.length > 0 ? row.label : row.stage_key
    map.set(row.stage_key, label)
  }
  return map
}

/** 回执多旧了（天）。时间戳读不出 → null。 */
function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / MS_PER_DAY
}

/** 整轮失败 → 一条平台治理待办。 */
function runFailedTodo(): BaozhengTodo {
  return {
    kind: 'baozheng_run_failed',
    client_id: 'infra',
    what: '包拯这周的复核没跑成 —— AI 判客人阶段准不准，这周没有新数',
    how: RUN_FAILED_HOW,
    href: CRON_HEALTH_URL,
  }
}

/** 某个客户失败 → 一条该客户的待办。 */
function clientFailedTodo(block: ClientBlock): BaozhengTodo {
  return {
    kind: 'baozheng_run_failed',
    client_id: block.clientId,
    what: `包拯这周没复核成这个客户：${block.reason ?? '原因没记下'}`,
    how: RUN_FAILED_HOW,
    href: CRON_HEALTH_URL,
  }
}

/** 一个「已复核」客户的分歧待办。 */
async function clientDisagreeTodos(
  supabase: SupabaseClient,
  block: ClientBlock,
  nowMs: number,
): Promise<BaozhengTodo[]> {
  const ruled = new Set((await loadRulings(supabase, block.clientId)).keys())
  const labels = await loadLabels(supabase, block.clientId)
  const todos: BaozhengTodo[] = []
  for (const r of block.reviews) {
    if (needsRuling(r, ruled, nowMs)) {
      todos.push(buildDisagreeTodo(block.clientId, r, labels))
    }
  }
  return todos
}

/** 同一客户、同一判断在几轮回执里出现，只留最新那条（新的在前，先到先得）。 */
export function mergeBlocks(runs: readonly RunRow[]): Map<string, StoredReview[]> {
  const byClient = new Map<string, Map<string, StoredReview>>()
  for (const run of runs) {
    for (const block of readClientBlocks(run.summary)) {
      if (block.status !== 'reviewed') continue
      const seen = byClient.get(block.clientId) ?? new Map<string, StoredReview>()
      for (const r of block.reviews) if (!seen.has(r.judgment_id)) seen.set(r.judgment_id, r)
      byClient.set(block.clientId, seen)
    }
  }
  return new Map(Array.from(byClient.entries()).map(([id, m]) => [id, Array.from(m.values())]))
}

/** 失败只看最新一轮：它够新、整轮失败或某个客户失败，才报。 */
export function failureTodos(latest: RunRow | undefined, now: Date): BaozhengTodo[] {
  if (!latest) return []
  const age = daysSince(latest.finished_at, now)
  if (age === null || age > BAOZHENG_RECEIPT_FRESH_DAYS) return []
  if (latest.status === 'failed' && readClientBlocks(latest.summary).length === 0) return [runFailedTodo()]
  return readClientBlocks(latest.summary).filter((b) => b.status === 'failed').map(clientFailedTodo)
}

/** 近 14 天的回执合起来出分歧待办，再加最新一轮的失败待办。 */
export async function fetchBaozhengTodos(
  supabase: SupabaseClient,
  now: Date,
): Promise<BaozhengTodo[]> {
  const runs = await loadRecentRuns(supabase, now)
  const todos = failureTodos(runs[0], now)
  const nowMs = now.getTime()
  for (const [clientId, reviews] of mergeBlocks(runs)) {
    todos.push(...(await clientDisagreeTodos(supabase, { clientId, status: 'reviewed', reason: null, reviews }, nowMs)))
  }
  return todos
}

/** 把待办推进今日待办三件套。 */
export async function pushBaozhengItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const todos = await fetchBaozhengTodos(supabase, now)
  for (const todo of todos) {
    items.push({
      kind: todo.kind,
      client_id: todo.client_id,
      client_name:
        todo.client_id === 'infra' ? 'Magic Engine 平台治理' : nameOf(todo.client_id),
      what: todo.what,
      how: todo.how,
      href: todo.href,
    })
  }
}
