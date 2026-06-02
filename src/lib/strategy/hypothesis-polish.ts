/**
 * Phase 31 M3 — Initiative Hypothesis 诸葛亮润色
 *
 * 诸葛亮 (Claude Sonnet) 接收 FDE 写的粗糙 hypothesis + 上下文（Goal/Initiative/客户），
 * 输出更紧凑、可在 90 天后归因时验证的版本。
 *
 * 设计原则：
 *   - 不增加新信息（不基于 AI 训练数据猜行业现状）
 *   - 不改 FDE 的核心判断（押什么、为什么押）
 *   - 只润色表达：把"客户老板想拿下春节"→"押注：春节档对 Wendy Wu 同源词的转化率提升 ≥30%"
 *   - 输出结构：3 段（动作 / 假设 / 90 天验证标准）
 */

import { callClaudeWithDocs } from '@/lib/anthropic/client'
import type {
  InitiativeRow,
  GoalRow,
  InitiativeType,
} from '@/types/strategy'
import { INITIATIVE_TYPE_LABEL } from '@/types/strategy'

interface PolishContext {
  goal: Pick<GoalRow,
    'intent' | 'title' | 'primary_metric_label' | 'baseline_value' | 'target_value'
    | 'primary_metric_unit' | 'period_start' | 'period_end' | 'fde_reasoning'
  >
  initiative: {
    initiative_type: InitiativeType
    title: string
    posture: InitiativeRow['posture']
    budget_percent: number | null
    budget_amount: number | null
    budget_currency: string | null
  }
  rawHypothesis: string
  clientName: string
  clientIndustry?: string | null
  clientCity?: string | null
}

export interface PolishResult {
  ok: boolean
  polished?: string
  error?: string
  cost_usd?: number
}

const SYSTEM_PROMPT = `你是"诸葛亮"，Magic Engine 的 Strategy Conductor — 策略调度 AI。

本次任务：把 FDE 粗写的 Initiative hypothesis 润色成 90 天后可归因验证的紧凑表达。

绝对原则（按重要性排序）：
1. **不增加新信息**：禁止凭训练数据猜竞品现状、行业数据、市场趋势。FDE 没说的不能编。
2. **不改核心判断**：FDE 押什么、为什么押，原句意思必须保留。
3. **只润色表达**：让 90 天后回头看时，假设是否被验证一目了然。
4. **输出中文**：与 FDE 母语对齐。
5. **不写废话**：不要"在当下竞争激烈的市场环境中"这种填充词。

输出结构（严格 3 段，每段 1-3 句）：

**动作**：这条 Initiative 具体做什么（FDE 选的 type + posture + 关键执行方向）

**假设**：FDE 押注的核心因果链（"如果做 X，预期 Y 发生，因为 Z"）

**90 天验证**：什么样的指标变化算"假设被验证"，什么样算"被推翻"

输出格式：只输出润色后的文本（包含 3 个 markdown 二级标题 \`### 动作 / ### 假设 / ### 90 天验证\`）。
不要前言、不要 "Here's the polished version" 之类的废话。
`

export async function polishHypothesis(ctx: PolishContext): Promise<PolishResult> {
  if (!ctx.rawHypothesis?.trim()) {
    return { ok: false, error: 'rawHypothesis is empty' }
  }

  const initLabel = INITIATIVE_TYPE_LABEL[ctx.initiative.initiative_type]
  const initLabelStr = initLabel ? `${initLabel.zh} (${initLabel.en})` : ctx.initiative.initiative_type

  const userMessage = `# 客户
${ctx.clientName}${ctx.clientIndustry ? ` · ${ctx.clientIndustry}` : ''}${ctx.clientCity ? ` · ${ctx.clientCity}` : ''}

# 上下文 Goal
- 标题: ${ctx.goal.title}
- Intent: ${ctx.goal.intent}
- 主指标: ${ctx.goal.primary_metric_label} (${ctx.goal.primary_metric_unit ?? ''})
- Baseline → Target: ${ctx.goal.baseline_value} → ${ctx.goal.target_value}
- 周期: ${ctx.goal.period_start} → ${ctx.goal.period_end}
${ctx.goal.fde_reasoning ? `- FDE Goal Reasoning: ${ctx.goal.fde_reasoning}` : ''}

# 这条 Initiative
- 类型: ${initLabelStr}
- 标题: ${ctx.initiative.title}
- 战术姿态: ${ctx.initiative.posture ?? '(未指定)'}
- 预算: ${ctx.initiative.budget_percent ?? '?'}% (${ctx.initiative.budget_amount ? `${ctx.initiative.budget_currency} ${ctx.initiative.budget_amount.toLocaleString()}` : '金额未设'})

# FDE 原文 hypothesis (待润色)
${ctx.rawHypothesis.trim()}

---

按你的 system prompt 规则润色。输出 3 段 markdown。`

  try {
    const result = await callClaudeWithDocs({
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      maxOutputTokens: 1500,  // hypothesis 短，不需要长输出
    })

    return {
      ok: true,
      polished: result.text.trim(),
      cost_usd: result.cost_usd,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return { ok: false, error: `Claude polish failed: ${msg}` }
  }
}
