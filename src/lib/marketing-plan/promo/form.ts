/**
 * 推广计划填表用的纯函数：新增阶段 / 步骤、元和分互转、改写草稿。
 * 草稿允许暂时不完整（空日期、空主题），保存时由服务端统一校验。
 */

import type { PromoPhase, PromoSpec, PromoStep } from './spec'

export type StepKind = PromoStep['kind']

export const STEP_KIND_LABEL: Record<StepKind, string> = {
  ads_campaign: '投广告',
  social_cadence: '发社媒',
  blog_article: '写博客',
  newsletter_email: '发邮件',
}

/** 页面输入的「元」转成「分」；空或非法返回 0（保存时会因预算必须大于 0 被拒绝）。 */
export function yuanToCents(yuan: string): number {
  const n = Number(yuan)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}

export function centsToYuan(cents: number): string {
  return cents > 0 ? String(cents / 100) : ''
}

function nextId(prefix: string, taken: string[]): string {
  let i = taken.length + 1
  while (taken.includes(`${prefix}-${i}`)) i++
  return `${prefix}-${i}`
}

function allStepIds(spec: PromoSpec): string[] {
  return spec.phases.flatMap(p => p.steps.map(s => s.id))
}

export function newStep(kind: StepKind, id: string): PromoStep {
  switch (kind) {
    case 'ads_campaign':
      return { id, kind, settings: { ad_account_id: '', daily_budget_cents: 0, audience_ref: '', creative_refs: [], placements: [], paused_ranges: [] } }
    case 'social_cadence':
      return { id, kind, settings: { posts_per_week: 0, stories_per_week: 0, reels_per_month: 0 } }
    case 'blog_article':
      return { id, kind, settings: { topic: '', primary_keyword: null, due_date: '' } }
    case 'newsletter_email':
      return { id, kind, settings: { topic: '', due_date: '', requires_link: true } }
  }
}

export function addStep(spec: PromoSpec, phaseId: string, kind: StepKind): PromoSpec {
  const step = newStep(kind, nextId('step', allStepIds(spec)))
  return { ...spec, phases: spec.phases.map(p => (p.id === phaseId ? { ...p, steps: [...p.steps, step] } : p)) }
}

export function removeStep(spec: PromoSpec, phaseId: string, stepId: string): PromoSpec {
  return { ...spec, phases: spec.phases.map(p => (p.id === phaseId ? { ...p, steps: p.steps.filter(s => s.id !== stepId) } : p)) }
}

export function updateStep(spec: PromoSpec, phaseId: string, step: PromoStep): PromoSpec {
  return { ...spec, phases: spec.phases.map(p => (p.id === phaseId ? { ...p, steps: p.steps.map(s => (s.id === step.id ? step : s)) } : p)) }
}

export function updatePhase(spec: PromoSpec, phaseId: string, patch: Partial<Pick<PromoPhase, 'name' | 'start_date' | 'end_date'>>): PromoSpec {
  return { ...spec, phases: spec.phases.map(p => (p.id === phaseId ? { ...p, ...patch } : p)) }
}

export function addPhase(spec: PromoSpec): PromoSpec {
  const id = nextId('phase', spec.phases.map(p => p.id))
  const phase: PromoPhase = { id, name: `阶段 ${spec.phases.length + 1}`, start_date: '', end_date: '', steps: [] }
  return { ...spec, phases: [...spec.phases, phase] }
}

/** 至少保留一个阶段（推广计划结构要求 ≥ 1 个阶段）。 */
export function removePhase(spec: PromoSpec, phaseId: string): PromoSpec {
  if (spec.phases.length <= 1) return spec
  return { ...spec, phases: spec.phases.filter(p => p.id !== phaseId) }
}

export function setGoal(spec: PromoSpec, goalId: string): PromoSpec {
  return { ...spec, goal_id: goalId }
}

/** 逗号 / 换行分隔的文本拆成列表，去空去重。 */
export function splitList(text: string): string[] {
  return Array.from(new Set(text.split(/[,\n，]/).map(s => s.trim()).filter(Boolean)))
}
