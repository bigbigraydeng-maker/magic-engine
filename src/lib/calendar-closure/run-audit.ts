/**
 * 日历到期事项每日核对（第一步：只读）的编排层。
 *
 * 把「读日历 -> 读台账 -> 分类 -> 跑 probe -> 出回执」串起来。
 * 除了「非 dry_run 却带了 override 选项」这一条，本函数永不抛出：
 * 读日历/读台账失败都变成 status 不是 ok 的回执。
 *
 * 只读：这里没有任何写路径，回执永远 no_publish / writes_enabled: false。
 */

import { classifyEvents } from './classify'
import type { CalendarReadResult } from './calendar-client'
import { buildLedgerView as defaultBuildLedgerView, type LedgerView } from './ledger-view'
import { parseDescription } from './parse-event'
import { runProbe, type ProbeDeps } from './probes'
import {
  CALENDAR_CLOSURE_JOB,
  CALENDAR_TIMEZONE,
  PM_CALENDAR_ID,
  type AuditReceipt,
  type EventDecision,
  type EventResult,
  type EventResultKind,
  type ProbeOutcome,
} from './types'

export interface AuditDeps {
  now: () => Date
  readEvents: (todayNz: string) => Promise<CalendarReadResult>
  buildLedgerView: (todayNz: string) => LedgerView
  /** probe deps WITHOUT loadCard; the orchestrator supplies loadCard from the ledger view */
  probeDeps: Omit<ProbeDeps, 'loadCard'>
  newRequestId: () => string
}

export interface AuditOptions {
  dryRun: boolean
  source: 'live' | 'fixture'
  /** dry_run only */
  onlyEventId?: string
  /** dry_run only, YYYY-MM-DD: evaluate "as of" this NZ date */
  todayOverride?: string
  /** dry_run only, e.g. 'todo_item_present kind=comment_scope_missing client=abc' */
  probeOverrideLine?: string
}

/** 出错信息截断长度，避免把整段堆栈塞进回执。 */
const ERROR_MAX = 200

const TODAY_OVERRIDE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 新西兰「今天」的日期，`YYYY-MM-DD`。 */
export function nzTodayDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CALENDAR_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}

/** 把 probe 的 outcome 映射成回执里的 kind。 */
function outcomeToKind(outcome: ProbeOutcome): EventResultKind {
  switch (outcome) {
    case 'passed_needs_human_confirm':
      return 'probe_passed'
    case 'failed':
      return 'probe_failed'
    case 'not_yet':
      return 'not_yet'
    case 'unreadable':
      return 'probe_unreadable'
  }
}

/** 非 probe 的 tier 直接映射成 kind，fact 用 decision.reason。 */
function staticResult(decision: EventDecision, kind: EventResultKind): EventResult {
  return {
    ...decision,
    kind,
    fact: decision.reason,
    fetchedAt: null,
    sample: null,
  }
}

function unreadableResult(decision: EventDecision, fact: string): EventResult {
  return {
    ...decision,
    kind: 'probe_unreadable',
    fact,
    fetchedAt: null,
    sample: null,
  }
}

/** 构造一份 status 不是 ok 的回执（读日历/读台账失败）。 */
function failureReceipt(
  deps: AuditDeps,
  opts: AuditOptions,
  todayNz: string,
  status: 'calendar_unreadable' | 'ledger_unreadable',
  error: string,
): AuditReceipt {
  return {
    job: CALENDAR_CLOSURE_JOB,
    request_id: deps.newRequestId(),
    status,
    dry_run: opts.dryRun,
    source: opts.source,
    today_nz: todayNz,
    today_overridden: opts.todayOverride !== undefined,
    not_evidence: opts.dryRun || opts.source === 'fixture',
    calendar_id: PM_CALENDAR_ID,
    candidates: 0,
    processed: 0,
    deferred: 0,
    stale_open: 0,
    results: [],
    error: truncate(error, ERROR_MAX),
    read_proof: null,
    no_publish: true,
    writes_enabled: false,
    created_at: deps.now().toISOString(),
  }
}

export async function runCalendarClosureAudit(
  deps: AuditDeps,
  opts: AuditOptions,
): Promise<AuditReceipt> {
  // (1) override 选项只允许 dry_run
  const hasOverride =
    opts.onlyEventId !== undefined ||
    opts.todayOverride !== undefined ||
    opts.probeOverrideLine !== undefined
  if (!opts.dryRun && hasOverride) {
    throw new Error('override options are dry_run only')
  }
  if (opts.todayOverride !== undefined && !TODAY_OVERRIDE_PATTERN.test(opts.todayOverride)) {
    throw new Error('bad todayOverride')
  }

  // (2) 今天（新西兰）
  const todayNz = opts.todayOverride ?? nzTodayDate(deps.now())

  // (3) 读日历
  let read: CalendarReadResult
  try {
    read = await deps.readEvents(todayNz)
  } catch (err) {
    return failureReceipt(deps, opts, todayNz, 'calendar_unreadable', errorMessage(err))
  }

  // (4) 读台账
  let view: LedgerView
  try {
    view = deps.buildLedgerView(todayNz)
  } catch (err) {
    return failureReceipt(deps, opts, todayNz, 'ledger_unreadable', errorMessage(err))
  }

  // (5) 只留指定事件（dry_run）
  const events =
    opts.onlyEventId === undefined
      ? read.events
      : read.events.filter((event) => event.id === opts.onlyEventId)

  // (6) 分类
  const out = classifyEvents({
    events,
    cards: view.cards,
    coveredLedgerIds: view.coveredLedgerIds,
    todayNz,
  })

  // (7) 逐条出结果
  const probeDeps: ProbeDeps = {
    ...deps.probeDeps,
    loadCard: (id) => view.cards.get(id),
  }

  const results: EventResult[] = []
  for (const decision of out.decisions) {
    if (decision.tier === 'closed') {
      results.push(staticResult(decision, 'closed'))
      continue
    }
    if (decision.tier === 'covered') {
      results.push(staticResult(decision, 'covered'))
      continue
    }
    if (decision.tier === 'no_ledger') {
      results.push(staticResult(decision, 'no_ledger'))
      continue
    }

    // human：默认要人核；只有在 dry_run 同时指定了 onlyEventId + probeOverrideLine 时才当 auto 处理
    const overrideActive =
      opts.probeOverrideLine !== undefined && opts.onlyEventId !== undefined

    if (decision.tier === 'human' && !overrideActive) {
      results.push(staticResult(decision, 'needs_human'))
      continue
    }

    // auto（或 override 情形）：跑 probe
    let probe = decision.probe
    if (overrideActive) {
      const line = `ledger-id: ${decision.ledgerId ?? ''}\nprobe: ${opts.probeOverrideLine ?? ''}`
      const parsed = parseDescription(line)
      if (parsed.probe === null) {
        results.push(
          unreadableResult(decision, `覆盖的 probe 不合格：${parsed.reason ?? '未知'}`),
        )
        continue
      }
      probe = parsed.probe
    }

    if (probe === null) {
      results.push(unreadableResult(decision, '没有可用的 probe'))
      continue
    }

    // 核对参数必须绑定事件自己的台账卡：日历是外部可写数据，不许借自己的 ledger-id 去探测别的卡
    if (probe.name === 'ledger_card_status' && probe.params.id !== decision.ledgerId) {
      results.push(unreadableResult(decision, '核对参数里的台账卡与事件自己的 ledger-id 不一致'))
      continue
    }

    try {
      const r = await runProbe(probe, probeDeps)
      results.push({
        ...decision,
        kind: outcomeToKind(r.outcome),
        fact: r.fact,
        fetchedAt: r.fetchedAt,
        sample: r.sample,
      })
    } catch (err) {
      results.push(unreadableResult(decision, `取数出错：${truncate(errorMessage(err), ERROR_MAX)}`))
    }
  }

  // (8) 回执
  return {
    job: CALENDAR_CLOSURE_JOB,
    request_id: deps.newRequestId(),
    status: 'ok',
    dry_run: opts.dryRun,
    source: opts.source,
    today_nz: todayNz,
    today_overridden: opts.todayOverride !== undefined,
    not_evidence: opts.dryRun || opts.source === 'fixture',
    calendar_id: PM_CALENDAR_ID,
    candidates: out.candidates,
    processed: results.length,
    deferred: out.deferred,
    stale_open: out.staleOpen,
    results,
    error: null,
    read_proof: read.proof,
    no_publish: true,
    writes_enabled: false,
    created_at: deps.now().toISOString(),
  }
}
