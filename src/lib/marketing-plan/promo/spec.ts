/**
 * 推广计划结构（PromoSpec）—— 放在 marketing_plans.plan_data.promo 里的可选字段。
 *
 * 设计稿 docs/specs/2026-10-14-promo-plan-board-design-v0.1.md §4.2。
 * 没有 promo 字段的计划就是旧版 Marketing Plan，行为完全不变。
 *
 * 平台通用：这里不出现任何客户名 / 行业词 / 具体天数或金额。
 * 节奏、阈值来自 playbooks.ts（行业剧本），日期金额来自计划实例（客户数据）。
 */

import { z } from 'zod'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const dateStr = z.string().regex(DATE, '日期格式应为 YYYY-MM-DD')

/** 暂停区间（含两端）：对账时这些天不算计划花费。 */
const pausedRange = z.object({ from: dateStr, to: dateStr })

const adsStep = z.object({
  id: z.string().min(1),
  kind: z.literal('ads_campaign'),
  settings: z.object({
    /** 目标广告账户：必须属于这个客户；币种由账户快照解析，解析不到就不放行。 */
    ad_account_id: z.string().min(1),
    /** 日预算，账户币种的「分」。 */
    daily_budget_cents: z.number().int().positive(),
    /** 引用现有受众池 / 配置，不复制。 */
    audience_ref: z.string().min(1),
    /** 引用素材池里已批准素材的 ref。 */
    creative_refs: z.array(z.string().min(1)).default([]),
    placements: z.array(z.string().min(1)).default([]),
    paused_ranges: z.array(pausedRange).default([]),
  }),
})

const socialStep = z.object({
  id: z.string().min(1),
  kind: z.literal('social_cadence'),
  settings: z.object({
    posts_per_week: z.number().int().min(0).default(0),
    stories_per_week: z.number().int().min(0).default(0),
    reels_per_month: z.number().int().min(0).default(0),
  }),
})

const blogStep = z.object({
  id: z.string().min(1),
  kind: z.literal('blog_article'),
  settings: z.object({
    topic: z.string().min(1),
    primary_keyword: z.string().nullable().default(null),
    due_date: dateStr,
  }),
})

const newsletterStep = z.object({
  id: z.string().min(1),
  kind: z.literal('newsletter_email'),
  settings: z.object({
    topic: z.string().min(1),
    due_date: dateStr,
    /** 沿用 Marketing Plan 的硬规则：提到具体产品的信必须放真实链接。 */
    requires_link: z.boolean(),
  }),
})

const step = z.discriminatedUnion('kind', [adsStep, socialStep, blogStep, newsletterStep])

/** FDE 手工核实记录（落地页真实存在、客户已同意措辞等读不到的项）。 */
const manualCheck = z.object({
  phase_id: z.string().min(1),
  check_key: z.string().min(1),
  verified_by: z.string().min(1),
  verified_at: z.string().min(1),
  note: z.string().default(''),
  content_hash: z.string().optional(),
})

/** 每座留存扣掉了哪些成本。至少选一项；「都没扣」用 'none'。 */
const retentionBasis = z.enum(['commission', 'ad_cost', 'fixed_cost', 'none'])

/** 成交率从哪来：measured = 有样本；assumed = 假设（页面标黄，不拦）。 */
const rateSource = z.enum(['measured', 'assumed'])

/**
 * 经营判断卡：每笔广告预算一张，阶段级。
 * 这里只存**填进来的事实**，算出来的（可承受线索成本、保本成交率）不存，由页面按公式现算。
 * 客户数字（留存比例、每单人数、剩余座位）只出现在这里，不进共享常量、不进剧本。
 */
const businessCase = z.object({
  /** 目标团期：`tour_catalog_departures.id` 或人看得懂的「团名 + 出发日」。不校验存在性。 */
  departure_ref: z.string().min(1),
  seats_remaining: z.number().int().min(0),
  /** 这个座位数是不是客户确认过的。false → 检查清单判灰。 */
  seats_confirmed: z.boolean(),
  /** 座位数的取数日期。 */
  seats_as_of: dateStr,
  /** 每座公司留存，账户币种的「分」。 */
  retained_per_seat_cents: z.number().int().positive(),
  /** 这个留存扣掉了什么；至少一项。 */
  retention_basis: z.array(retentionBasis).min(1),
  /** 每单几座（小数，例如 1.74）。 */
  pax_per_booking: z.number().positive(),
  /** 线索→预订成交率，小数（0–1）。 */
  lead_to_booking_rate: z.number().min(0).max(1),
  rate_source: rateSource,
  /** rate_source = 'measured' 时的样本量；assumed 时为 null。 */
  rate_sample_n: z.number().int().min(0).nullable().default(null),
  /** 素材缺口的人工补充说明。 */
  creative_gap_note: z.string().default(''),
  owner: z.string().min(1),
})

/** 实验设计卡：只有 `phase.is_experiment = true` 的阶段才需要。 */
const experimentCard = z.object({
  /** 这一轮要验证什么。 */
  hypothesis: z.string().min(1),
  /** 为了验证它，哪些东西固定不变。 */
  held_constant: z.array(z.string().min(1)).default([]),
  /** 主指标。'qualified_enquiry' 目前系统里没有口径，只当文字记录，算不出数。 */
  primary_metric: z.enum(['enquiry', 'qualified_enquiry', 'booking']),
  /** 最大可承受损失，账户币种的「分」。 */
  max_loss_cents: z.number().int().positive(),
  stop_rule: z.string().min(1),
  continue_rule: z.string().min(1),
  owner: z.string().min(1),
})

/** 销售承接就绪：计划级。填了只是声明，真不真要人在计划里点「已核实」。 */
const salesHandover = z.object({
  owner: z.string().min(1),
  /** 多久之内要有人接触客人（小时）。 */
  response_sla_hours: z.number().int().positive(),
  channels: z.array(z.enum(['phone', 'email', 'dm'])).min(1),
  /** 没人接手时怎么办。 */
  fallback: z.string().min(1),
})

const phase = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  start_date: dateStr,
  end_date: dateStr,
  steps: z.array(step).default([]),
  /**
   * 这个阶段是不是一次实验；true 时 experiment 必填（在 crossFieldIssues 里查）。
   * 用 optional 不用 default(false)：default 会被写进解析结果，
   * 让每一份旧计划的内容指纹都变一次 —— 已批准的计划会被判成「内容变过了」，
   * 人工核实记录也会跟着作废。没填就是没标过实验，按 `=== true` 读。
   */
  is_experiment: z.boolean().optional(),
  business_case: businessCase.optional(),
  experiment: experimentCard.optional(),
})

export const PromoSpecSchema = z.object({
  schema: z.literal('promo_v1'),
  /** 目标真相源：goals.id，必须属于同一个客户（保存时服务端校验）。 */
  goal_id: z.string().min(1),
  phases: z.array(phase).min(1),
  /** 销售承接就绪，计划级。 */
  sales_handover: salesHandover.optional(),
  checks: z.array(manualCheck).default([]),
  /** 批准当时的检查清单快照，事后能说清「批的时候是什么状态」。服务端写入。 */
  gate_snapshot: z.unknown().optional(),
})

export type PromoSpec = z.infer<typeof PromoSpecSchema>
export type PromoPhase = z.infer<typeof phase>
export type PromoStep = z.infer<typeof step>
export type AdsStep = z.infer<typeof adsStep>
export type SocialStep = z.infer<typeof socialStep>
export type ManualCheck = z.infer<typeof manualCheck>
export type BusinessCase = z.infer<typeof businessCase>
export type ExperimentCard = z.infer<typeof experimentCard>
export type SalesHandover = z.infer<typeof salesHandover>

export interface PromoValidationIssue {
  path: string
  message: string
}

export type ParsePromoResult =
  | { ok: true; spec: PromoSpec }
  | { ok: false; issues: PromoValidationIssue[] }

/**
 * 校验并解析。畸形输入一律 ok:false —— 调用方按「未批准」处理（fail closed）。
 * 除了字段形状，还查跨字段规则：阶段 / 步骤编号唯一、日期先后、阶段不重叠、
 * 步骤日期落在所属阶段内、人工核实记录指向存在的阶段。
 */
export function parsePromoSpec(raw: unknown): ParsePromoResult {
  const parsed = PromoSpecSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    }
  }
  const issues = crossFieldIssues(parsed.data)
  return issues.length > 0 ? { ok: false, issues } : { ok: true, spec: parsed.data }
}

function crossFieldIssues(spec: PromoSpec): PromoValidationIssue[] {
  const issues: PromoValidationIssue[] = []
  const phaseIds = new Set<string>()
  const stepIds = new Set<string>()

  spec.phases.forEach((p, pi) => {
    if (phaseIds.has(p.id)) issues.push({ path: `phases.${pi}.id`, message: `阶段编号重复：${p.id}` })
    phaseIds.add(p.id)
    if (p.end_date < p.start_date) {
      issues.push({ path: `phases.${pi}.end_date`, message: '阶段结束日早于开始日' })
    }
    if (p.is_experiment && p.experiment === undefined) {
      issues.push({ path: `phases.${pi}.experiment`, message: '这个阶段标了「做实验」，必须填实验设计卡' })
    }
    p.steps.forEach((s, si) => {
      if (stepIds.has(s.id)) issues.push({ path: `phases.${pi}.steps.${si}.id`, message: `步骤编号重复：${s.id}` })
      stepIds.add(s.id)
      if (s.kind === 'blog_article' || s.kind === 'newsletter_email') {
        const due = s.settings.due_date
        if (due < p.start_date || due > p.end_date) {
          issues.push({ path: `phases.${pi}.steps.${si}.settings.due_date`, message: '步骤日期不在所属阶段内' })
        }
      }
      if (s.kind === 'ads_campaign') {
        s.settings.paused_ranges.forEach((r, ri) => {
          if (r.to < r.from) {
            issues.push({ path: `phases.${pi}.steps.${si}.settings.paused_ranges.${ri}`, message: '暂停区间结束日早于开始日' })
          }
        })
      }
    })
  })

  // 阶段按时间排序后不得重叠（同一天不能属于两个阶段，否则「当前阶段」说不清）
  const sorted = [...spec.phases].sort((a, b) => a.start_date.localeCompare(b.start_date))
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start_date <= sorted[i - 1].end_date) {
      issues.push({ path: 'phases', message: `阶段 ${sorted[i - 1].id} 与 ${sorted[i].id} 日期重叠` })
    }
  }

  spec.checks.forEach((c, ci) => {
    if (!phaseIds.has(c.phase_id)) {
      issues.push({ path: `checks.${ci}.phase_id`, message: `核实记录指向不存在的阶段：${c.phase_id}` })
    }
  })
  return issues
}

/** 取出计划里的推广结构；没有或畸形都返回 null（旧计划 / 不放行）。 */
export function readPromoSpec(planData: unknown): PromoSpec | null {
  if (!planData || typeof planData !== 'object') return null
  const raw = (planData as { promo?: unknown }).promo
  if (raw === undefined || raw === null) return null
  const res = parsePromoSpec(raw)
  return res.ok ? res.spec : null
}

/** 计划里是否声明了推广结构（不管是否合法）。 */
export function hasPromoField(planData: unknown): boolean {
  if (!planData || typeof planData !== 'object') return false
  const raw = (planData as { promo?: unknown }).promo
  return raw !== undefined && raw !== null
}

export function allAdsSteps(spec: PromoSpec): { phase: PromoPhase; step: AdsStep }[] {
  const out: { phase: PromoPhase; step: AdsStep }[] = []
  for (const phase of spec.phases) {
    for (const s of phase.steps) if (s.kind === 'ads_campaign') out.push({ phase, step: s })
  }
  return out
}

/** 按日期找阶段；落在阶段之间的空档返回 null。 */
export function phaseOnDate(spec: PromoSpec, date: string): PromoPhase | null {
  return spec.phases.find(p => date >= p.start_date && date <= p.end_date) ?? null
}

/** 第一个还没结束的阶段（今天及以后）；全部结束返回 null。 */
export function nextPhaseFrom(spec: PromoSpec, date: string): PromoPhase | null {
  const sorted = [...spec.phases].sort((a, b) => a.start_date.localeCompare(b.start_date))
  return sorted.find(p => p.end_date >= date) ?? null
}

export function findStep(spec: PromoSpec, phaseId: string, stepId: string): PromoStep | null {
  const phase = spec.phases.find(p => p.id === phaseId)
  return phase?.steps.find(s => s.id === stepId) ?? null
}
