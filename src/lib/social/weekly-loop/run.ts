import type { FactItem } from './fact-check'
import { checkFacts } from './fact-check'
import type { SocialFactSource } from './fact-aliases'
import { groupVersions, type VersionRow } from './version-groups'
import { planReelSchedule, type ScheduleCandidate, type ScheduledItem } from './schedule'
import type { WriteReelScheduleArgs, WriteReelScheduleResult } from './schedule-writer'
import { synthesizeWeeklyRecipe } from '@/lib/social/recipe/synthesize'
import type { StageSignals } from '@/lib/social/recipe/stage'
import { isoDate, nzCalendar, targetWeek } from '@/lib/social/week-pack/cadence'
import { readApprovedAt, readPublishOn, reelTitle, selectReels, type ReelInput } from '@/lib/social/week-pack/manifest'
import { toPublishedView } from '@/lib/factory/publish/publish-display'
import { isAssetOnly } from '@/lib/factory/deliverable'
import { buildReelFirstComment, buildReelPostCaption } from '@/lib/social/reel-publishing'
import { APP_BASE } from '@/lib/pm-todo/binding-request-items'
import { CONSENT_REASON_ZH, consentVerdict } from '@/lib/factory/talent-consent'

/** cron_run_logs.job_name for every receipt of the weekly loop (daily fan-out and per-client runs). */
export const WEEKLY_LOOP_JOB = 'social-weekly-draft'

export type WeeklyLoopMode = 'dry_run' | 'write'

export interface WeeklyLoopOrderRow {
  id: string
  status: string
  created_at: string
  updated_at: string
  angle: unknown
  brief: unknown
  output: unknown
  review_ref: unknown
  published_ref: unknown
}

export interface WeeklyLoopClient {
  id: string
  name: string
  industry: string | null
  config: unknown // clients.publishing_calendar_config
}

export interface FactCheckRecord {
  catalog_version: number
  checked_at: string
  verdict: 'pass' | 'fail' | 'needs_human'
  items: FactItem[]
}

export type FactCheckWriteOutcome = 'written' | 'conflict' | 'failed'

export interface WeeklyLoopDeps {
  loadClient(clientId: string): Promise<WeeklyLoopClient | null>
  loadOrders(clientId: string): Promise<{ rows: WeeklyLoopOrderRow[]; truncated: boolean }>
  loadFactSource(clientId: string, today: string): Promise<SocialFactSource>
  /** Writes only `output` (with fact_check merged in) and updated_at, guarded by the read updated_at. */
  writeFactCheck(input: { clientId: string; id: string; readUpdatedAt: string; output: Record<string, unknown> }): Promise<FactCheckWriteOutcome>
  writeSchedule(args: WriteReelScheduleArgs): Promise<WriteReelScheduleResult>
}

export type WeeklyLoopTaskCode =
  | 'zero_eligible'
  | 'all_filtered'
  | 'fact_source_unreadable'
  | 'unreviewed_by_maliang'
  | 'run_incomplete'
  | 'consent_blocked'

export interface WeeklyLoopManualTask {
  code: WeeklyLoopTaskCode
  what: string
  how: string
  href: string
}

export type MaliangState = 'pass' | 'fail' | 'unverifiable' | 'missing'

export interface WeeklyLoopItem {
  id: string
  title: string
  fact_verdict: 'pass' | 'fail' | 'needs_human' | null
  maliang: MaliangState
  questions: string[]
  product_key: string | null
  excluded_reason: string | null
}

export interface WeeklyLoopCounts {
  orders_read: number
  in_review: number
  candidates: number
  groups: number
  ambiguous: number
  superseded: number
  fact_pass: number
  fact_fail: number
  fact_needs_human: number
  unreviewed: number
  maliang_fail: number
  consent_blocked: number
  eligible: number
  already_scheduled: number
  scheduled: number
  skipped_by_reason: Record<string, number>
}

export interface WeeklyLoopReceipt {
  kind: 'client_run'
  client_id: string
  mode: WeeklyLoopMode
  status: 'completed' | 'stopped'
  stop_reason: string | null
  week_start: string
  week_end: string
  catalog_version: number | null
  truncated: boolean
  reel_per_week: number
  recipe_stage: string | null
  defaulted_stage_signals: string[]
  counts: WeeklyLoopCounts
  items: WeeklyLoopItem[]
  scheduled: Array<{ id: string; publishOn: string }>
  fact_check_writes: { written: number; conflict: number; failed: number }
  manual_tasks: WeeklyLoopManualTask[]
  /** true only in write mode: the to-do reader only shows tasks from write-mode receipts. */
  manual_tasks_delivered: boolean
  no_publish: true
  errors: string[]
}

export interface RunWeeklyLoopInput {
  clientId: string
  now: Date
  mode: WeeklyLoopMode
}

/** Stage signals this loop cannot compute yet. They get conservative values (starting stage, never paused). */
export const DEFAULTED_STAGE_SIGNALS = [
  'hasPublishAuth',
  'consecutiveOnTimeWeeks',
  'receiptsPerFormatMax',
  'consecutivePeriodsAtThreshold',
  'circuitBreakerTripped',
  'complaintSpike',
] as const

// ---------- small helpers ----------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function overlayOf(output: unknown): string | null {
  if (!isRecord(output)) return null
  const caption = output.caption
  if (typeof caption !== 'string') return null
  const trimmed = caption.trim()
  return trimmed ? trimmed : null
}

function copyOf(brief: unknown): Record<string, unknown> {
  if (!isRecord(brief)) return {}
  const copy = brief.copy
  return isRecord(copy) ? copy : {}
}

function endcardOf(copy: Record<string, unknown>): Record<string, unknown> {
  const endcard = copy.endcard
  return isRecord(endcard) ? endcard : {}
}

function linkUrlOf(endcard: Record<string, unknown>): string | null {
  const url = endcard.url
  return typeof url === 'string' && url.trim() ? url : null
}

export function readMaliang(output: unknown): { state: MaliangState; questions: string[] } {
  if (!isRecord(output)) return { state: 'missing', questions: [] }
  const check = output.maliang_check
  if (!isRecord(check)) return { state: 'missing', questions: [] }
  const status = check.status
  const state: MaliangState =
    status === 'pass' || status === 'fail' || status === 'unverifiable' ? status : 'missing'
  const rawQuestions = check.questions
  const questions = Array.isArray(rawQuestions)
    ? rawQuestions.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    : []
  return { state, questions }
}

function emptyCounts(): WeeklyLoopCounts {
  return {
    orders_read: 0,
    in_review: 0,
    candidates: 0,
    groups: 0,
    ambiguous: 0,
    superseded: 0,
    fact_pass: 0,
    fact_fail: 0,
    fact_needs_human: 0,
    unreviewed: 0,
    maliang_fail: 0,
    consent_blocked: 0,
    eligible: 0,
    already_scheduled: 0,
    scheduled: 0,
    skipped_by_reason: {},
  }
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1
}

function taskHref(clientId: string, page: 'content-factory' | 'tour-catalog'): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/${page}`
}

// ---------- step 1: row -> reel input ----------

function toReelInput(row: WeeklyLoopOrderRow): ReelInput {
  return {
    id: row.id,
    status: row.status,
    video_state: toPublishedView(row.published_ref)?.video_state ?? null,
    approved_at: readApprovedAt(row.review_ref),
    publish_on: readPublishOn(row.brief),
    fingerprint: null,
    title: reelTitle(row.angle),
    asset_only: isAssetOnly(row.brief),
  }
}

// ---------- step 2: select candidates ----------

interface Candidate {
  row: WeeklyLoopOrderRow
  scheduledOn: string | null
}

function selectCandidates(
  rows: WeeklyLoopOrderRow[],
  weekStart: string,
  weekEnd: string,
  items: WeeklyLoopItem[],
  counts: WeeklyLoopCounts,
): Candidate[] {
  counts.orders_read = rows.length
  const byId = new Map<string, WeeklyLoopOrderRow>()
  const inputs: ReelInput[] = []
  for (const row of rows) {
    if (row.status === 'in_review') {
      counts.in_review += 1
      continue
    }
    byId.set(row.id, row)
    inputs.push(toReelInput(row))
  }
  const selected = selectReels(inputs, weekStart, weekEnd)
  const candidates: Candidate[] = []
  for (const reel of selected) {
    const row = byId.get(reel.work_order_id)
    if (!row) continue
    if (reel.date_state === 'invalid' || reel.date_state === 'unverified') {
      const reason = reel.date_state === 'invalid' ? 'date_invalid' : 'publish_state_unverified'
      const maliang = readMaliang(row.output)
      items.push({
        id: row.id,
        title: reelTitle(row.angle),
        fact_verdict: null,
        maliang: maliang.state,
        questions: maliang.questions,
        product_key: null,
        excluded_reason: reason,
      })
      bump(counts.skipped_by_reason, reason)
      continue
    }
    candidates.push({ row, scheduledOn: reel.scheduled_at_iso })
  }
  counts.candidates = candidates.length
  return candidates
}

// ---------- step 3: keep latest versions ----------

function keepLatestVersions(
  candidates: Candidate[],
  items: WeeklyLoopItem[],
  counts: WeeklyLoopCounts,
): Candidate[] {
  const versionRows: VersionRow[] = candidates.map((c) => ({
    id: c.row.id,
    created_at: c.row.created_at,
    brief: c.row.brief,
    overlay: overlayOf(c.row.output),
  }))
  const { groups, ambiguous } = groupVersions(versionRows)
  counts.groups = groups.length
  const ambiguousIds = new Set<string>()
  for (const entry of ambiguous) {
    for (const id of entry.ids) ambiguousIds.add(id)
  }
  counts.ambiguous = ambiguousIds.size
  const latestIds = new Set<string>()
  for (const group of groups) latestIds.add(group.latestId)

  const kept: Candidate[] = []
  for (const c of candidates) {
    if (ambiguousIds.has(c.row.id)) {
      pushExcluded(items, c.row, 'ambiguous_version')
      bump(counts.skipped_by_reason, 'ambiguous_version')
      continue
    }
    if (!latestIds.has(c.row.id)) {
      pushExcluded(items, c.row, 'superseded')
      counts.superseded += 1
      bump(counts.skipped_by_reason, 'superseded')
      continue
    }
    kept.push(c)
  }
  return kept
}

function pushExcluded(items: WeeklyLoopItem[], row: WeeklyLoopOrderRow, reason: string): void {
  const maliang = readMaliang(row.output)
  items.push({
    id: row.id,
    title: reelTitle(row.angle),
    fact_verdict: null,
    maliang: maliang.state,
    questions: maliang.questions,
    product_key: null,
    excluded_reason: reason,
  })
}

// ---------- step 4: fact check one ----------

type OkSource = Extract<SocialFactSource, { ok: true }>

function checkOne(c: Candidate, source: OkSource, today: string) {
  const copy = copyOf(c.row.brief)
  const endcard = endcardOf(copy)
  const firstComment = buildReelFirstComment(endcard, c.row.id)
  const fact = checkFacts({
    texts: {
      overlay: overlayOf(c.row.output),
      caption: buildReelPostCaption(copy),
      firstComment: firstComment?.text ?? null,
    },
    linkUrl: linkUrlOf(endcard),
    tours: source.tours,
    aliasesByTourId: source.aliasesByTourId,
    catalogVersion: source.catalogVersion,
    today,
  })
  const maliang = readMaliang(c.row.output)
  return { fact, maliang }
}

// ---------- step 5: exclusion ----------

function exclusionOf(verdict: 'pass' | 'fail' | 'needs_human', maliang: MaliangState): string | null {
  if (maliang === 'missing') return 'unreviewed'
  if (maliang !== 'pass') return 'maliang_fail'
  if (verdict === 'fail') return 'fact_fail'
  if (verdict === 'needs_human') return 'fact_needs_human'
  return null
}

// ---------- step 6: review kept ----------

interface Reviewed {
  c: Candidate
  fact: ReturnType<typeof checkFacts>
  productKey: string | null
  excluded: string | null
}

function reviewKept(
  kept: Candidate[],
  source: OkSource,
  today: string,
  items: WeeklyLoopItem[],
  counts: WeeklyLoopCounts,
): Reviewed[] {
  const reviewed: Reviewed[] = []
  for (const c of kept) {
    const { fact, maliang } = checkOne(c, source, today)
    if (fact.verdict === 'pass') counts.fact_pass += 1
    else if (fact.verdict === 'fail') counts.fact_fail += 1
    else counts.fact_needs_human += 1
    if (maliang.state === 'missing') counts.unreviewed += 1
    if (maliang.state === 'fail' || maliang.state === 'unverifiable') counts.maliang_fail += 1
    const productKey = fact.targetTourId
    const consent = consentVerdict({ brief: c.row.brief, output: c.row.output, use: 'facebook_organic' })
    const excluded = exclusionOf(fact.verdict, maliang.state) ?? (consent.ok ? null : consent.reason)
    if (!consent.ok && excluded === consent.reason) counts.consent_blocked += 1
    items.push({
      id: c.row.id,
      title: reelTitle(c.row.angle),
      fact_verdict: fact.verdict,
      maliang: maliang.state,
      questions: maliang.questions,
      product_key: productKey,
      excluded_reason: excluded,
    })
    if (excluded) bump(counts.skipped_by_reason, excluded)
    reviewed.push({ c, fact, productKey, excluded })
  }
  counts.eligible = reviewed.filter((r) => r.excluded === null).length
  return reviewed
}

// ---------- step 7: reel quota ----------

function reelQuota(
  client: WeeklyLoopClient,
  factCount: number,
  eligibleCount: number,
): { reelPerWeek: number; stage: string | null } {
  const signals = {
    platform: 'facebook',
    hasPublishAuth: false,
    factCount,
    verifiedAssetCount: eligibleCount,
    consecutiveOnTimeWeeks: 0,
    receiptsPerFormatMax: 0,
    consecutivePeriodsAtThreshold: 0,
    circuitBreakerTripped: false,
    complaintSpike: false,
  } satisfies StageSignals
  const quota = isRecord(client.config) && isRecord(client.config.quota) ? client.config.quota : null
  const clientConfig = {
    quota:
      quota === null
        ? null
        : { reel_per_week: typeof quota.reel_per_week === 'number' ? quota.reel_per_week : null },
    content_pillars: null,
  }
  const recipe = synthesizeWeeklyRecipe({
    platform: 'facebook',
    industryKey: client.industry,
    stageSignals: signals,
    clientConfig,
  })
  if (recipe.status !== 'ready') return { reelPerWeek: 0, stage: null }
  if (recipe.holdNewDrafts) return { reelPerWeek: 0, stage: recipe.stage }
  return { reelPerWeek: recipe.quotas.reelPerWeek ?? 0, stage: recipe.stage }
}

// ---------- step 8: manual tasks ----------

/** Plain-language labels for the to-do text. Unknown codes fall back to the code itself. */
const REASON_ZH: Record<string, string> = {
  ...CONSENT_REASON_ZH,
  unreviewed: '马良还没审',
  maliang_fail: '马良没过',
  fact_fail: '和团目录对不上',
  fact_needs_human: '要人核对事实',
  superseded: '有更新的版本',
  ambiguous_version: '分不清是不是同一条的新旧版本',
  date_invalid: '排期日期写错了',
  publish_state_unverified: '看不出是否已经公开',
  over_quota: '超过每周名额',
  product_adjacent: '同一个团不能连着发',
  fact_check_not_persisted: '事实核对结果没存上',
}

function buildTasks(
  clientId: string,
  counts: WeeklyLoopCounts,
  stopReason: string | null,
): WeeklyLoopManualTask[] {
  if (stopReason && stopReason.startsWith('fact_source_unreadable')) {
    return [
      {
        code: 'fact_source_unreadable',
        what: `这周的社媒视频没法排：读不到团目录的已发布版本（${stopReason}），程序没法核对视频里的天数、价格、团名，所以一条都没排。`,
        how: '打开团目录，确认目录已经发布过且里面有在售的团；发布后下次出稿日会自动重跑。读得到却还报这条，找开发看。',
        href: taskHref(clientId, 'tour-catalog'),
      },
    ]
  }
  const tasks: WeeklyLoopManualTask[] = []
  if (counts.unreviewed > 0) {
    tasks.push({
      code: 'unreviewed_by_maliang',
      what: `有 ${counts.unreviewed} 条审过的视频还没有马良的审片记录，这周不会进卡。`,
      how: '和团目录对得上的那几条，程序写库模式下每个出稿日会请马良补审（每周有花费上限，没轮到的下次继续）；对不上目录的不会补审，要先改字幕或文案。这条待办下次出稿还在 = 补审没开或没补上，打开内容工厂看这几条视频能不能正常播放，打不开的请重新出片。',
      href: taskHref(clientId, 'content-factory'),
    })
  }
  if (counts.consent_blocked > 0) {
    tasks.push({
      code: 'consent_blocked',
      what: `有 ${counts.consent_blocked} 条视频里可能有能认出来的真人，但没有登记好出镜授权，这周不会进卡、也不能转公开。`,
      how: '打开内容工厂找到这几条：问客户要到出镜授权后，在成片登记里补上授权记录（谁同意、同意用在哪里、凭什么）；片里其实没有能认出的人的，找开发核对马良的结论。',
      href: taskHref(clientId, 'content-factory'),
    })
  }
  if (counts.candidates === 0) {
    tasks.push({
      code: 'zero_eligible',
      what: '这周没有审过、还是草稿的视频可排，下周的卡会是空的。',
      how: '打开内容工厂，出几条新视频并审过；审过的草稿下个出稿日会自动排进去。',
      href: taskHref(clientId, 'content-factory'),
    })
  } else if (counts.eligible === 0) {
    const list = Object.entries(counts.skipped_by_reason)
      .map(([reason, count]) => `${REASON_ZH[reason] ?? reason} ${count} 条`)
      .join('、')
    tasks.push({
      code: 'all_filtered',
      what: `这周有 ${counts.candidates} 条候选视频，全部被刷掉了，下周的卡会是空的。（${list}）`,
      how: '打开内容工厂，按原因逐条处理：对不上目录的改字幕或文案，马良没过的重新出片；改好后下个出稿日会自动重跑。',
      href: taskHref(clientId, 'content-factory'),
    })
  }
  return tasks
}

/** Schedule-writer skip reasons that mean a check or a write broke (not a content decision). */
export const ERROR_SKIP_REASONS: readonly string[] = ['card_check_failed', 'promote_check_failed', 'write_failed']

export interface IncompleteSource {
  errors?: readonly string[]
  fact_check_writes?: { failed: number }
  counts?: { skipped_by_reason: Record<string, number> }
}

/** Why this run did not finish its job. Empty = nothing broke. */
export function incompleteReasons(r: IncompleteSource): string[] {
  const out: string[] = [...(r.errors ?? [])]
  const failed = r.fact_check_writes?.failed ?? 0
  if (failed > 0) out.push(`fact_check_write_failed:${failed}`)
  const skipped = r.counts?.skipped_by_reason ?? {}
  for (const reason of ERROR_SKIP_REASONS) {
    const n = skipped[reason] ?? 0
    if (n > 0) out.push(`schedule_skip_${reason}:${n}`)
  }
  return out
}

/** The to-do task for a run that broke part-way. Shared by the loop, the Inngest handler and the to-do reader. */
export function buildRunIncompleteTask(clientId: string, reasons: readonly string[]): WeeklyLoopManualTask {
  return {
    code: 'run_incomplete',
    what: `本周排期没跑完整：程序这次有一步出错或没读全（${reasons.join('、')}），下周的卡可能少排了视频。`,
    how: '这条不用你改视频。先打开内容工厂看下周已经排上的视频；少排的部分等开发查明原因后重跑一次出稿。把这条转给开发即可。',
    href: taskHref(clientId, 'content-factory'),
  }
}

function finalTasks(
  clientId: string,
  counts: WeeklyLoopCounts,
  stopReason: string | null,
  errors: readonly string[],
  factCheckWrites: { failed: number },
): WeeklyLoopManualTask[] {
  const tasks = buildTasks(clientId, counts, stopReason)
  const reasons = incompleteReasons({ errors, fact_check_writes: factCheckWrites, counts })
  if (reasons.length > 0) tasks.push(buildRunIncompleteTask(clientId, reasons))
  return tasks
}

// ---------- step 9: write fact checks ----------

async function writeFactChecks(
  deps: WeeklyLoopDeps,
  clientId: string,
  reviewed: Reviewed[],
  checkedAt: string,
): Promise<{ tally: { written: number; conflict: number; failed: number }; writtenIds: Set<string> }> {
  const tally = { written: 0, conflict: 0, failed: 0 }
  const writtenIds = new Set<string>()
  for (const r of reviewed) {
    const record: FactCheckRecord = {
      catalog_version: r.fact.catalogVersion,
      checked_at: checkedAt,
      verdict: r.fact.verdict,
      items: r.fact.items,
    }
    const base = isRecord(r.c.row.output) ? r.c.row.output : {}
    const output: Record<string, unknown> = { ...base, fact_check: record }
    try {
      const outcome = await deps.writeFactCheck({
        clientId,
        id: r.c.row.id,
        readUpdatedAt: r.c.row.updated_at,
        output,
      })
      if (outcome === 'written') {
        tally.written += 1
        writtenIds.add(r.c.row.id)
      } else if (outcome === 'conflict') tally.conflict += 1
      else tally.failed += 1
    } catch {
      tally.failed += 1
    }
  }
  return { tally, writtenIds }
}

// ---------- step 10: schedule ----------

interface ScheduleArgs {
  clientId: string
  weekStart: string
  weekEnd: string
  reelPerWeek: number
  reviewed: Reviewed[]
  mode: WeeklyLoopMode
  counts: WeeklyLoopCounts
  errors: string[]
  items: WeeklyLoopItem[]
  /** Write mode: ids whose fact_check write succeeded. null in dry_run (nothing is written). */
  persistedIds: ReadonlySet<string> | null
}

async function scheduleEligible(
  deps: WeeklyLoopDeps,
  args: ScheduleArgs,
): Promise<Array<{ id: string; publishOn: string }>> {
  const eligible = args.reviewed.filter((r) => r.excluded === null)
  const alreadyScheduled: ScheduledItem[] = []
  const candidates: ScheduleCandidate[] = []
  for (const r of eligible) {
    if (r.c.scheduledOn !== null) {
      alreadyScheduled.push({ id: r.c.row.id, publishOn: r.c.scheduledOn, productKey: r.productKey })
    } else {
      if (args.persistedIds !== null && !args.persistedIds.has(r.c.row.id)) {
        bump(args.counts.skipped_by_reason, 'fact_check_not_persisted')
        const item = args.items.find((i) => i.id === r.c.row.id && i.excluded_reason === null)
        if (item) item.excluded_reason = 'fact_check_not_persisted'
        continue
      }
      candidates.push({ id: r.c.row.id, productKey: r.productKey, rankAt: r.c.row.created_at })
    }
  }
  args.counts.already_scheduled = alreadyScheduled.length
  const plan = planReelSchedule({
    weekStart: args.weekStart,
    weekEnd: args.weekEnd,
    reelPerWeek: args.reelPerWeek,
    candidates,
    alreadyScheduled,
  })
  for (const u of plan.unscheduled) bump(args.counts.skipped_by_reason, u.reason)
  if (plan.assignments.length === 0) return []

  const result = await deps.writeSchedule({
    clientId: args.clientId,
    weekStart: args.weekStart,
    assignments: plan.assignments,
    dryRun: args.mode !== 'write',
  })
  if (result.ok === false) {
    // A card already open for this week is the guard working (PM is reviewing it), not a breakage:
    // count the skips but do not raise a "run incomplete" task.
    if (result.reason !== 'card_open') args.errors.push('schedule_' + result.reason)
    for (let i = 0; i < plan.assignments.length; i += 1) {
      bump(args.counts.skipped_by_reason, result.reason)
    }
    return []
  }
  for (const s of result.skipped) bump(args.counts.skipped_by_reason, s.reason)
  args.counts.scheduled = result.written.length
  return result.written
}

// ---------- receipt base ----------

function baseReceipt(
  input: RunWeeklyLoopInput,
  week: { weekStart: string; weekEnd: string },
  counts: WeeklyLoopCounts,
  items: WeeklyLoopItem[],
  errors: string[],
): WeeklyLoopReceipt {
  return {
    kind: 'client_run',
    client_id: input.clientId,
    mode: input.mode,
    status: 'completed',
    stop_reason: null,
    week_start: week.weekStart,
    week_end: week.weekEnd,
    catalog_version: null,
    truncated: false,
    reel_per_week: 0,
    recipe_stage: null,
    defaulted_stage_signals: [...DEFAULTED_STAGE_SIGNALS],
    counts,
    items,
    scheduled: [],
    fact_check_writes: { written: 0, conflict: 0, failed: 0 },
    manual_tasks: [],
    manual_tasks_delivered: input.mode === 'write',
    no_publish: true,
    errors,
  }
}

// ---------- public entry ----------

export async function runWeeklyLoop(
  deps: WeeklyLoopDeps,
  input: RunWeeklyLoopInput,
): Promise<WeeklyLoopReceipt> {
  const week = targetWeek(input.now)
  const today = isoDate(nzCalendar(input.now))
  const counts = emptyCounts()
  const items: WeeklyLoopItem[] = []
  const errors: string[] = []

  const client = await deps.loadClient(input.clientId)
  if (!client) {
    const receipt = baseReceipt(input, week, counts, items, errors)
    return { ...receipt, status: 'stopped', stop_reason: 'client_not_found' }
  }

  const { rows, truncated } = await deps.loadOrders(input.clientId)
  if (truncated) errors.push('orders_truncated')
  const candidates = selectCandidates(rows, week.weekStart, week.weekEnd, items, counts)
  const kept = keepLatestVersions(candidates, items, counts)

  const source = await deps.loadFactSource(input.clientId, today)
  if (source.ok === false) {
    const stopReason = `fact_source_unreadable:${source.reason}`
    const receipt = baseReceipt(input, week, counts, items, errors)
    return {
      ...receipt,
      status: 'stopped',
      stop_reason: stopReason,
      truncated,
      manual_tasks: finalTasks(input.clientId, counts, stopReason, errors, { failed: 0 }),
    }
  }

  const reviewed = reviewKept(kept, source, today, items, counts)
  const quota = reelQuota(client, source.tours.length, counts.eligible)

  let factCheckWrites = { written: 0, conflict: 0, failed: 0 }
  let persistedIds: Set<string> | null = null
  if (input.mode === 'write') {
    const res = await writeFactChecks(deps, input.clientId, reviewed, input.now.toISOString())
    factCheckWrites = res.tally
    persistedIds = res.writtenIds
  }

  const scheduled = await scheduleEligible(deps, {
    clientId: input.clientId,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    reelPerWeek: quota.reelPerWeek,
    reviewed,
    mode: input.mode,
    counts,
    errors,
    items,
    persistedIds,
  })

  const receipt = baseReceipt(input, week, counts, items, errors)
  return {
    ...receipt,
    status: 'completed',
    stop_reason: null,
    catalog_version: source.catalogVersion,
    truncated,
    reel_per_week: quota.reelPerWeek,
    recipe_stage: quota.stage,
    scheduled,
    fact_check_writes: factCheckWrites,
    manual_tasks: finalTasks(input.clientId, counts, null, errors, factCheckWrites),
  }
}
