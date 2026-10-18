/**
 * 阶段「检查清单」—— 纯函数，输入事实快照，输出每一项的灯。
 *
 * 设计稿 §4.4。灯有四种：绿 / 黄 / 红 / 灰（灰 = 读不到或太旧，还没核实）。
 * **灰不能当成绿，也不能当成 0。** 花钱相关的「硬门」：红或灰 → 不能批准。
 * 软门的灰/黄可以批准，但批准按钮旁会写明「N 项未核实」。
 *
 * 词表是封闭的（GATE_KEYS），来源是 client-promo-readiness 的三道门（工具 / 节奏 / 内容）。
 * 每项带 evidence：它只标注证据成熟度，**不改变硬门 / 软门身份**——
 * 账户可用、预算上限、素材批准、落地页真实这些花钱相关的项始终是硬门。
 *
 * 平台通用：不含客户名 / 行业词；阈值来自 PromoPlaybook。
 */

import type { PromoPlaybook, PromoEvidence } from './playbooks'
import { checkAdsBudget, type AccountCapFacts } from './budget-caps'
import { promoContentHash } from './content-hash'
import { allAdsSteps, type ManualCheck, type PromoPhase, type PromoSpec } from './spec'

export type Light = 'green' | 'yellow' | 'red' | 'gray'
export type GateGroup = 'tool' | 'rhythm' | 'content'

export const GATE_KEYS = [
  'ads.account_usable',
  'ads.cap_set',
  'ads.result_defined',
  'ads.creative_approved',
  'ads.budget_within_caps',
  'landing.item_live',
  'social.cadence_scheduled',
  'content.wording_permission',
] as const
export type GateKey = (typeof GATE_KEYS)[number]

/** 人工核实项：读不到，必须由 FDE 在计划里点「已核实」。 */
export const MANUAL_GATE_KEYS: readonly GateKey[] = ['landing.item_live', 'content.wording_permission']

export interface GateResult {
  key: GateKey
  group: GateGroup
  label: string
  hard: boolean
  light: Light
  /** 一句中文：现在是什么状态 */
  reason: string
  /** 一句中文：不是绿的时候，具体怎么办（给 FDE，不用再问第二遍） */
  how: string
  evidence: PromoEvidence
  /** 取数时间（ISO），人工核实项为核实时间；没有 = null */
  as_of: string | null
  /** 这条结果属于哪个阶段（批准前评估多阶段时补上） */
  phase_id?: string
  phase_name?: string
}

export interface AccountSnapshotFact {
  /** Meta account_status：1 = ACTIVE */
  account_status: number | null
  captured_at: string | null
}

export interface CreativePoolFact {
  ref: string
  status: 'candidate' | 'approved'
}

/** 事实快照。任何 null 都表示「没读到」，不是 0。 */
export interface GateFacts {
  /** 今天（账户时区的日期；时区读不到就是 UTC 日期，调用方负责标注） */
  today: string
  now: Date
  playbook: PromoPlaybook
  accounts: AccountCapFacts[]
  snapshots: Record<string, AccountSnapshotFact>
  /** ad_strategy_configs 读出的三项；整个读失败 = null */
  config: {
    daily_budget_cap_cents: number | null
    primary_result: string | null
    creative_pool: CreativePoolFact[]
  } | null
  /** 每日计划从今天起往后连续排了几天；读不到 = null */
  daily_plan_coverage_days: number | null
  /**
   * 计划批准后内容被锁，后面阶段的人工核实记录写在服务端的 generation_meta 里（不在 plan_data），
   * 这里与计划里自带的 checks 合并，同一项取最近一次。
   */
  manual_checks: ManualCheck[]
}

const EVIDENCE: PromoEvidence = 'unvalidated_default'

function ageDays(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.floor((now.getTime() - t) / 86_400_000)
}

function make(
  key: GateKey, group: GateGroup, label: string, hard: boolean,
  light: Light, reason: string, how: string, as_of: string | null = null,
): GateResult {
  return { key, group, label, hard, light, reason, how, evidence: EVIDENCE, as_of }
}

function phaseAdsSteps(phase: PromoPhase) {
  return phase.steps.flatMap(s => (s.kind === 'ads_campaign' ? [s] : []))
}

function accountUsable(phase: PromoPhase, f: GateFacts): GateResult[] {
  const steps = phaseAdsSteps(phase)
  if (steps.length === 0) return []
  const ids = [...new Set(steps.map(s => s.settings.ad_account_id))]
  const worst: { light: Light; reason: string; as_of: string | null }[] = ids.map(id => {
    const acc = f.accounts.find(a => a.ad_account_id === id)
    if (!acc || !acc.owned_by_client) return { light: 'red' as Light, reason: `广告账户 ${id} 不属于这个客户`, as_of: null }
    const snap = f.snapshots[id]
    if (!snap || snap.captured_at === null) return { light: 'gray' as Light, reason: `广告账户 ${id} 还没有设置快照，状态未核实`, as_of: null }
    const age = ageDays(snap.captured_at, f.now)
    if (age === null || age > f.playbook.factFreshnessDays) {
      return { light: 'gray' as Light, reason: `广告账户 ${id} 的快照已 ${age ?? '?'} 天没更新，状态未核实`, as_of: snap.captured_at }
    }
    if (snap.account_status !== 1) return { light: 'red' as Light, reason: `广告账户 ${id} 当前不是可投放状态（状态码 ${snap.account_status ?? '未知'}）`, as_of: snap.captured_at }
    return { light: 'green' as Light, reason: `广告账户 ${id} 可用`, as_of: snap.captured_at }
  })
  const order: Light[] = ['red', 'gray', 'yellow', 'green']
  const pick = order.map(l => worst.find(w => w.light === l)).find(Boolean)!
  return [make('ads.account_usable', 'tool', '广告账户可用', true, pick.light, pick.reason,
    '在广告账户设置里确认账户状态正常，或等设置快照同步后再看。', pick.as_of)]
}

function configChecks(phase: PromoPhase, f: GateFacts): GateResult[] {
  if (phaseAdsSteps(phase).length === 0) return []
  const cfg = f.config
  const out: GateResult[] = []
  out.push(!cfg
    ? make('ads.cap_set', 'tool', '广告日预算上限已设置', true, 'gray', '广告设置读不出来，上限未核实', '稍后重试；持续读不出来请找开发。')
    : cfg.daily_budget_cap_cents === null
      ? make('ads.cap_set', 'tool', '广告日预算上限已设置', true, 'red', '客户的广告日预算上限还没设置', '在广告设置里填写日预算上限。')
      : make('ads.cap_set', 'tool', '广告日预算上限已设置', true, 'green', `日预算上限 ${cfg.daily_budget_cap_cents} 分`, ''))
  out.push(!cfg
    ? make('ads.result_defined', 'tool', '「一条结果」口径已定', true, 'gray', '广告设置读不出来，结果口径未核实', '稍后重试；持续读不出来请找开发。')
    : cfg.primary_result === null || cfg.primary_result === ''
      ? make('ads.result_defined', 'tool', '「一条结果」口径已定', true, 'red', '还没有定义广告的主结果口径', '在广告设置里选定主结果（例如询盘 / 私信）。')
      : make('ads.result_defined', 'tool', '「一条结果」口径已定', true, 'green', `主结果口径：${cfg.primary_result}`, ''))

  const refs = phaseAdsSteps(phase).flatMap(s => s.settings.creative_refs)
  if (!cfg) {
    out.push(make('ads.creative_approved', 'content', '投放素材已批准', true, 'gray', '素材池读不出来，素材未核实', '稍后重试。'))
  } else if (refs.length === 0) {
    out.push(make('ads.creative_approved', 'content', '投放素材已批准', true, 'red', '广告步骤没有指定素材', '在步骤里填写已批准的素材。'))
  } else {
    const bad = refs.filter(r => cfg.creative_pool.find(p => p.ref === r)?.status !== 'approved')
    out.push(bad.length === 0
      ? make('ads.creative_approved', 'content', '投放素材已批准', true, 'green', `${refs.length} 个素材均已批准`, '')
      : make('ads.creative_approved', 'content', '投放素材已批准', true, 'red', `${bad.length} 个素材不在素材池或还没批准：${bad.join('、')}`, '在广告审批页批准素材，或从步骤里去掉。'))
  }
  return out
}

function budgetCheck(phase: PromoPhase, f: GateFacts): GateResult[] {
  if (phaseAdsSteps(phase).length === 0) return []
  const res = checkAdsBudget(phaseAdsSteps(phase), f.accounts, f.config?.daily_budget_cap_cents ?? null)
  const how = '核对各广告账户的日预算和上限；币种不一致时需要人工确认。'
  if (res.verdict === 'over') return [make('ads.budget_within_caps', 'tool', '日预算不超上限', true, 'red', res.reasons.join('；'), how)]
  if (res.verdict === 'unknown') return [make('ads.budget_within_caps', 'tool', '日预算不超上限', true, 'gray', res.reasons.join('；'), how)]
  // 通过，但已在投放的预算没纳入 → 黄（不阻止批准，提醒人工对照）
  return [make('ads.budget_within_caps', 'tool', '日预算不超上限', true, 'yellow', `本计划日预算未超上限；${res.notes.join('')}`, '批准前对照广告账户当前预算。')]
}

function manualChecks(spec: PromoSpec, phase: PromoPhase, f: GateFacts): GateResult[] {
  if (phaseAdsSteps(phase).length === 0) return []
  const defs: { key: GateKey; group: GateGroup; label: string; hard: boolean; how: string }[] = [
    { key: 'landing.item_live', group: 'content', label: '要推的东西在落地页真实存在', hard: true,
      how: '打开落地页逐项核对商品 / 日期 / 价格与官网一致，核对完在计划里点「已核实」。' },
    { key: 'content.wording_permission', group: 'content', label: '对外措辞已获客户同意', hard: false,
      how: '把稀缺性 / 截止日等说法发给客户确认，确认后在计划里点「已核实」。' },
  ]
  // 核实记录绑内容版本：内容一改，旧核实自动失效（content_hash 对不上就不算数）。
  const currentHash = promoContentHash(spec)
  return defs.map(d => {
    const all = f.manual_checks // 只信服务端写入的核实记录（spec.checks 是客户端可写的，不参与判定）
      .filter(c => c.phase_id === phase.id && c.check_key === d.key)
    const valid = all.filter(c => c.content_hash === currentHash)
    const rec = valid.sort((a, b) => b.verified_at.localeCompare(a.verified_at))[0]
    if (!rec) {
      if (all.length > 0) {
        return make(d.key, d.group, d.label, d.hard, 'gray', '计划内容在核实之后改过（或这条核实没有记录内容版本），需要重新核实', d.how)
      }
      return make(d.key, d.group, d.label, d.hard, 'gray', '还没有人核实', d.how)
    }
    const age = ageDays(rec.verified_at, f.now)
    if (age === null || age > f.playbook.factFreshnessDays * 4) {
      return make(d.key, d.group, d.label, d.hard, 'gray', `核实记录已过期（${rec.verified_at.slice(0, 10)} 由 ${rec.verified_by} 核实）`, d.how, rec.verified_at)
    }
    return make(d.key, d.group, d.label, d.hard, 'green', `${rec.verified_at.slice(0, 10)} 由 ${rec.verified_by} 核实`, '', rec.verified_at)
  })
}

function cadenceCheck(phase: PromoPhase, f: GateFacts): GateResult[] {
  if (!phase.steps.some(s => s.kind === 'social_cadence')) return []
  const how = '在每日计划里把接下来的内容排满。'
  const min = f.playbook.cadenceCoverageMinDays
  const days = f.daily_plan_coverage_days
  if (days === null) return [make('social.cadence_scheduled', 'rhythm', '社媒节奏已排', false, 'gray', '每日计划读不出来，节奏未核实', how)]
  if (days >= min) return [make('social.cadence_scheduled', 'rhythm', '社媒节奏已排', false, 'green', `每日计划已排到往后 ${days} 天`, '')]
  return [make('social.cadence_scheduled', 'rhythm', '社媒节奏已排', false, 'yellow', `每日计划只排到往后 ${days} 天，少于 ${min} 天`, how)]
}

/** 某一阶段的全部检查项（只包含这个阶段用得上的）。 */
export function evaluatePhaseGates(spec: PromoSpec, phase: PromoPhase, f: GateFacts): GateResult[] {
  return [
    ...accountUsable(phase, f),
    ...configChecks(phase, f),
    ...budgetCheck(phase, f),
    ...manualChecks(spec, phase, f),
    ...cadenceCheck(phase, f),
  ]
}

const SEVERITY: Record<Light, number> = { green: 0, yellow: 1, gray: 2, red: 3 }

export function worstLight(results: readonly GateResult[]): Light {
  return results.reduce<Light>((w, r) => (SEVERITY[r.light] > SEVERITY[w] ? r.light : w), 'green')
}

/** 阻止批准的项：硬门且红或灰。 */
export function blockers(results: readonly GateResult[]): GateResult[] {
  return results.filter(r => r.hard && (r.light === 'red' || r.light === 'gray'))
}

/** 不阻止但需要提醒的项：软门灰 / 黄、硬门黄。 */
export function unverified(results: readonly GateResult[]): GateResult[] {
  return results.filter(r => !blockers(results).includes(r) && (r.light === 'gray' || r.light === 'yellow'))
}

/** 时间最早的阶段 = 「第一阶段」。 */
export function firstPhase(spec: PromoSpec): PromoPhase {
  return [...spec.phases].sort((a, b) => a.start_date.localeCompare(b.start_date))[0]
}

/** YYYY-MM-DD 加 n 天（用 Date.UTC 计算，避免依赖 reconcile.ts 造成循环引用）。 */
function addDaysIso(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/**
 * 批准前要评估的阶段 = 第一阶段 ∪ 所有含广告步骤的阶段。
 * 按 start_date 升序，按 id 去重。
 */
export function approvalPhases(spec: PromoSpec): PromoPhase[] {
  const first = firstPhase(spec)
  const picked = spec.phases.filter(p => p.id === first.id || phaseAdsSteps(p).length > 0)
  const seen = new Set<string>()
  return picked
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)))
}

export interface PhaseVerdict {
  phase_id: string
  phase_name: string
  /** 是否到期：第一阶段，或 start_date <= today + factFreshnessDays。只有到期阶段阻塞批准。 */
  due: boolean
  results: GateResult[]
}

export interface ApprovalVerdict {
  can_approve: boolean
  blockers: GateResult[]
  unverified: GateResult[]
  /** 所有被评估阶段的全部检查结果（含绿色通过项），供批准回执留底 */
  results: GateResult[]
  /** 每个被评估阶段一条 */
  per_phase: PhaseVerdict[]
  /** 未到期阶段里的硬门红 / 灰项（已带 phase_id / phase_name），开始前必须补齐 */
  deferred_blockers: GateResult[]
  /** 计划里有广告预算却没有任何广告步骤等情况下的说明 */
  note: string | null
}

/**
 * 批准计划前的检查：评估第一阶段 ∪ 所有含广告步骤的阶段。
 *
 * 但**只有「到期阶段」阻塞批准**：一个阶段若是第一阶段，或 start_date <= today + factFreshnessDays 天，
 * 就算到期。更晚的阶段不阻塞，它的硬门红 / 灰项放进 deferred_blockers（开始前必须补齐）——
 * 三个月后的素材今天不存在，若让它们阻塞，计划永远批不了。
 *
 * 这不是花钱授权：批准只会派出内部待办、广告只建暂停草稿，真正开投仍要 PM 在广告审批页再点一次。
 */
export function evaluateApproval(spec: PromoSpec, f: GateFacts): ApprovalVerdict {
  const first = firstPhase(spec)
  const dueLimit = addDaysIso(f.today, f.playbook.factFreshnessDays)
  const phases = approvalPhases(spec)

  const per_phase: PhaseVerdict[] = phases.map(phase => {
    // 已结束的阶段（结束日早于今天）不再评估：它的核实早过期，留着只会让后面的周盖章永久卡死
    const ended = phase.end_date < f.today
    const due = !ended && (phase.id === first.id || phase.start_date <= dueLimit)
    const results = evaluatePhaseGates(spec, phase, f).map(r => ({ ...r, phase_id: phase.id, phase_name: phase.name }))
    return { phase_id: phase.id, phase_name: phase.name, due, results }
  })

  const results = per_phase.flatMap(p => p.results)
  const dueResults = per_phase.filter(p => p.due).flatMap(p => p.results)
  const endedIds = new Set(phases.filter(ph => ph.end_date < f.today).map(ph => ph.id))
  const deferredResults = per_phase.filter(p => !p.due && !endedIds.has(p.phase_id)).flatMap(p => p.results)
  const b = blockers(dueResults)

  return {
    can_approve: b.length === 0,
    blockers: b,
    unverified: unverified(dueResults),
    results,
    per_phase,
    deferred_blockers: blockers(deferredResults),
    note: allAdsSteps(spec).length === 0 ? '计划里没有广告步骤，只检查了社媒与内容项。' : null,
  }
}
