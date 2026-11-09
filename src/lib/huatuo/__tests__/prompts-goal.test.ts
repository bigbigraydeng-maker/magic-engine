/**
 * DAPE Week 2 W4 — huatuo prompts: Goal 注入测试
 *
 * 测试覆盖:
 *  - 无 goal 时回退 legacy 模式 (3 阶段)
 *  - 有 goal 时计算总周数 + 注入 phases 时长约束
 *  - intent 推荐 Initiative 类型
 *  - prompt 包含动态 N 阶段约束 (不写死 3)
 *  - prompt 包含 initiative_seed schema 提示
 */

import { describe, it, expect } from 'vitest'
import {
  buildHuatuoGenerationPrompt,
  HUATUO_GENERATION_SYSTEM_PROMPT,
} from '../prompts'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { PrescriptionIntake } from '@/types/diagnostic'
import type { HuatuoLookupContext } from '../types'
import type { GoalRow } from '@/types/strategy'

const DISCOVERY: DiscoveryReport = {
  domain: 'example.com.au',
  business: {
    name: 'Example Co',
    industry: ['real_estate'],
    location: { city: 'Brisbane', country: 'AU' },
  } as DiscoveryReport['business'],
  diagnosis: undefined,
} as DiscoveryReport

const INTAKE: PrescriptionIntake = {
  business_goal: '增长',
  timeline_urgency: 'short_term',
  monthly_budget_aud: 3000,
  priority_dimensions: [],
  notes: null,
}

const LOOKUP: HuatuoLookupContext = {
  benchmarks: { seo: null, social: null, ai_visibility: null, reputation: null } as never,
  industry_category: 'real_estate',
}

function makeGoal(periodDays: number, intent: GoalRow['intent'] = 'acquisition'): GoalRow {
  const start = new Date('2026-06-01')
  const end = new Date(start.getTime() + periodDays * 24 * 60 * 60 * 1000)
  return {
    id: 'goal-1',
    client_id: 'client-1',
    intent,
    awareness_subtype: null,
    sub_type: 'ongoing',
    title: 'Brisbane 月询盘 20→50',
    primary_metric_key: 'leads_count',
    primary_metric_label: '新增线索',
    primary_metric_unit: 'count/mo',
    baseline_value: 20,
    target_value: 50,
    target_direction: 'increase',
    supporting_metrics: [],
    period_start: start.toISOString().slice(0, 10),
    period_end: end.toISOString().slice(0, 10),
    budget_amount: 9000,
    budget_currency: 'AUD',
    status: 'active',
  } as unknown as GoalRow
}

/**
 * goal 现在是第 8 个参数（前面依次是 priorContext / memoryContext / memoryBundle / promptMode）。
 * 这里只关心 Goal 注入，其余上下文一律留空，promptMode 用默认的 long。
 */
function promptWithGoal(goal: GoalRow): string {
  return buildHuatuoGenerationPrompt(DISCOVERY, INTAKE, LOOKUP, undefined, undefined, undefined, 'long', goal)
}

describe('DAPE W4 — system prompt schema', () => {
  it('指示 phases 阶段数不写死 3 (修 BUG-FMT-F19)', () => {
    expect(HUATUO_GENERATION_SYSTEM_PROMPT).toMatch(/阶段数不写死/)
    expect(HUATUO_GENERATION_SYSTEM_PROMPT).toMatch(/不再固定 12 周/)
  })

  it('禁用「止血/建设/护城河」命名 (修 BUG-FMT-F20)', () => {
    expect(HUATUO_GENERATION_SYSTEM_PROMPT).toMatch(/禁用.*止血.*建设.*护城河/)
  })

  it('schema 含 initiative_seed 字段 (修 BUG-FMT-F21)', () => {
    expect(HUATUO_GENERATION_SYSTEM_PROMPT).toMatch(/initiative_seed/)
    expect(HUATUO_GENERATION_SYSTEM_PROMPT).toMatch(/initiative_type/)
    expect(HUATUO_GENERATION_SYSTEM_PROMPT).toMatch(/demand_generation\|conversion_optimization/)
  })
})

describe('buildHuatuoGenerationPrompt + Goal', () => {
  it('无 goal 时显示 legacy 提示', () => {
    const prompt = buildHuatuoGenerationPrompt(DISCOVERY, INTAKE, LOOKUP)
    expect(prompt).toMatch(/未关联 Goal.*legacy/)
  })

  it('Goal 90 天 → 12 周约束注入 prompt', () => {
    const goal = makeGoal(90)
    const prompt = promptWithGoal(goal)
    // ~13 周 (90/7=12.86, round to 13)
    expect(prompt).toMatch(/共 \*\*1[23] 周\*\*/)
    expect(prompt).toMatch(/duration_weeks 之和必须/)
  })

  it('Goal 60 天 → 8-9 周约束', () => {
    const goal = makeGoal(60)
    const prompt = promptWithGoal(goal)
    expect(prompt).toMatch(/共 \*\*[89] 周\*\*/)
  })

  it('intent=acquisition 推荐 demand_generation', () => {
    const goal = makeGoal(90, 'acquisition')
    const prompt = promptWithGoal(goal)
    expect(prompt).toMatch(/acquisition/)
    expect(prompt).toMatch(/demand_generation/)
  })

  it('intent=sales 推荐 demand_generation', () => {
    const goal = makeGoal(90, 'sales')
    const prompt = promptWithGoal(goal)
    expect(prompt).toMatch(/sales/)
    expect(prompt).toMatch(/demand_generation/)
  })

  it('注入 Goal 主指标 + 基线 + 目标', () => {
    const goal = makeGoal(90)
    const prompt = promptWithGoal(goal)
    expect(prompt).toMatch(/Brisbane 月询盘 20→50/)
    expect(prompt).toMatch(/新增线索/)
    expect(prompt).toMatch(/20 → 50/)
  })

  it('短 period 阶段建议 = 2 phases', () => {
    const goal = makeGoal(35)  // 5 周
    const prompt = promptWithGoal(goal)
    expect(prompt).toMatch(/2 phases/)
  })

  it('长 period 阶段建议 = 4-5 phases', () => {
    const goal = makeGoal(120)  // 17 周左右
    const prompt = promptWithGoal(goal)
    expect(prompt).toMatch(/4-5 phases/)
  })

  it('每次调用都强调"至少 1 个 terminal Initiative"', () => {
    const goal = makeGoal(90)
    const prompt = promptWithGoal(goal)
    expect(prompt).toMatch(/至少 1 个 terminal Initiative/)
  })
})
