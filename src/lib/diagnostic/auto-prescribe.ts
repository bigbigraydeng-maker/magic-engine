/**
 * 处方周更 —— 补上 DAPE 的 P 段（处方）。
 *
 * 体检（A 段）2026-08-03 已经接上周更。但只接 A 不接 P，等于每周产出一份新报告
 * 然后没人把它变成活儿 —— 库里的事实：真实客户最后一份方案是 5 月 14/15 号出的，
 * 之后再没出过第二份；4 份草稿从 5 月躺到今天，既没批准也没拒绝，就那么烂着。
 * 目标最近一次新建是 6/19，战役是 6/8。执行看板天天在转，转的是两个多月前的结论。
 *
 * 🔴 谁消费（PM 2026-08-04 拍板）：**不是 PM 的眼睛，是执行看板。**
 *    方案自动落地（派生 Initiative + 生成执行项），待办里只出一条通知让 PM 知情。
 *    理由：方案本身不花钱也不对外，落地只是变成看板上的待做动作 ——
 *    真要花钱 / 真要对外发布时，原来那道授权闸门还在。
 *    要 PM 一份份点头的方案，就是 5 月那 4 份草稿的下场。
 *
 * 🔴 为什么单独一个定时任务，不塞进体检里：
 *    体检本身已经是六维度全量采集 × 3 个客户串行，再串一轮 AI 出方容易超时；
 *    更要紧的是**失败要能分辨** —— 混在一起跑，挂了只知道"这周没结果"，
 *    分不清是体检没采到还是方案没生成。周二跑，正好吃周一体检的结果。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiagnosticDimension, PrescriptionIntake, TimelineUrgency } from '@/types/diagnostic'
import type { GoalRow } from '@/types/strategy'
import { generatePrescription } from './prescription-generator'
import { landPrescription } from './prescription-landing'
import { listActiveGoals } from '@/lib/strategy/goals'

/** 体检结果多新才算「这周的」—— 周更任务，给一周多一点余量。 */
export const DIAGNOSIS_FRESH_DAYS = 8

/** 同一客户多久内出过方就不再出 —— 防手工刚开完方定时任务又来一份。 */
export const REPRESCRIBE_COOLDOWN_DAYS = 6

/** 交给 AI 的重点维度取几个 —— 全给等于没重点。 */
const PRIORITY_DIMENSION_COUNT = 3

/**
 * 机器自动落地的处方在 `prescriptions.agent_name` 上打的标记。
 * 待办通知靠它区分「系统自动落地的」和「PM 自己在界面点的批准」。
 */
export const AUTO_LANDED_AGENT = 'prescription-weekly'

/**
 * 六个维度的中文名。这段文字会跟着开方口径存进库、可能出现在界面上，
 * 不能留 `ai_visibility` 这种字段名给人看（对外一律用中文封装名）。
 */
const DIMENSION_LABELS: Record<DiagnosticDimension, string> = {
  seo: 'SEO',
  ai_visibility: 'AI 可见度',
  ads: '广告',
  social: '社媒',
  reputation: '口碑',
  competitor: '竞品',
}

export interface CompletedRun {
  id: string
  clientId: string
  createdAt: Date
  dimensionScores: Partial<Record<DiagnosticDimension, number | null>> | null
}

export type PrescribeSkipReason =
  | 'no_fresh_diagnosis'
  | 'prescribed_recently'
  | 'no_active_goal'
  /** 不是进行中的付费客户（演示账号 / 潜客 / 我们自己的内部账号） */
  | 'not_a_live_client'

export interface PrescribeCandidate {
  clientId: string
  runId: string
  dimensionScores: Partial<Record<DiagnosticDimension, number | null>> | null
}

export interface PrescribeSkip {
  clientId: string
  reason: PrescribeSkipReason
  detail: string
}

/**
 * 谁该出方。纯函数 —— 「给错客户开方」跟「给错客户做体检」一样贵，
 * 而且更难发现：错的方案会变成看板上真的动作。
 */
export function pickPrescribeCandidates(
  runs: CompletedRun[],
  lastPrescribedByClient: Map<string, Date>,
  now: Date,
): { candidates: PrescribeCandidate[]; skipped: PrescribeSkip[] } {
  const candidates: PrescribeCandidate[] = []
  const skipped: PrescribeSkip[] = []

  // 一个客户这周可能跑过不止一次体检 —— 只认最新那次
  const newestByClient = new Map<string, CompletedRun>()
  for (const r of runs) {
    const cur = newestByClient.get(r.clientId)
    if (!cur || r.createdAt > cur.createdAt) newestByClient.set(r.clientId, r)
  }

  for (const run of Array.from(newestByClient.values())) {
    const ageDays = (now.getTime() - run.createdAt.getTime()) / 86_400_000
    if (ageDays > DIAGNOSIS_FRESH_DAYS) {
      skipped.push({
        clientId: run.clientId,
        reason: 'no_fresh_diagnosis',
        detail: `最近一次体检是 ${ageDays.toFixed(0)} 天前，太旧了 —— 照旧结果开方等于开错药`,
      })
      continue
    }

    const last = lastPrescribedByClient.get(run.clientId)
    if (last) {
      const days = (now.getTime() - last.getTime()) / 86_400_000
      if (days < REPRESCRIBE_COOLDOWN_DAYS) {
        skipped.push({
          clientId: run.clientId,
          reason: 'prescribed_recently',
          detail: `${days.toFixed(1)} 天前刚出过方案（冷却 ${REPRESCRIBE_COOLDOWN_DAYS} 天）`,
        })
        continue
      }
    }

    candidates.push({
      clientId: run.clientId,
      runId: run.id,
      dimensionScores: run.dimensionScores,
    })
  }

  return { candidates, skipped }
}

/**
 * 体检里得分最低的几个维度 —— 交给 AI 当「这次重点看哪几块」。
 *
 * 🔴 没采到分数的维度（null）**不算最低**。
 *    null 是"这次没采着"，不是"零分"。把没采到的当最差报上去，
 *    AI 会照着一块根本没数据的地方开方 —— 这是编，不是分析。
 */
export function lowestDimensions(
  scores: Partial<Record<DiagnosticDimension, number | null>> | null,
  count: number = PRIORITY_DIMENSION_COUNT,
): DiagnosticDimension[] {
  if (!scores) return []
  const scored = Object.entries(scores)
    .filter((e): e is [string, number] => typeof e[1] === 'number')
    .sort((a, b) => a[1] - b[1])
    .slice(0, count)
  return scored.map(([dim]) => dim as DiagnosticDimension)
}

/**
 * 客户有好几个进行中目标时，这次的方案服务哪一个。
 *
 * 规矩：**在还没到期的目标里，挑最先到期的那个** —— 时间压力最大的先排。
 * 挂了哪个会写进待办通知，PM 一眼看得出挂错。
 *
 * 🔴 「先滤掉已过期的」不是防御性编程，是今天就会踩的坑：
 *    Oztop《Oztop Walnut 地板清仓》的到期日是 2026-08-03，但状态还挂在「进行中」
 *    （目标到期不会自动改状态）。不滤的话，下周二第一次跑就会选中它，
 *    还会因为剩余天数是负数而被算成「马上要」，然后生成几十条动作
 *    瞄准一个已经关掉的窗口。3 个合格客户里就中 1 个。
 *
 * 🔴 到期日会打平（CTS 有两个目标都是 2026-09-02）。打平时取先建的那个，
 *    让结果是确定的 —— 靠入参顺序碰巧稳定不算设计。
 */
export function pickGoalForPrescription(goals: GoalRow[], now: Date): GoalRow | null {
  const live = goals.filter((g) => !g.period_end || new Date(g.period_end) >= startOfDay(now))
  if (live.length === 0) return null

  const dated = live.filter((g) => g.period_end)
  if (dated.length === 0) return live[0]

  return dated.reduce((soonest, g) => {
    const a = new Date(g.period_end as string).getTime()
    const b = new Date(soonest.period_end as string).getTime()
    if (a !== b) return a < b ? g : soonest
    // 到期日打平 → 先建的优先，保证同样的输入永远选出同一个
    return new Date(g.created_at) < new Date(soonest.created_at) ? g : soonest
  })
}

/** 只比日期不比时刻 —— 到期当天仍算有效，不能因为差几个小时就把目标判死。 */
function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * 目标离到期还有多久 → 紧迫度。纯粹按日期算，不猜。
 *
 * 已过期的目标走不到这儿（`pickGoalForPrescription` 已经滤掉），
 * 但真传进来也不能让负数落进「马上要」—— 那是把一个关掉的窗口报成最紧急。
 */
export function urgencyFromGoal(goal: GoalRow, now: Date): TimelineUrgency {
  if (!goal.period_end) return 'short_term'
  const days = (new Date(goal.period_end).getTime() - startOfDay(now).getTime()) / 86_400_000
  if (days < 0) return 'long_term'
  if (days <= 45) return 'immediate'
  if (days <= 120) return 'short_term'
  return 'long_term'
}

/**
 * 这次开方按什么来。每一项都必须指得出来源，不许出现"看起来合理"的编造值。
 *
 * 🔴 首版是「有上一份就整份照抄」，被复审打回。照抄有三个坏处，都是实数据验证过的：
 *    1. 处方跟目标一对一，但库里 CTS/Oztop 最近一份口径是 5 月填的、目标是 6 月建的，
 *       照抄等于拿「3个月内产生15位flooring客户」去服务《Oztop Walnut 地板清仓》——
 *       口径和目标对不上，AI 两头都够不着。
 *    2. 5 月那份写的月预算 1000/3000，而这些目标的预算字段**全是空的**。
 *       照抄就是拿一个跟本目标无关的旧数字去切预算 —— 这就是「凭空注入客户业务数据」。
 *    3. 重点维度被冻在 5 月。本周体检算出来的最低分维度根本进不了 prompt，
 *       等于每周采完数据不用。
 *
 * 现在的规矩：**跟目标走的字段每次重算，人填过的话保留下来当上下文**。
 */
export function buildIntake(
  goal: GoalRow,
  dimensionScores: Partial<Record<DiagnosticDimension, number | null>> | null,
  priorIntake: PrescriptionIntake | null,
  now: Date,
): PrescriptionIntake {
  const priority = lowestDimensions(dimensionScores)
  // 🔴 预算**只认这个目标自己的**，没填就是 0。
  //    上一版退回过「目标没填就沿用上一份口径的月预算」，被复审打回，打得对：
  //    库里 CTS 3 个 + Oztop 4 个进行中目标的预算字段**全是空的**，
  //    所以那条兜底不是边角情况，是每周必走 —— 等于每周拿一个 5 月填的、
  //    跟本目标毫无关系的数字（1000 / 3000）去让 AI 切分钱方案。
  //    这正是这段文档块上面刚判过死刑的「凭空注入客户业务数据」。
  //    宁可让 AI 知道"没预算"，也不替客户编一个数。
  const budget = goal.budget_amount ?? 0
  const budgetSource = goal.budget_amount != null ? '目标自带预算' : '这个目标没填预算，按 0 处理'

  // 🔴 措辞不能写死「人工填过的」：这条链自己产出的方案也是 approved 状态，
  //    取上一份时必须把机器那份排掉（见 runAutoPrescribe），否则第二周起
  //    抄到的其实是上周机器自己写的那份，而文案还在说这是人填的。
  const priorLine = priorIntake
    ? `　上一份开方口径（供参考，不是本次的目标）：${priorIntake.business_goal}`
    : '　该客户此前没有人工填过开方口径。'

  return {
    // 处方跟目标一对一，所以业务目标就是这个目标本身，不是别处抄来的一句话
    business_goal: goal.title,
    timeline_urgency: urgencyFromGoal(goal, now),
    monthly_budget_aud: budget,
    // 🔴 每次用本周体检重算 —— 冻住这一项等于白采数据
    priority_dimensions: priority,
    notes:
      `本次开方服务于目标《${goal.title}》。\n` +
      `　预算口径：${budgetSource}（${budget} AUD/月）。\n` +
      `　重点维度：${priority.length > 0 ? `本周体检最低分的 ${priority.map((d) => DIMENSION_LABELS[d]).join(' / ')}` : '本周体检未采到任何维度分数'}。\n` +
      priorLine,
  }
}

// ── 编排 ──────────────────────────────────────────────────────────────────────

export interface PrescribeOutcome {
  clientId: string
  clientName: string
  result: 'prescribed' | 'skipped' | 'error'
  prescriptionId?: string
  goalTitle?: string
  executionItems?: number
  /** 派生出的 Initiative 数。0 = 这批动作没挂到目标下，通知文案必须照实说 */
  initiatives?: number
  detail?: string
}

export interface AutoPrescribeSummary {
  considered: number
  prescribed: number
  outcomes: PrescribeOutcome[]
}

export async function runAutoPrescribe(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<AutoPrescribeSummary> {
  const since = new Date(now.getTime() - DIAGNOSIS_FRESH_DAYS * 86_400_000).toISOString()

  const { data: runRows, error: runErr } = await supabase
    .from('diagnostic_runs')
    .select('id, client_id, created_at, dimension_scores')
    .eq('status', 'completed')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  if (runErr) throw new Error(`diagnostic_runs query failed: ${runErr.message}`)

  const runs: CompletedRun[] = ((runRows ?? []) as Array<{
    id: string
    client_id: string
    created_at: string
    dimension_scores: Partial<Record<DiagnosticDimension, number | null>> | null
  }>).map((r) => ({
    id: r.id,
    clientId: r.client_id,
    createdAt: new Date(r.created_at),
    dimensionScores: r.dimension_scores,
  }))

  // 每个客户最近一次开方时间 + 最近一份**人工确认过的** intake，一次查回来。
  // 🔴 intake 只认 approved 的：被拒过 / 生成失败 的口径不该复活。
  const { data: presRows } = await supabase
    .from('prescriptions')
    .select('client_id, created_at, intake, status, goal_id, agent_name')
    .order('created_at', { ascending: false })
    .limit(500)

  const allPres = (presRows ?? []) as Array<{
    client_id: string
    created_at: string
    intake: PrescriptionIntake | null
    status: string
    goal_id: string | null
    agent_name: string | null
  }>

  const lastPrescribed = new Map<string, Date>()
  const priorIntake = new Map<string, PrescriptionIntake>()
  /** 每个目标当前生效的那份处方 —— 新方案落地时要把它归档，否则看板一周一层往上堆 */
  const activeByGoal = new Map<string, string>()
  for (const p of allPres) {
    // 🔴 失败的那份不占冷却 —— 否则一次失败就把这个客户静默停掉一周，
    //    而"这周为什么没方案"从外面根本看不出来
    if (p.status !== 'failed' && !lastPrescribed.has(p.client_id)) {
      lastPrescribed.set(p.client_id, new Date(p.created_at))
    }
    // 🔴 只认**人**开的那份口径，且必须是批准过的。
    //    这条链自己产出的方案也是 approved —— 不把机器那份排掉的话，
    //    第二周抄到的就是上周机器自己写的，一周抄一周，机器把自己的输出
    //    当成人的输入滚雪球，而 AI 还照着它去开方、变成看板上真的动作。
    if (
      p.status === 'approved' &&
      p.agent_name !== AUTO_LANDED_AGENT &&
      p.intake &&
      !priorIntake.has(p.client_id)
    ) {
      priorIntake.set(p.client_id, p.intake)
    }
  }
  // 单独一遍：按 goal 找当前 approved 的那份（上面那遍是按 client 的，条件不一样）
  const { data: activeRows } = await supabase
    .from('prescriptions')
    .select('id, goal_id, created_at')
    .eq('status', 'approved')
    .not('goal_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500)
  for (const p of (activeRows ?? []) as Array<{ id: string; goal_id: string }>) {
    if (!activeByGoal.has(p.goal_id)) activeByGoal.set(p.goal_id, p.id)
  }

  const { candidates: rawCandidates, skipped } = pickPrescribeCandidates(runs, lastPrescribed, now)

  const clientIds = Array.from(new Set([...rawCandidates, ...skipped].map((x) => x.clientId)))
  const { data: clientRows } = await supabase
    .from('clients')
    .select('id, name, client_status, industry')
    .in('id', clientIds.length > 0 ? clientIds : ['00000000-0000-0000-0000-000000000000'])
  const clientById = new Map(
    ((clientRows ?? []) as Array<{
      id: string
      name: string
      client_status: string | null
      industry: string | null
    }>).map((c) => [c.id, c]),
  )
  const nameOf = new Map(Array.from(clientById.values()).map((c) => [c.id, c.name]))

  // 🔴 跟体检段用同一把闸门。首版这里对客户零过滤 —— 体检那边刚堵上内部账号，
  //    这边又漏出来了：任何人给演示账号 / 潜客手点一次体检，周二就会给它打一次 AI
  //    并往它名下写几十条执行项。开方比体检更贵，闸门只装一半等于没装。
  const candidates: PrescribeCandidate[] = []
  const gated: PrescribeSkip[] = []
  for (const c of rawCandidates) {
    const info = clientById.get(c.clientId)
    if (!info || info.client_status !== 'active' || !info.industry?.trim()) {
      gated.push({
        clientId: c.clientId,
        reason: 'not_a_live_client',
        detail: !info
          ? '查不到这个客户'
          : info.client_status !== 'active'
            ? `客户状态是「${info.client_status ?? '空'}」，不是进行中的付费客户`
            : '没填行业 —— 按内部账号处理',
      })
      continue
    }
    candidates.push(c)
  }
  skipped.push(...gated)

  const outcomes: PrescribeOutcome[] = skipped.map((s) => ({
    clientId: s.clientId,
    clientName: nameOf.get(s.clientId) ?? s.clientId,
    result: 'skipped' as const,
    detail: s.detail,
  }))

  let prescribed = 0
  // 串行：每份方案都要打一次 AI，并行只会互相抢额度，而这是周更任务，不赶时间
  for (const cand of candidates) {
    const clientName = nameOf.get(cand.clientId) ?? cand.clientId
    // 出了错要能把这条半成品标掉，所以声明在 try 外面
    let draftId: string | null = null
    try {
      const goals = await listActiveGoals(supabase, cand.clientId)
      const goal = pickGoalForPrescription(goals, now)
      if (!goal) {
        outcomes.push({
          clientId: cand.clientId,
          clientName,
          result: 'skipped',
          detail:
            goals.length === 0
              ? '这个客户没有进行中的目标，方案无从挂起 —— 先给他定个目标'
              : `这个客户 ${goals.length} 个目标全都过期了（状态还挂着"进行中"），先定个新目标再开方`,
        })
        continue
      }

      const intake = buildIntake(goal, cand.dimensionScores, priorIntake.get(cand.clientId) ?? null, now)
      const { prescriptionId, content } = await generatePrescription(
        supabase,
        cand.runId,
        cand.clientId,
        intake,
      )
      draftId = prescriptionId

      // generatePrescription 存的是不挂目标的裸草稿，补上目标与版本号
      const { data: verRow } = await supabase
        .from('prescriptions')
        .select('version')
        .eq('goal_id', goal.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle<{ version: number }>()
      const nextVersion = (verRow?.version ?? 0) + 1

      // 这一版要替代该目标下当前生效的那份 —— 不填的话旧方案永远停在 approved，
      // 它名下没人动过的动作会一直挂在看板上，一周叠一层
      const supersedesId = activeByGoal.get(goal.id) ?? null

      // agent_name 一起在这次写 —— 它是 PM 通知的唯一开关，单独发一条不查返回值的
      // update 等于给自己留一个「通知全没了但 cron 报成功」的静默失败。
      // 提前写是安全的：落地失败会把这份标成 failed，而通知只查 approved。
      const { data: linked, error: linkErr } = await supabase
        .from('prescriptions')
        .update({
          goal_id: goal.id,
          version: nextVersion,
          supersedes_id: supersedesId,
          agent_name: AUTO_LANDED_AGENT,
        })
        .eq('id', prescriptionId)
        .eq('client_id', cand.clientId)
        .select('id')
      if (linkErr) throw new Error(`处方挂目标失败：${linkErr.message}`)
      if (!linked || linked.length === 0) throw new Error('处方挂目标失败：没有匹配到刚生成的那条')

      const landed = await landPrescription(
        supabase,
        {
          id: prescriptionId,
          client_id: cand.clientId,
          goal_id: goal.id,
          version: nextVersion,
          // 必须带上正文 —— 派生 Initiative 读的是 content.phases[].initiative_seed，
          // 传 null 会静默派生 0 个，方案就只剩执行项、挂不到目标下
          content,
          supersedes_id: supersedesId,
        },
        'prescription-weekly（自动落地）',
      )
      // 落地成功了，这份就是该目标的当前版；同一轮里若还有别的客户共用不到它，
      // 但同客户多目标时这一步能防止把刚落地的这份当成"上一版"再归档一次
      activeByGoal.set(goal.id, prescriptionId)

      prescribed += 1
      outcomes.push({
        clientId: cand.clientId,
        clientName,
        result: 'prescribed',
        prescriptionId,
        goalTitle: goal.title,
        executionItems: landed.executionItems,
        initiatives: landed.initiativesInserted,
        detail: landed.notes.join('；'),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // 🔴 生成成功但落地失败时，库里已经躺了一份 draft。不标掉的话它会：
      //    ① 白占 6 天冷却（下周照样不重试）② 被当成"上一份口径"抄走。
      //    「4 份草稿从 5 月躺到今天」就是这么来的，别再造新的。
      if (draftId) {
        // 这一句本身也可能抛。它在 catch 里，抛出去就穿出整个 for 循环，
        // 「一个客户失败不拖累其他客户」当场失效 —— 所以必须再包一层。
        try {
          await supabase
            .from('prescriptions')
            .update({ status: 'failed', error_message: msg })
            .eq('id', draftId)
            .eq('client_id', cand.clientId)
        } catch {
          // 标不掉就算了，下面的 outcome 里已经记了真正的失败原因
        }
      }
      // 一个客户失败不拖累其他客户，但原因必须留下
      outcomes.push({
        clientId: cand.clientId,
        clientName,
        result: 'error',
        detail: msg,
      })
    }
  }

  return { considered: candidates.length + skipped.length, prescribed, outcomes }
}
