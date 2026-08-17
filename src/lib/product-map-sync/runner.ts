/**
 * 同步执行器:full(cron/manual 全量对账)与 targeted(webhook 单号码)两种模式。
 *
 * last-known-good 语义:抓取失败/限流未尝试的号码不进 commit 参数(旧行原样保留),
 * 只记 stats.failedItems;限流中止时**已抓到的照常落库**(provider 的限流契约保证
 * 成果不丢),run 标 partial。单调守卫在 RPC 内,这里只汇总 skippedStale。
 *
 * 未分类收编 = 显式确认制:对存量未分类行逐个复核(closed 或已分类才进 resolve
 * 名单),绝不做「本轮没扫到 = 已收编」的反推。
 */

import { PRODUCT_MAP_COMPONENTS } from '@/lib/product-map'
import { extractComponentMarkers, isUnclassified } from './marker'
import type { GithubReadProvider } from './provider'
import type { ProductMapSyncStore } from './store'
import type {
  IssueFactRow,
  PrFactDetail,
  PrFactRow,
  SyncMode,
  SyncRunRow,
  SyncStats,
  SyncTrigger,
} from './types'
import { NotProvisionedError } from './types'

const DELIVERY_RETENTION_DAYS = 90
const UNCLASSIFIED_SCAN_DAYS = 30

export interface SyncRunResult {
  readonly runId: string
  readonly status: SyncRunRow['status']
  readonly stats: SyncStats
}

interface RunnerDeps {
  readonly provider: GithubReadProvider
  readonly store: ProductMapSyncStore
  readonly newRunId: () => string
  readonly now: () => string
}

function registryPrNumbers(): Set<number> {
  const set = new Set<number>()
  for (const c of PRODUCT_MAP_COMPONENTS) for (const pr of c.linkedPullRequests) set.add(pr.number)
  return set
}

function registryIssueNumbers(): Set<number> {
  const set = new Set<number>()
  for (const c of PRODUCT_MAP_COMPONENTS) for (const n of c.linkedIssues) set.add(n)
  return set
}

function toPrRow(f: PrFactDetail): Omit<PrFactRow, 'sync_run_id'> {
  return {
    pr_number: f.number,
    state: f.state,
    is_draft: f.isDraft,
    base_ref: f.baseRef,
    head_sha: f.headSha,
    merged_commit_sha: f.mergedCommitSha,
    mergeable_state: f.mergeableState,
    unresolved_threads: f.unresolvedThreads,
    checks: { sha: f.headSha, checks: f.checks, truncated: f.checksTruncated },
    changed_files: f.changedFiles,
    changed_files_truncated: f.changedFilesTruncated,
    title: f.title,
    observed_at: f.observedAt,
  }
}

export async function runFullSync(
  deps: RunnerDeps,
  trigger: Extract<SyncTrigger, 'cron' | 'manual'>,
): Promise<SyncRunResult> {
  const runId = deps.newRunId()
  const startedAt = deps.now()
  const failedItems: string[] = []
  const truncations: string[] = []
  const threadsFailures: string[] = []
  let partial = false

  // 已 merged 且有 merged_commit_sha 的 PR 事实基本冻结 —— 不重抓,省限流配额。
  // 但 unresolved_threads=null 是"抓取失败(限流)"而非"确实没有意见":把这类事故遗留行
  // 当不可变,会永久锁死那个空值 —— full sync 既不重试 GraphQL、也不为它生成 threadsFailures,
  // 甚至可能把整轮误标 ok,恰恰违背本 PR"每个 null 都要说得出原因"的契约。故只有 threads
  // 已有可信值(非 null)时才算不可变;事故遗留的 null 行照常重抓,拿到真值或如实报原因。
  const existing = await deps.store.readPrFacts()
  const immutable = new Set(
    existing
      .filter((r) => r.state === 'merged' && r.merged_commit_sha && r.unresolved_threads !== null)
      .map((r) => r.pr_number),
  )
  const prNumbers = Array.from(registryPrNumbers()).filter((n) => !immutable.has(n))
  const issueNumbers = Array.from(registryIssueNumbers())

  let mainHeadSha: string | null = null
  let prFacts: PrFactDetail[] = []
  let issueRows: Omit<IssueFactRow, 'sync_run_id'>[] = []
  const unclassified: { kind: 'pr' | 'issue'; number: number; title: string; url: string; opened_at: string }[] = []
  const resolve: { kind: 'pr' | 'issue'; number: number }[] = []

  try {
    mainHeadSha = (await deps.provider.getMainHead()).sha

    const prResult = await deps.provider.getPullRequestFacts(prNumbers)
    prFacts = prResult.facts
    for (const f of prResult.failed) failedItems.push(`pr#${f.number}: ${f.reason}`)
    if (prResult.rateLimited) partial = true
    // threads 抓不到 → partial,且每个 null 都要在 stats 里留下说得出口的原因
    for (const f of prFacts.filter((x) => x.unresolvedThreads === null)) {
      partial = true
      threadsFailures.push(`pr#${f.number}: ${f.unresolvedThreadsError ?? '原因未记录(provider 违反契约)'}`)
    }
    for (const f of prFacts.filter((x) => x.changedFilesTruncated)) {
      truncations.push(`pr#${f.number}: changed_files 截断至上限`)
    }
    for (const f of prFacts.filter((x) => x.checksTruncated)) {
      truncations.push(`pr#${f.number}: checks 只取第一页`)
    }

    const issueResult = await deps.provider.getIssueFacts(issueNumbers)
    issueRows = issueResult.facts.map((f) => ({
      issue_number: f.number,
      state: f.state,
      title: f.title,
      updated_at: f.updatedAt,
      observed_at: f.observedAt,
    }))
    for (const f of issueResult.failed) failedItems.push(`issue#${f.number}: ${f.reason}`)
    if (issueResult.rateLimited) partial = true

    // 未分类发现(只在 full 轮):确定性关联,不猜
    const since = new Date(Date.now() - UNCLASSIFIED_SCAN_DAYS * 24 * 3600_000).toISOString()
    const recent = await deps.provider.listRecentWork(since)
    if (recent.truncated) truncations.push('listRecentWork: 分页截断')
    const componentIds = new Set(PRODUCT_MAP_COMPONENTS.map((c) => c.id))
    const linkedPrs = registryPrNumbers()
    const linkedIssues = registryIssueNumbers()
    for (const item of recent.items) {
      const un = isUnclassified({
        kind: item.kind,
        number: item.number,
        body: item.body,
        registryComponentIds: componentIds,
        linkedPrNumbers: linkedPrs,
        linkedIssueNumbers: linkedIssues,
      })
      if (un) {
        unclassified.push({
          kind: item.kind,
          number: item.number,
          title: item.title,
          url: item.url,
          opened_at: item.openedAt,
        })
      }
    }

    // 存量未分类复核 → 收编名单(显式确认制)。复核本身限流 → 本轮不收编,不误消。
    const backlog = (await deps.store.readUnclassified()).filter(
      (row) => !unclassified.some((u) => u.kind === row.kind && u.number === row.number),
    )
    if (backlog.length > 0) {
      const states = await deps.provider.getWorkItemStates(backlog.map((b) => b.number))
      if (states.rateLimited) partial = true
      for (const b of backlog) {
        const state = states.facts.find((s) => s.number === b.number)
        if (!state) continue // 复核失败/未尝试 → 留在队列,下轮再看
        const nowLinked =
          (b.kind === 'pr' ? linkedPrs.has(b.number) : linkedIssues.has(b.number)) ||
          extractComponentMarkers(state.body).some((id) => componentIds.has(id))
        if (state.state === 'closed' || nowLinked) {
          resolve.push({ kind: b.kind, number: b.number })
        }
      }
    }
  } catch (err) {
    // 到这里的只剩「批量契约之外」的失败(getMainHead / store 读)—— 整轮 error
    return commitErrorRun(deps, runId, trigger, 'full', startedAt, err, {
      failedItems,
      truncations,
      threadsFailures,
    })
  }

  if (failedItems.length > 0) partial = true

  // webhook error 汇总窗口 = 上一次 full 轮以来(不是今天零点 —— 那会留永久盲区)
  const lastFull = await deps.store.lastFullRunStartedAt()
  const since = lastFull ?? new Date(Date.now() - 24 * 3600_000).toISOString()
  const webhookErrorRuns = await deps.store.countWebhookErrorRunsSince(since)
  const pruned = await deps.store.pruneDeliveriesBefore(
    new Date(Date.now() - DELIVERY_RETENTION_DAYS * 24 * 3600_000).toISOString(),
  )

  const stats: SyncStats = {
    prsSynced: prFacts.length,
    issuesSynced: issueRows.length,
    unclassifiedSeen: unclassified.length,
    failedItems,
    skippedStale: 0,
    truncations,
    threadsFailures,
    webhookErrorRunsSinceLastFull: webhookErrorRuns,
    deliveriesPruned: pruned,
  }
  const status = partial ? 'partial' : 'ok'
  const { skippedStale } = await deps.store.commitSync({
    run: {
      id: runId,
      trigger,
      mode: 'full',
      status,
      main_head_sha: mainHeadSha,
      started_at: startedAt,
      finished_at: deps.now(),
      stats,
      error_message: null,
    },
    prFacts: prFacts.map(toPrRow),
    issueFacts: issueRows,
    unclassified,
    resolve,
    mode: 'full',
  })
  return { runId, status, stats: { ...stats, skippedStale } }
}

/**
 * webhook 触发:单号码硬预算。
 * 非登记册号码返回 null(不建 run、不落 facts)—— 孤儿行会把快照的 min 鲜度
 * 钉死在远古,而且 full 轮永远不会刷新它们;未分类发现是 cron 的活。
 */
export async function runTargetedSync(
  deps: RunnerDeps,
  target: { kind: 'pr' | 'issue'; number: number },
): Promise<SyncRunResult | null> {
  const linked =
    target.kind === 'pr'
      ? registryPrNumbers().has(target.number)
      : registryIssueNumbers().has(target.number)
  if (!linked) return null

  const runId = deps.newRunId()
  const startedAt = deps.now()

  try {
    let prRows: Omit<PrFactRow, 'sync_run_id'>[] = []
    let issueRows: Omit<IssueFactRow, 'sync_run_id'>[] = []
    const failedItems: string[] = []
    const threadsFailures: string[] = []
    let partial = false

    if (target.kind === 'pr') {
      const r = await deps.provider.getPullRequestFacts([target.number])
      prRows = r.facts.map(toPrRow)
      for (const f of r.failed) failedItems.push(`pr#${f.number}: ${f.reason}`)
      // GraphQL 失败(threads null)同 full 轮口径 → partial + 原因入账
      if (r.rateLimited) partial = true
      for (const f of r.facts.filter((x) => x.unresolvedThreads === null)) {
        partial = true
        threadsFailures.push(`pr#${f.number}: ${f.unresolvedThreadsError ?? '原因未记录(provider 违反契约)'}`)
      }
    } else {
      const r = await deps.provider.getIssueFacts([target.number])
      issueRows = r.facts.map((f) => ({
        issue_number: f.number,
        state: f.state,
        title: f.title,
        updated_at: f.updatedAt,
        observed_at: f.observedAt,
      }))
      for (const f of r.failed) failedItems.push(`issue#${f.number}: ${f.reason}`)
      if (r.rateLimited) partial = true
    }

    const status = failedItems.length > 0 || partial ? 'partial' : 'ok'
    const stats: SyncStats = {
      prsSynced: prRows.length,
      issuesSynced: issueRows.length,
      unclassifiedSeen: 0,
      failedItems,
      skippedStale: 0,
      truncations: [],
      threadsFailures,
    }
    const { skippedStale } = await deps.store.commitSync({
      run: {
        id: runId,
        trigger: 'webhook',
        mode: 'targeted',
        status,
        main_head_sha: null,
        started_at: startedAt,
        finished_at: deps.now(),
        stats,
        error_message: null,
      },
      prFacts: prRows,
      issueFacts: issueRows,
      unclassified: [],
      resolve: [],
      mode: 'targeted',
    })
    return { runId, status, stats: { ...stats, skippedStale } }
  } catch (err) {
    return commitErrorRun(deps, runId, 'webhook', 'targeted', startedAt, err, {
      failedItems: [],
      truncations: [],
      threadsFailures: [],
    })
  }
}

async function commitErrorRun(
  deps: RunnerDeps,
  runId: string,
  trigger: SyncTrigger,
  mode: SyncMode,
  startedAt: string,
  err: unknown,
  partialStats: { failedItems: string[]; truncations: string[]; threadsFailures: string[] },
): Promise<SyncRunResult> {
  // 环境性错误(表未 apply)原样上抛 —— route 层要据此回 not_provisioned,
  // 包成普通 error run 会把「待 provision」和「同步坏了」混成一种
  if (err instanceof NotProvisionedError) throw err
  const message = err instanceof Error ? err.message : String(err)
  const stats: SyncStats = {
    prsSynced: 0,
    issuesSynced: 0,
    unclassifiedSeen: 0,
    failedItems: partialStats.failedItems,
    skippedStale: 0,
    truncations: partialStats.truncations,
    threadsFailures: partialStats.threadsFailures,
  }
  // error run 也要留痕(空 facts,不清任何旧数据)—— 失败不许静默。
  // store 本身也炸时不许吞掉原始错误:两个都进返回的 stats。
  try {
    await deps.store.commitSync({
      run: {
        id: runId,
        trigger,
        mode,
        status: 'error',
        main_head_sha: null,
        started_at: startedAt,
        finished_at: deps.now(),
        stats,
        error_message: message,
      },
      prFacts: [],
      issueFacts: [],
      unclassified: [],
      resolve: [],
      mode,
    })
  } catch (storeErr) {
    const storeMessage = storeErr instanceof Error ? storeErr.message : String(storeErr)
    return {
      runId,
      status: 'error',
      stats: { ...stats, failedItems: [...stats.failedItems, `原始错误:${message}`, `台账写入也失败:${storeMessage}`] },
    }
  }
  return { runId, status: 'error', stats: { ...stats, failedItems: [...stats.failedItems, message] } }
}
