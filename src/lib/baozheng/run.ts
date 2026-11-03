/**
 * 包拯每周一轮（规则书 docs/sops/2026-11-03-crm-ai-judgement-review-rules-v1.0.md）。
 *
 * 只读：不写 contacts，不写 contact_stage_events，不改线上判法（R1）。唯一的外部动作是调复核模型（档 1，
 * PM 11-03 回「自动跑」），花费写进运行记录。人的裁定由复核页写进 crm_segment_feedback，不经过这里。
 *
 * 每个客户一份 ClientRunSummary；任何一步读不到就把这个客户记 failed 并写原因，不给默认值。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { QUOTE_EMAIL_ACTOR, STAGE_INFER_ACTOR } from '@/lib/crm/actors'
import { POOL_STAGE, renderTranscript, type TranscriptLine } from '@/lib/crm/stage-from-conversation'
import { computeAccuracy, type ReviewedItem, type Ruling } from './accuracy'
import type { BaozhengClientConfig } from './config'
import {
  hasRewrittenTouchpoints,
  loadClientConfig,
  loadPastReviews,
  loadRulings,
  loadSentMails,
  loadStageEvents,
  loadStageOptions,
  resolveMailIngestedAt,
  type SentMail,
} from './load'
import {
  OBSERVE_DAYS,
  QUOTE_MARKER,
  findBatchEventIds,
  isJudgment,
  judgeOutcome,
  type Outcome,
  type StageEvent,
} from './outcome'
import type { ReviewStageOption } from './prompts'
import { compareStages, isSuspectedMiss, reviewTranscript, type ReviewLlm } from './review'
import { pickRandom, pickStratified } from './sample'
import {
  BAOZHENG_JOB,
  STAGE_JUDGEMENT_KIND,
  type BaozhengRunSummary,
  type ClientRunSummary,
  type OutcomeCounts,
  type ReviewKind,
  type StoredReview,
} from './types'

/** BZ-15：每周下结论的判断最多复核这么多 */
export const WEEKLY_CAP = 20
/** BZ-15：另一个 AI 改过的，每周最多加这么多（单独报，不进准确率） */
export const DISAGREEMENT_CAP = 5
/** BZ-16：每周从「读不出来」里抽这么多查漏判 */
export const POOL_SAMPLE = 5
/** 每个客户每周花在复核模型上的上限；到了就停，剩下的记「没复核」 */
export const WEEKLY_COST_CAP_USD = 2
const LOOKBACK_DAYS = 7
const ACCURACY_LOOKBACK_DAYS = 56
const MS_PER_DAY = 86_400_000

export interface BaozhengDeps {
  db: SupabaseClient
  llm: ReviewLlm
  loadTranscript: (clientId: string, contactId: string, ingestedBefore: string) => Promise<TranscriptLine[]>
  now: () => Date
}

/** 总开关：只有明确写 true 才开（BZ-27，读不到 = 关）。 */
export function isGloballyEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.BAOZHENG_ENABLED === 'true'
}

/** ISO 周编号（UTC），如 2026-W45。同一周重跑抽到同一批。 */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((t.getTime() - yearStart) / MS_PER_DAY + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function emptyOutcomeCounts(): OutcomeCounts {
  return {
    right: 0, wrong: 0, wrong_too_low: 0, dev_fix: 0, ai_disagree: 0,
    unknown_writer: 0, stage_uncategorized: 0, inconclusive: 0, untouched: 0,
  }
}

function inRange(iso: string, startMs: number, endMs: number): boolean {
  const t = Date.parse(iso)
  return !Number.isNaN(t) && t >= startMs && t < endMs
}

function groupByContact(events: readonly StageEvent[]): Map<string, StageEvent[]> {
  const map = new Map<string, StageEvent[]>()
  for (const e of events) {
    const list = map.get(e.contactId)
    if (list) list.push(e)
    else map.set(e.contactId, [e])
  }
  return map
}

interface OutcomeScan {
  counts: OutcomeCounts
  /** 判断编号：决定它的那条是另一个 AI 写的、而且发生在这一周 */
  recentDisagreements: StageEvent[]
}

/** BZ-06～14：全部历史判断按后来的证据分类。 */
export function scanOutcomes(
  judgments: readonly StageEvent[],
  events: readonly StageEvent[],
  config: BaozhengClientConfig,
  mails: readonly SentMail[],
  weekStartMs: number,
  nowMs: number,
): OutcomeScan {
  const byContact = groupByContact(events)
  const batchIds = findBatchEventIds(events, STAGE_INFER_ACTOR, config.humanWriterPrefixes)
  const eventById = new Map(events.map((e) => [e.id, e]))
  const evidence = (e: StageEvent) => (e.changedBy === QUOTE_EMAIL_ACTOR ? resolveMailIngestedAt(e, mails) : null)
  const counts = emptyOutcomeCounts()
  const recentDisagreements: StageEvent[] = []
  for (const j of judgments) {
    const r = judgeOutcome({
      judgment: j,
      events: byContact.get(j.contactId) ?? [],
      config,
      judgeActor: STAGE_INFER_ACTOR,
      batchIds,
      observeDays: OBSERVE_DAYS,
      evidenceIngestedAt: evidence,
    })
    counts[r.outcome] += 1
    const deciding = r.decidingEventId ? eventById.get(r.decidingEventId) : undefined
    if (r.outcome === 'ai_disagree' && deciding && inRange(deciding.createdAt, weekStartMs, nowMs)) {
      recentDisagreements.push(j)
    }
  }
  return { counts, recentDisagreements }
}

interface ReviewTask {
  event: StageEvent
  kind: ReviewKind
  aiStage: string
}

/** BZ-15 / BZ-16：这周复核哪些。 */
export function planReviews(
  events: readonly StageEvent[],
  judgments: readonly StageEvent[],
  recentDisagreements: readonly StageEvent[],
  seedKey: string,
  weekStartMs: number,
  nowMs: number,
): { tasks: ReviewTask[]; poolWrites: number } {
  const lastWeek = judgments.filter((j) => inRange(j.createdAt, weekStartMs, nowMs))
  const byId = new Map(lastWeek.map((j) => [j.id, j]))
  const sample = pickStratified(lastWeek.map((j) => ({ id: j.id, stage: j.toStage })), WEEKLY_CAP, seedKey)
  const tasks: ReviewTask[] = []
  for (const p of sample.picked) {
    const ev = byId.get(p.id)
    if (ev) tasks.push({ event: ev, kind: 'sample', aiStage: ev.toStage })
  }
  const picked = new Set(tasks.map((t) => t.event.id))
  const extra = pickRandom(recentDisagreements.filter((j) => !picked.has(j.id)), DISAGREEMENT_CAP, `${seedKey}:disagree`)
  for (const ev of extra) tasks.push({ event: ev, kind: 'disagreement', aiStage: ev.toStage })

  const poolWritesAll = events.filter(
    (e) => e.changedBy === STAGE_INFER_ACTOR && e.fromStage === null && !(e.note ?? '').includes(QUOTE_MARKER)
      && inRange(e.createdAt, weekStartMs, nowMs),
  )
  const pool = poolWritesAll.filter((e) => e.toStage === POOL_STAGE)
  for (const ev of pickRandom(pool, POOL_SAMPLE, `${seedKey}:pool`)) {
    tasks.push({ event: ev, kind: 'pool', aiStage: POOL_STAGE })
  }
  return { tasks, poolWrites: poolWritesAll.length }
}

function stored(task: ReviewTask, nowIso: string, patch: Pick<StoredReview, 'review_stage' | 'result' | 'reason'>): StoredReview {
  return {
    judgment_id: task.event.id,
    contact_id: task.event.contactId,
    kind: task.kind,
    ai_stage: task.aiStage,
    judged_at: task.event.createdAt,
    reviewed_at: nowIso,
    ...patch,
  }
}

function errText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200)
}

/** BZ-17 / BZ-18：复核一条。读不到 / 调不通都记「没复核」并写原因，不抛。 */
async function reviewOne(
  deps: BaozhengDeps,
  clientId: string,
  task: ReviewTask,
  options: readonly ReviewStageOption[],
  config: BaozhengClientConfig,
  nowIso: string,
): Promise<{ review: StoredReview; costUsd: number }> {
  const skip = (reason: string) => ({ review: stored(task, nowIso, { review_stage: null, result: 'not_reviewed', reason }), costUsd: 0 })
  try {
    const judgedAt = task.event.createdAt
    if (await hasRewrittenTouchpoints(deps.db, clientId, task.event.contactId, judgedAt)) {
      return skip('原文可能被改过')
    }
    const transcript = renderTranscript(await deps.loadTranscript(clientId, task.event.contactId, judgedAt))
    if (transcript.trim().length === 0) return skip('判断那一刻没有已入库的对话')
    const verdict = await reviewTranscript(deps.llm, options, transcript)
    if (verdict.invalid !== undefined) {
      return { review: stored(task, nowIso, { review_stage: null, result: 'not_reviewed', reason: `复核答案不能用：${verdict.invalid}` }), costUsd: verdict.costUsd }
    }
    // 落池的（kind = pool）只问「是不是漏了好客人」：判成深入在谈 / 已成交才算分歧，其余不打扰人（BZ-16）
    const result = task.kind === 'pool'
      ? (verdict.stage === null ? 'review_unclear' : isSuspectedMiss(verdict.stage, config) ? 'disagree' : 'agree')
      : compareStages(task.aiStage, verdict.stage, config)
    return { review: stored(task, nowIso, { review_stage: verdict.stage, result, reason: verdict.reason }), costUsd: verdict.costUsd }
  } catch (e) {
    return skip(`复核失败：${errText(e)}`)
  }
}

/** 同一判断多次复核（同周重跑）只留最新一条。 */
function latestPerJudgment(reviews: readonly StoredReview[]): StoredReview[] {
  const map = new Map<string, StoredReview>()
  for (const r of reviews) {
    const prev = map.get(r.judgment_id)
    if (!prev || Date.parse(r.reviewed_at) >= Date.parse(prev.reviewed_at)) map.set(r.judgment_id, r)
  }
  return Array.from(map.values())
}

function toReviewedItems(reviews: readonly StoredReview[], rulings: ReadonlyMap<string, Ruling>): ReviewedItem[] {
  return latestPerJudgment(reviews)
    .filter((r) => r.kind === 'sample')
    .map((r) => ({ judgmentId: r.judgment_id, stage: r.ai_stage, reviewedAt: r.reviewed_at, result: r.result, ruling: rulings.get(r.judgment_id) ?? null }))
}

function failedClient(clientId: string, reason: string): ClientRunSummary {
  return {
    client_id: clientId, status: 'failed', reason, outcomes: null, pool_writes_last_week: 0,
    reviews: [], accuracy: [], suspected_missed: 0, cost_usd: 0,
  }
}

async function runReviews(
  deps: BaozhengDeps,
  clientId: string,
  tasks: readonly ReviewTask[],
  options: readonly ReviewStageOption[],
  config: BaozhengClientConfig,
  nowIso: string,
): Promise<{ reviews: StoredReview[]; costUsd: number }> {
  const reviews: StoredReview[] = []
  let costUsd = 0
  // 一条一条来：成本可控，到上限就停
  for (const task of tasks) {
    if (costUsd >= WEEKLY_COST_CAP_USD) {
      reviews.push(stored(task, nowIso, { review_stage: null, result: 'not_reviewed', reason: '本周复核花费到上限' }))
      continue
    }
    const r = await reviewOne(deps, clientId, task, options, config, nowIso)
    reviews.push(r.review)
    costUsd += r.costUsd
  }
  return { reviews, costUsd }
}

/**
 * 一个客户的一周。configOverride 只给本地回放 / 当场试跑用（不读、不改客户设置）；定时任务不传。
 */
export async function runClient(
  deps: BaozhengDeps,
  clientId: string,
  week: string,
  configOverride?: BaozhengClientConfig,
): Promise<ClientRunSummary> {
  const now = deps.now()
  const nowMs = now.getTime()
  const nowIso = now.toISOString()
  const weekStartMs = nowMs - LOOKBACK_DAYS * MS_PER_DAY
  try {
    const config = configOverride ?? (await loadClientConfig(deps.db, clientId))
    if (!config.enabled) {
      return { ...failedClient(clientId, '客户设置没开'), status: 'disabled' }
    }
    const options = await loadStageOptions(deps.db, clientId, config)
    if (options.length === 0) return failedClient(clientId, '阶段没归类')
    const events = await loadStageEvents(deps.db, clientId)
    const judgments = events.filter((e) => isJudgment(e, STAGE_INFER_ACTOR))
    const quoteContacts = Array.from(new Set(events.filter((e) => e.changedBy === QUOTE_EMAIL_ACTOR).map((e) => e.contactId)))
    const mails = await loadSentMails(deps.db, clientId, quoteContacts)
    const scan = scanOutcomes(judgments, events, config, mails, weekStartMs, nowMs)
    const plan = planReviews(events, judgments, scan.recentDisagreements, `${clientId}:${week}`, weekStartMs, nowMs)
    const done = await runReviews(deps, clientId, plan.tasks, options, config, nowIso)

    const sinceIso = new Date(nowMs - ACCURACY_LOOKBACK_DAYS * MS_PER_DAY).toISOString()
    const past = await loadPastReviews(deps.db, BAOZHENG_JOB, clientId, sinceIso)
    const rulings = await loadRulings(deps.db, clientId)
    const accuracy = computeAccuracy(toReviewedItems([...past, ...done.reviews], rulings), nowMs)
    const suspected = done.reviews.filter((r) => r.kind === 'pool' && isSuspectedMiss(r.review_stage, config)).length
    return {
      client_id: clientId, status: 'reviewed', reason: null, outcomes: scan.counts,
      pool_writes_last_week: plan.poolWrites, reviews: done.reviews, accuracy, suspected_missed: suspected, cost_usd: done.costUsd,
    }
  } catch (e) {
    return failedClient(clientId, `读库失败：${errText(e)}`)
  }
}

/** 哪些客户在客户设置里开了包拯（BZ-27）。读失败抛给调用方，整轮记失败。 */
export async function listEnabledClients(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db.from('clients').select('id').eq('leads_config->baozheng->>enabled', 'true')
  if (error) throw new Error(`读客户设置失败: ${error.message}`)
  return ((data ?? []) as { id: string }[]).map((r) => r.id)
}

/** 把各客户结果合成运行记录 summary 的五键 + 明细。 */
export function buildRunSummary(week: string, clients: readonly ClientRunSummary[], reasons: readonly string[]): BaozhengRunSummary {
  const reviews = clients.flatMap((c) => c.reviews)
  const reasonSet = new Set(reasons)
  for (const c of clients) if (c.reason) reasonSet.add(c.reason)
  for (const r of reviews) if (r.result === 'not_reviewed' && r.reason) reasonSet.add(r.reason)
  return {
    agent: 'baozheng',
    judgement_kind: STAGE_JUDGEMENT_KIND,
    week,
    produced: reviews.filter((r) => r.result !== 'not_reviewed').length,
    undeterminable: reviews.filter((r) => r.result === 'not_reviewed' || r.result === 'review_unclear').length,
    reasons: Array.from(reasonSet),
    cost_usd: clients.reduce((s, c) => s + c.cost_usd, 0),
    no_publish: true,
    clients: [...clients],
  }
}

/** outcome 种类全集：给测试和体检核「一个都没漏」。 */
export const OUTCOME_KINDS: readonly Outcome[] = Object.keys(emptyOutcomeCounts()) as Outcome[]
