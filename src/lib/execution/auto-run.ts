/**
 * DAPE E 段 —— 把执行看板上的动作真正跑掉。
 *
 * 起因（2026-08-05 生产库实测）：`execution_items` 里 281 件待办，
 * **最后一件「完成」是 7-21，15 天前**。判定用的两道闸 2026-08-04 就写好了
 * （`auto-run-policy.ts`：背书 + 白名单），但零调用方 —— 也就是说
 * 「诊断 → 方案 → 动作」这条链跑到最后一步就断了，动作只是被排出来看。
 *
 * 这个模块补上最后一步，而且刻意做得很窄：
 *
 *   · 一轮最多 3 件，每个客户最多 1 件
 *   · 只跑白名单里的三种「写博客初稿」，产物只落 `blog_posts.status='draft'`
 *   · 生成走**周更那条线**（`generateWeeklyBlogForClient`），不另起炉灶
 *   · 认领是行级原子的，失败按 2^n 天退避，3 次停手并下发今日待办
 *
 * 🔴 什么叫「跑掉」：写出一篇**草稿**。不发布、不开 PR、不碰客户网站。
 *    草稿躺在库里等人看这件事本身也有人管了（今日待办的「写好没人看」栏）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  judgeAutoRun,
  AUTO_RUNNABLE_ACTION_TYPES,
  type AutoRunVerdict,
  type Endorsement,
} from './auto-run-policy'
import { deriveEndorsement, type PrescriptionAnchor, type MarketingPlanAnchor } from './endorsement'
import { WEEKLY_COOLDOWN_DAYS } from '@/lib/blog/cadence'

/** 一轮最多跑几件。上限低不是保守，是因为每件都会花钱、都会写东西出来。 */
export const MAX_ITEMS_PER_RUN = 3
/** 每个客户一轮最多几件 —— 一个客户一天被连写三篇是灾难，不是效率。 */
export const MAX_ITEMS_PER_CLIENT = 1
/** 连续失败几次就停手叫人。到这个数之后本条不再自动重试。 */
export const MAX_ATTEMPTS = 3
/** 认领超过这么久还没有结果 = 那次执行死在半路（进程被杀 / 部署重启），放回去。 */
export const CLAIM_STALE_MINUTES = 120
/** 「这周已经有文章了」→ 等冷却期过完再来，别每天白跑一趟。 */
export const COOLDOWN_BACKOFF_DAYS = WEEKLY_COOLDOWN_DAYS + 1
/** 「没有可写的题目」→ 隔几天再看，机会数据会变。 */
export const NO_TOPIC_BACKOFF_DAYS = 3
/**
 * 整轮时间预算。真正的天花板是 cron 的 `curl --max-time 900`；
 * 过了这个点就不再开新的一件，让在跑的那件跑完。
 */
export const BATCH_BUDGET_MS = 780_000

// ── 从库里读回来的候选行 ────────────────────────────────────────────────────────

export interface CandidateItemRow {
  id: string
  client_id: string
  title: string | null
  action_type: string | null
  fix_type: string | null
  status: string
  source: string
  prescription_id: string | null
  marketing_plan_id: string | null
  steps_json: Record<string, unknown> | null
  created_at: string
  started_at: string | null
  auto_run_attempts: number | null
  auto_run_next_at: string | null
}

export interface CandidateClientRow {
  id: string
  name: string
  domain: string | null
  client_status: string
  seo_config: Record<string, unknown> | null
}

export interface JudgedCandidate {
  id: string
  client_id: string
  client_name: string
  action_type: string | null
  title: string | null
  verdict: AutoRunVerdict
  endorsement: Endorsement
  attempts: number
  row: CandidateItemRow
  client: CandidateClientRow
}

/**
 * 卡上有没有点名要打哪个词 / 改哪一页。
 *
 * `steps_json.keyword` 是 SEO 巡逻写进去的真实关键词（`seo-patrol/job.ts`），
 * `url` 是它指名的那一页。有任何一个 = 这张卡有具体所指，机器按数据自己挑题
 * 会写歪 —— 交给人。
 */
export function pinnedTopicOf(stepsJson: Record<string, unknown> | null): string | null {
  if (!stepsJson) return null
  for (const key of ['keyword', 'url', 'topic']) {
    const v = stepsJson[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

/** 这个客户开没开周更。`seo_config` 是 jsonb，缺字段一律当没开。 */
export function weeklyBlogEnabledOf(seoConfig: Record<string, unknown> | null): boolean {
  return seoConfig?.weekly_blog === true
}

/** 退避到期了吗。`auto_run_next_at` 为空 = 随时可选。 */
export function backoffElapsed(nextAt: string | null, now: Date): boolean {
  if (!nextAt) return true
  const t = Date.parse(nextAt)
  if (Number.isNaN(t)) return true // 脏数据不该把一条动作永久冻住
  return t <= now.getTime()
}

// ── 选行 + 判定 ────────────────────────────────────────────────────────────────

export interface SelectionResult {
  /** 全部候选（含被拦下的），dry-run 直接把这个列表给人看 */
  judged: JudgedCandidate[]
  /** 判定可跑的，已按「一轮最多 N 件、每客户最多 1 件」截好 */
  toRun: JudgedCandidate[]
  /** 判定可跑但被本轮名额挤掉的件数 —— 不说清楚就成了静默截断 */
  deferredByQuota: number
}

/**
 * 读候选 + 逐条判定。**纯读，不写任何东西** —— dry-run 和真跑共用这一份，
 * 两边看到的名单永远一致（分家的话，人眼确认过的名单跟机器真跑的名单可以不同，
 * 那次确认就白做了）。
 */
export async function selectAutoRunCandidates(
  supabase: SupabaseClient,
  now: Date,
  /**
   * 本轮名额。只允许比 MAX_ITEMS_PER_RUN **更小** —— 上线首轮用 1 试水。
   * 传大了会被夹回上限：一个能把安全上限调高的旋钮，早晚会被调高。
   */
  maxItems: number = MAX_ITEMS_PER_RUN,
): Promise<SelectionResult> {
  const quota = Math.max(1, Math.min(MAX_ITEMS_PER_RUN, Math.floor(maxItems)))
  // ① 性能过滤：哪些客户值得看。跟周更同一个口径（active + 周更开关）。
  const { data: eligibleRows, error: eligibleErr } = await supabase
    .from('clients')
    .select('id')
    .eq('client_status', 'active')
    .contains('seo_config', { weekly_blog: true })
  if (eligibleErr) throw new Error(`客户名单查询失败: ${eligibleErr.message}`)
  const eligibleIds = ((eligibleRows ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (eligibleIds.length === 0) return { judged: [], toRun: [], deferredByQuota: 0 }

  // ② 候选动作。SQL 只做粗筛（状态 + 类型 + 客户），退避和次数放 TS ——
  //    判定条件集中在一处才不会两边漂移。
  const { data: itemRows, error: itemErr } = await supabase
    .from('execution_items')
    .select(
      'id, client_id, title, action_type, fix_type, status, source, prescription_id, ' +
        'marketing_plan_id, steps_json, created_at, started_at, auto_run_attempts, auto_run_next_at',
    )
    .eq('status', 'pending')
    .in('action_type', AUTO_RUNNABLE_ACTION_TYPES as unknown as string[])
    .in('client_id', eligibleIds)
    // 老的排前面：等得最久的那件先做。反过来排会让积压永远排在队尾。
    .order('created_at', { ascending: true })
    .limit(200)
  if (itemErr) throw new Error(`执行项查询失败: ${itemErr.message}`)

  const items = ((itemRows ?? []) as unknown as CandidateItemRow[]).filter(
    (r) =>
      (r.auto_run_attempts ?? 0) < MAX_ATTEMPTS && backoffElapsed(r.auto_run_next_at, now),
  )
  if (items.length === 0) return { judged: [], toRun: [], deferredByQuota: 0 }

  // ③ 客户真实状态。**这一次不带任何过滤条件**，故意的：
  //    上面那次是性能过滤，这一次是安全判定的输入。两次读同一张表看着冗余，
  //    但它们回答的是不同问题 —— 判定要是拿「已经被过滤过的结果」当输入，
  //    那道闸就是恒真的，等于没有。
  const clientIds = Array.from(new Set(items.map((r) => r.client_id)))
  const { data: clientRows, error: clientErr } = await supabase
    .from('clients')
    .select('id, name, domain, client_status, seo_config')
    .in('id', clientIds)
  if (clientErr) throw new Error(`客户资料查询失败: ${clientErr.message}`)
  const clients = new Map(
    ((clientRows ?? []) as CandidateClientRow[]).map((c) => [c.id, c]),
  )

  // ④ 两根锚：方案 / 营销计划。只查候选行真正引用到的那些。
  const prescriptionIds = Array.from(
    new Set(items.map((r) => r.prescription_id).filter((v): v is string => !!v)),
  )
  const planIds = Array.from(
    new Set(items.map((r) => r.marketing_plan_id).filter((v): v is string => !!v)),
  )

  const prescriptions = new Map<string, PrescriptionAnchor>()
  if (prescriptionIds.length > 0) {
    const { data, error } = await supabase
      .from('prescriptions')
      .select('id, client_id, status, approved_at, generated_at')
      .in('id', prescriptionIds)
    if (error) throw new Error(`方案查询失败: ${error.message}`)
    for (const p of (data ?? []) as Array<PrescriptionAnchor & { id: string }>) {
      prescriptions.set(p.id, p)
    }
  }

  const plans = new Map<string, MarketingPlanAnchor>()
  if (planIds.length > 0) {
    const { data, error } = await supabase
      .from('marketing_plans')
      .select('id, client_id, status, approved_at, end_date')
      .in('id', planIds)
    if (error) throw new Error(`营销计划查询失败: ${error.message}`)
    for (const m of (data ?? []) as Array<MarketingPlanAnchor & { id: string }>) {
      plans.set(m.id, m)
    }
  }

  // ⑤ 逐条判定
  const judged: JudgedCandidate[] = []
  for (const row of items) {
    const client = clients.get(row.client_id)
    const endorsement = deriveEndorsement(
      {
        source: row.source,
        clientId: row.client_id,
        createdAt: row.created_at,
        prescriptionId: row.prescription_id,
        prescription: row.prescription_id
          ? (prescriptions.get(row.prescription_id) ?? null)
          : null,
        marketingPlanId: row.marketing_plan_id,
        marketingPlan: row.marketing_plan_id ? (plans.get(row.marketing_plan_id) ?? null) : null,
      },
      now,
    )

    // 客户行查不回来 = 不知道这家公司现在算什么 → 当成不可跑，别猜
    const verdict: AutoRunVerdict = client
      ? judgeAutoRun({
          actionType: row.action_type,
          fixType: row.fix_type,
          status: row.status,
          clientStatus: client.client_status,
          weeklyBlogEnabled: weeklyBlogEnabledOf(client.seo_config),
          pinnedTopic: pinnedTopicOf(row.steps_json),
          endorsement,
        })
      : { run: false, reason: '查不到这条动作属于哪个客户，不动它' }

    judged.push({
      id: row.id,
      client_id: row.client_id,
      client_name: client?.name ?? '未知客户',
      action_type: row.action_type,
      title: row.title,
      verdict,
      endorsement,
      attempts: row.auto_run_attempts ?? 0,
      row,
      client: client ?? {
        id: row.client_id,
        name: '未知客户',
        domain: null,
        client_status: 'unknown',
        seo_config: null,
      },
    })
  }

  // ⑥ 名额：一轮 N 件、每客户 1 件
  const runnable = judged.filter((j) => j.verdict.run)
  const perClient = new Map<string, number>()
  const toRun: JudgedCandidate[] = []
  for (const j of runnable) {
    if (toRun.length >= quota) break
    const n = perClient.get(j.client_id) ?? 0
    if (n >= MAX_ITEMS_PER_CLIENT) continue
    perClient.set(j.client_id, n + 1)
    toRun.push(j)
  }

  return { judged, toRun, deferredByQuota: runnable.length - toRun.length }
}

// ── 认领 / 归还 ────────────────────────────────────────────────────────────────

/**
 * 行级原子认领。返回 false = 没抢到（别人先动了这条），**不是失败**。
 *
 * 🔴 `.eq('status','pending')` + `.select()` 缺一不可：
 *    条件写在 update 里，由数据库判定；`.select()` 把真正改到的行返回来 ——
 *    没有它就分不清「改了 1 行」和「一行都没匹配上」，而这正是并发下唯一的信号。
 *    一条一条认领，不批量：批量更新拿不到「哪几条是我抢到的」。
 */
export async function claimItem(
  supabase: SupabaseClient,
  item: { id: string; started_at: string | null },
  now: Date,
): Promise<boolean> {
  const nowIso = now.toISOString()
  const patch: Record<string, unknown> = {
    status: 'in_progress',
    auto_run_started_at: nowIso,
    auto_run_error: null,
  }
  // 第一次开工才写 started_at；已经有值的不覆盖（那是人上次开工的时刻）
  if (!item.started_at) patch.started_at = nowIso

  const { data, error } = await supabase
    .from('execution_items')
    .update(patch)
    .eq('id', item.id)
    .eq('status', 'pending')
    .select('id')

  if (error) {
    console.warn(`[auto-run] 认领 ${item.id} 出错:`, error.message)
    return false
  }
  return ((data ?? []) as unknown[]).length === 1
}

/** 归还：放回待办，并按需要压一段退避。attempts 由调用方算好传进来。 */
async function releaseItem(
  supabase: SupabaseClient,
  itemId: string,
  opts: { attempts: number; nextAt: Date | null; error: string | null },
): Promise<void> {
  await supabase
    .from('execution_items')
    .update({
      status: 'pending',
      auto_run_started_at: null,
      auto_run_attempts: opts.attempts,
      auto_run_next_at: opts.nextAt ? opts.nextAt.toISOString() : null,
      auto_run_error: opts.error,
    })
    .eq('id', itemId)
}

/** 失败第 n 次之后，下次最早什么时候再试。2 天 → 4 天 → 停手。 */
export function backoffAfterFailure(attempts: number, now: Date): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null // 停手，等人
  return new Date(now.getTime() + Math.pow(2, attempts) * 86_400_000)
}

/**
 * 把自己掉在半路的认领捡回来。
 *
 * 🔴 只碰 `auto_run_started_at` 有值的行 —— 那是**本 cron 自己**写的标记。
 *    库里另有 20 件卡在 in_progress（最老的 6-02），两个开工时间列全是 NULL，
 *    说明是人手把卡拖过去的。那些不归这里管，碰了就是替人做决定。
 */
export async function releaseStaleClaims(
  supabase: SupabaseClient,
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - CLAIM_STALE_MINUTES * 60_000).toISOString()
  const { data, error } = await supabase
    .from('execution_items')
    .select('id, auto_run_attempts')
    .eq('status', 'in_progress')
    .not('auto_run_started_at', 'is', null)
    .lt('auto_run_started_at', cutoff)
  if (error) {
    console.warn('[auto-run] 找回半路认领失败（不阻塞本轮）:', error.message)
    return 0
  }

  const rows = (data ?? []) as Array<{ id: string; auto_run_attempts: number | null }>
  for (const r of rows) {
    const attempts = (r.auto_run_attempts ?? 0) + 1
    await releaseItem(supabase, r.id, {
      attempts,
      nextAt: backoffAfterFailure(attempts, now),
      error: `上一次执行没跑完就中断了（超过 ${CLAIM_STALE_MINUTES} 分钟没有结果）`,
    })
  }
  return rows.length
}

// ── 执行 ──────────────────────────────────────────────────────────────────────

export interface AutoRunGenerateResult {
  outcome: string
  post_id?: string
  topic?: string
  error?: string
}

export interface AutoRunDeps {
  /** 写一篇。真身是 `generateWeeklyBlogForClient`，测试里换掉。 */
  generateBlog(client: {
    id: string
    name: string
    domain: string | null
  }): Promise<AutoRunGenerateResult>
}

export type AutoRunItemOutcome =
  | 'generated'
  | 'skipped_not_claimed'
  | 'skipped_recent_post'
  | 'skipped_no_topic'
  | 'failed'
  | 'gave_up'

export interface AutoRunItemResult {
  item_id: string
  client_id: string
  client_name: string
  outcome: AutoRunItemOutcome
  post_id?: string
  topic?: string
  error?: string
}

export interface AutoRunBatchResult {
  dry_run: boolean
  considered: number
  runnable: number
  deferred_by_quota: number
  released_stale: number
  generated: number
  failed: number
  results: AutoRunItemResult[]
  /** dry-run 用：每条候选的判定，给人眼确认名单 */
  verdicts: Array<{
    id: string
    client: string
    action_type: string | null
    verdict: 'run' | 'blocked'
    reason: string
  }>
}

function verdictLines(judged: JudgedCandidate[]): AutoRunBatchResult['verdicts'] {
  return judged.map((j) => ({
    id: j.id,
    client: j.client_name,
    action_type: j.action_type,
    verdict: j.verdict.run ? ('run' as const) : ('blocked' as const),
    reason: j.verdict.run ? '这条我可以自己做（写成草稿，不发布）' : j.verdict.reason,
  }))
}

/** 成功之后往工作日志里写一笔 —— 不写的话，看板上只会突然多出一条「已完成」。 */
async function logCompletion(
  supabase: SupabaseClient,
  j: JudgedCandidate,
  res: AutoRunGenerateResult,
): Promise<void> {
  const { error } = await supabase.from('execution_logs').insert({
    execution_item_id: j.id,
    client_id: j.client_id,
    author: 'system',
    kind: 'status_change',
    content:
      `系统自动完成：写了一篇草稿《${res.topic ?? '未命名'}》，` +
      '还没发布 —— 要不要上线由人决定',
    meta: { auto_run: true, blog_post_id: res.post_id ?? null, topic: res.topic ?? null },
  })
  if (error) console.warn('[auto-run] 工作日志写入失败（不影响已完成的动作）:', error.message)
}

/**
 * 跑一轮。
 *
 * `dryRun=true` 时**只选不做**：不认领、不生成、不写任何一行。
 * 上线第一步就是拿它把名单打出来给人看（PM 认可的上线方式）。
 */
export async function runAutoRunBatch(
  supabase: SupabaseClient,
  deps: AutoRunDeps,
  now: Date,
  opts: { dryRun: boolean; maxItems?: number } = { dryRun: true },
): Promise<AutoRunBatchResult> {
  const startedAt = Date.now()

  const releasedStale = opts.dryRun ? 0 : await releaseStaleClaims(supabase, now)
  const { judged, toRun, deferredByQuota } = await selectAutoRunCandidates(
    supabase,
    now,
    opts.maxItems ?? MAX_ITEMS_PER_RUN,
  )

  const base: AutoRunBatchResult = {
    dry_run: opts.dryRun,
    considered: judged.length,
    runnable: judged.filter((j) => j.verdict.run).length,
    deferred_by_quota: deferredByQuota,
    released_stale: releasedStale,
    generated: 0,
    failed: 0,
    results: [],
    verdicts: verdictLines(judged),
  }

  if (opts.dryRun) return base

  const results: AutoRunItemResult[] = []
  for (const j of toRun) {
    if (Date.now() - startedAt > BATCH_BUDGET_MS) {
      console.warn('[auto-run] 时间预算用完，本轮剩下的留到下一轮')
      break
    }

    const claimed = await claimItem(supabase, { id: j.id, started_at: j.row.started_at }, now)
    if (!claimed) {
      // 没抢到 = 有人（或另一个实例）先动了这条。跳过，不是失败。
      results.push({
        item_id: j.id,
        client_id: j.client_id,
        client_name: j.client_name,
        outcome: 'skipped_not_claimed',
      })
      continue
    }

    let res: AutoRunGenerateResult
    try {
      res = await deps.generateBlog({
        id: j.client.id,
        name: j.client.name,
        domain: j.client.domain,
      })
    } catch (err) {
      res = { outcome: 'error', error: err instanceof Error ? err.message : String(err) }
    }

    if (res.outcome === 'generated') {
      await supabase
        .from('execution_items')
        .update({
          status: 'completed',
          completed_at: now.toISOString(),
          auto_run_started_at: null,
          auto_run_error: null,
          auto_run_attempts: 0,
          auto_run_next_at: null,
        })
        .eq('id', j.id)
      await logCompletion(supabase, j, res)
      results.push({
        item_id: j.id,
        client_id: j.client_id,
        client_name: j.client_name,
        outcome: 'generated',
        post_id: res.post_id,
        topic: res.topic,
      })
      continue
    }

    // 「这周已经有文章了」「没有可写的题目」都不是失败 —— 不计次数，只压一段退避。
    // 计成失败的话，三个正常的星期就能把一条好动作永久停掉。
    if (res.outcome === 'skipped_recent_post' || res.outcome === 'skipped_no_topic') {
      const days =
        res.outcome === 'skipped_recent_post' ? COOLDOWN_BACKOFF_DAYS : NO_TOPIC_BACKOFF_DAYS
      await releaseItem(supabase, j.id, {
        attempts: j.attempts,
        nextAt: new Date(now.getTime() + days * 86_400_000),
        error: null,
      })
      results.push({
        item_id: j.id,
        client_id: j.client_id,
        client_name: j.client_name,
        outcome: res.outcome,
      })
      continue
    }

    const attempts = j.attempts + 1
    const nextAt = backoffAfterFailure(attempts, now)
    await releaseItem(supabase, j.id, {
      attempts,
      nextAt,
      error: res.error ?? '未知原因',
    })
    results.push({
      item_id: j.id,
      client_id: j.client_id,
      client_name: j.client_name,
      outcome: attempts >= MAX_ATTEMPTS ? 'gave_up' : 'failed',
      error: res.error ?? '未知原因',
    })
  }

  return {
    ...base,
    generated: results.filter((r) => r.outcome === 'generated').length,
    failed: results.filter((r) => r.outcome === 'failed' || r.outcome === 'gave_up').length,
    results,
  }
}
