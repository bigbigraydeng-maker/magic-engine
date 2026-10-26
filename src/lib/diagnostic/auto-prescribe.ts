/**
 * 旧的「该给谁开方」纯规则。
 *
 * 2026-10-25 起，周二任务不再调用这里去生成或批准方案。
 * 正在跑的复查在 `prescription-weekly-check.ts`：只读已经批准、正在执行的方案，
 * 写一段进度和调整建议。下面这些函数没有任何定时任务在调用，留下是因为
 * 选择规则本身还有测试锁着，避免以后有人无声把自动开方接回去。
 */

import type { DiagnosticDimension, PrescriptionIntake, TimelineUrgency } from '@/types/diagnostic'
import type { GoalRow } from '@/types/strategy'
import { budgetAmountLabel, normalizeBudgetCurrency } from '@/lib/ads/budget-currency'

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
        // Six-day cooldown only. A manual draft past the cooldown is still
        // blocked per goal in pickGoalForPrescription (blockedGoalIds).
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
export function pickGoalForPrescription(
  goals: GoalRow[],
  now: Date,
  blockedGoalIds?: ReadonlySet<string>,
): GoalRow | null {
  const live = goals.filter((g) => {
    if (blockedGoalIds?.has(g.id)) return false
    return !g.period_end || new Date(g.period_end) >= startOfDay(now)
  })
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
  const budgetCurrency = normalizeBudgetCurrency(goal.budget_currency)
  const budgetSource = goal.budget_amount != null ? '目标自带预算' : '这个目标没填预算，按 0 处理'
  const budgetText = budgetCurrency ? budgetAmountLabel(budget, budgetCurrency) : `${budget}（币种未标明）`

  // 🔴 措辞不能写死「人工填过的」：这条链自己产出的方案也是 approved 状态，
  //    取上一份时必须把机器那份排掉，否则第二周起
  //    抄到的其实是上周机器自己写的那份，而文案还在说这是人填的。
  const priorLine = priorIntake
    ? `　上一份开方口径（供参考，不是本次的目标）：${priorIntake.business_goal}`
    : '　该客户此前没有人工填过开方口径。'

  return {
    // 处方跟目标一对一，所以业务目标就是这个目标本身，不是别处抄来的一句话
    business_goal: goal.title,
    timeline_urgency: urgencyFromGoal(goal, now),
    monthly_budget_aud: budget,
    ...(budgetCurrency ? { budget_currency: budgetCurrency } : {}),
    // 🔴 每次用本周体检重算 —— 冻住这一项等于白采数据
    priority_dimensions: priority,
    notes:
      `本次开方服务于目标《${goal.title}》。\n` +
      `　预算口径：${budgetSource}（${budgetText}）。\n` +
      `　重点维度：${priority.length > 0 ? `本周体检最低分的 ${priority.map((d) => DIMENSION_LABELS[d]).join(' / ')}` : '本周体检未采到任何维度分数'}。\n` +
      priorLine,
  }
}
