import { buildCommentScopeTodo, type CommentRunResult } from '@/lib/pm-todo/comment-scope-items'
import type { LedgerCardView } from './classify'
import type { ParsedProbe, ProbeResult } from './types'

export interface CronRunRow {
  status: string | null
  started_at: string
}

export interface CommentRunSnapshot {
  finished_at: string | null
  results: CommentRunResult[]
}

export interface ProbeDeps {
  now: () => Date
  /** cron_run_logs rows for one job started at/after sinceIso. Throws on query error. */
  loadCronRuns: (job: string, sinceIso: string) => Promise<CronRunRow[]>
  /** only these job names may be probed (whitelist, from the cron registry) */
  allowedJobs: ReadonlySet<string>
  /** newest social-comment-autoreply run summary; null = no run exists. Throws on query error. */
  loadCommentRun: () => Promise<CommentRunSnapshot | null>
  /** 现在会出现的「评论回复权限缺失」待办（来自 fetchCommentReplyScopeTodos）。查询出错时该函数返回空——所以「没有」只会判 failed，永远不会判通过。 */
  loadReplyScopeTodos: () => Promise<{ client_id: string; kind: string }[]>
  /** true if a client row with this id exists. Throws on query error. */
  clientExists: (clientId: string) => Promise<boolean>
  /** ledger card by id from the deployed docs/ledger, undefined if absent */
  loadCard: (id: string) => LedgerCardView | undefined
}

/** 评论自动回复 cron 每 30 分钟一轮；两天足够宽松。 */
const COMMENT_RUN_STALE_DAYS = 2

/** 出错信息截断长度，避免把整段堆栈塞进待办。 */
const ERROR_FACT_MAX = 160

const COMMENT_TODO_KINDS: ReadonlySet<string> = new Set([
  'comment_scope_missing',
  'comment_token_invalid',
])
const REPLY_SCOPE_KIND = 'comment_reply_scope_missing'

/** 参数不合格的统一说法（parse 层已校验，这里是纵深防御）。 */
const BAD_PARAMS_FACT = '核对参数不合格'

function unreadable(fact: string, fetchedAt: string): ProbeResult {
  return { outcome: 'unreadable', fact, fetchedAt, sample: null }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

/** 把任意抛出物变成一句人话。 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}

/** 参数必须恰好是给定的键集合，不多不少。 */
function hasExactKeys(params: Record<string, string>, keys: readonly string[]): boolean {
  const actual = Object.keys(params)
  if (actual.length !== keys.length) return false
  return keys.every((k) => Object.prototype.hasOwnProperty.call(params, k))
}

/** within_hours 必须是 1..720 的整数。 */
function parseWithinHours(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 720) return null
  return n
}

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / 86_400_000
}

async function probeCronRunOk(
  params: Record<string, string>,
  deps: ProbeDeps,
  fetchedAt: string,
): Promise<ProbeResult> {
  if (!hasExactKeys(params, ['job', 'within_hours'])) return unreadable(BAD_PARAMS_FACT, fetchedAt)

  const job = params.job
  const withinHours = parseWithinHours(params.within_hours)
  if (withinHours === null) return unreadable(BAD_PARAMS_FACT, fetchedAt)

  if (!deps.allowedJobs.has(job)) return unreadable('任务名不在白名单', fetchedAt)

  const since = new Date(deps.now().getTime() - withinHours * 3_600_000).toISOString()
  const rows = await deps.loadCronRuns(job, since)
  const sample = rows.length

  if (rows.length === 0) {
    return {
      outcome: 'not_yet',
      fact: '时间窗内没有运行记录；窗口短于任务周期时不代表没跑',
      fetchedAt,
      sample,
    }
  }

  // 正在进行中的记录（status=running）不是结果：巡检核对自己时会看到自己这一轮的开跑行，
  // 把它算进"没有成功的"会每次都误判 failed（2026-10-12 首次线上真跑发现）。
  const finished = rows.filter((r) => r.status !== 'running')
  if (finished.length === 0) {
    return {
      outcome: 'not_yet',
      fact: `时间窗内只有 ${rows.length} 条正在进行中的记录，还没有跑完的`,
      fetchedAt,
      sample,
    }
  }

  const completed = finished.filter((r) => r.status === 'completed').length
  if (completed > 0) {
    return {
      outcome: 'passed_needs_human_confirm',
      fact: `${finished.length} 条跑完的运行记录里有成功的`,
      fetchedAt,
      sample,
    }
  }

  const failed = finished.filter((r) => r.status === 'failed').length
  return {
    outcome: 'failed',
    fact: `${finished.length} 条跑完的运行记录里没有成功的（${failed} 条失败）`,
    fetchedAt,
    sample,
  }
}

async function probeTodoItemPresent(
  params: Record<string, string>,
  deps: ProbeDeps,
  fetchedAt: string,
): Promise<ProbeResult> {
  if (!hasExactKeys(params, ['kind', 'client'])) return unreadable(BAD_PARAMS_FACT, fetchedAt)

  const kind = params.kind
  const client = params.client
  if (!COMMENT_TODO_KINDS.has(kind) && kind !== REPLY_SCOPE_KIND) {
    return unreadable('不支持的待办类型', fetchedAt)
  }

  const exists = await deps.clientExists(client)
  if (!exists) return unreadable('客户不存在', fetchedAt)

  if (kind === REPLY_SCOPE_KIND) {
    const todos = await deps.loadReplyScopeTodos()
    const hit = todos.some((t) => t.client_id === client && t.kind === kind)
    if (hit) {
      return {
        outcome: 'passed_needs_human_confirm',
        fact: '现在这个客户会出现「评论回复权限缺失」待办（只证明待办会出现，不证明授权已补好）',
        fetchedAt,
        sample: todos.length,
      }
    }
    return {
      outcome: 'failed',
      fact: '现在这个客户没有「评论回复权限缺失」待办（可能授权已补好，也可能没开评论自动回复）',
      fetchedAt,
      sample: todos.length,
    }
  }

  const run = await deps.loadCommentRun()
  if (run === null) {
    return { outcome: 'not_yet', fact: '评论自动回复任务还没有运行记录', fetchedAt, sample: null }
  }

  const age = daysSince(run.finished_at, deps.now())
  if (age === null || age > COMMENT_RUN_STALE_DAYS) {
    return { outcome: 'not_yet', fact: '最近一轮运行记录太旧', fetchedAt, sample: null }
  }

  const sample = run.results.length
  const r = run.results.find((x) => x.client_id === client)
  if (r === undefined) {
    return { outcome: 'not_yet', fact: '最近一轮没有扫到这个客户', fetchedAt, sample }
  }

  const todo = buildCommentScopeTodo(r)
  if (todo !== null && todo.kind === kind) {
    return {
      outcome: 'passed_needs_human_confirm',
      fact: '最近一轮运行结果里该客户会出现这条待办（只证明待办会出现，不证明授权已修好）',
      fetchedAt,
      sample,
    }
  }

  return {
    outcome: 'failed',
    fact: '最近一轮运行结果里该客户没有这条待办（可能已修好，也可能没触发）',
    fetchedAt,
    sample,
  }
}

function probeLedgerCardStatus(
  params: Record<string, string>,
  deps: ProbeDeps,
  fetchedAt: string,
): ProbeResult {
  if (!hasExactKeys(params, ['id', 'status'])) return unreadable(BAD_PARAMS_FACT, fetchedAt)

  const id = params.id
  const expected = params.status

  const card = deps.loadCard(id)
  if (card === undefined) return unreadable('台账里没有这张卡', fetchedAt)

  if (card.status === expected) {
    return {
      outcome: 'passed_needs_human_confirm',
      fact: `台账卡状态是 ${card.status}`,
      fetchedAt,
      sample: 1,
    }
  }

  if (card.status === 'failed' && expected !== 'failed') {
    return {
      outcome: 'failed',
      fact: `台账卡状态是 failed，不是 ${expected}`,
      fetchedAt,
      sample: 1,
    }
  }

  return {
    outcome: 'not_yet',
    fact: `台账卡状态是 ${card.status}，还没到 ${expected}`,
    fetchedAt,
    sample: 1,
  }
}

/**
 * 执行一条 probe。**永不抛出**：任何取数错误都变成 unreadable。
 *
 * 最高结论是 passed_needs_human_confirm —— 第一步从不叫 verified。
 */
export async function runProbe(probe: ParsedProbe, deps: ProbeDeps): Promise<ProbeResult> {
  let fetchedAt: string
  try {
    fetchedAt = deps.now().toISOString()
  } catch {
    fetchedAt = new Date().toISOString()
  }

  try {
    switch (probe.name) {
      case 'cron_run_ok':
        return await probeCronRunOk(probe.params, deps, fetchedAt)
      case 'todo_item_present':
        return await probeTodoItemPresent(probe.params, deps, fetchedAt)
      case 'ledger_card_status':
        return probeLedgerCardStatus(probe.params, deps, fetchedAt)
      default:
        return unreadable(BAD_PARAMS_FACT, fetchedAt)
    }
  } catch (err) {
    return unreadable(`取数出错：${truncate(errorMessage(err), ERROR_FACT_MAX)}`, fetchedAt)
  }
}
