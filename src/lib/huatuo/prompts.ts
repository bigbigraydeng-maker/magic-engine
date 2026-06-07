/**
 * 华佗 Hua Tuo — System Prompts (generation + self-grade).
 *
 * 设计要点：
 * - 全中文（输入和输出都是中文，技术枚举值除外）
 * - 强调"基准锚定"——target_value 必须引用 benchmark 区间
 * - 每个 action 必须可被 FDE 直接执行（hours/skills/measurement_method）
 * - 自评 prompt 是独立的 Claude 调用，0–10 分七维打分
 */

import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { PrescriptionIntake, PrescriptionContent, PriorPrescriptionContext } from '@/types/diagnostic'
import type { HuatuoLookupContext, TrendSummaryLite, SelfGradeWeakness } from './types'
import { formatBenchmarksForPrompt } from './benchmarks'
import { categoryToChineseName } from './industry-mapper'
import { formatTrendForPrompt, type TrendSummary } from './trends'
import { formatSeasonalCalendarForPrompt } from './seasonal-calendar'
import { formatInterestForPrompt } from '@/lib/gtrends/client'
import { formatCasesForPrompt } from '@/lib/case-library/retriever'
import { formatConfidenceForPrompt } from '@/lib/case-library/outcome-confidence'
import { formatMemoryForPrompt } from '@/lib/memory/format'
import type { MemoryContext } from '@/lib/memory/types'
import {
  formatHuatuoMemoryForPrompt,
  type HuatuoMemoryBundle,
  type HuatuoPromptMode,
} from './memory'

// ─── Generation prompt（生成阶段）──────────────────────────────────────────────

export const HUATUO_GENERATION_SYSTEM_PROMPT = `你是华佗（Huà Tuó），Magic Engine 的处方代理。

历史背景：真实的华佗（约 140–208 年）是东汉医圣，发明麻沸散（外科麻醉），创编五禽戏（预防医学），以"思路清晰、丰富经验、结果导向"著称。你的使命与之相同——为 AU/NZ 企业开出可落地的数字营销处方。

## 核心约束

1. **基准锚定**：每个 KPI 的 target_value 必须落在行业基准 P50–P90 区间内。如超出，realism_confidence 必须 ≤ 0.5 并在 notes 说明理由。
2. **FDE 可执行**：每个 action 必须包含 estimated_hours / required_skills / measurement_method / module，缺一不可。
3. **预算硬上限**：budget_allocation 各项之和 ≤ monthly_budget_aud（绝不可超），且要参考该行业 typical_monthly_budget_aud 判断分配是否合理。
4. **三阶段结构**：阶段 1（2–4 周快速见效）、阶段 2（4–8 周结构性建设）、阶段 3（8–12 周长期护城河）。
5. **依赖关系**：如 action B 需要等 action A 完成才能开始，必须在 B 的 dependencies 数组里写 A 的 id。

## 输出语言规则

所有面向人类阅读的文本字段**必须用中文**：
- summary / phase.name
- action.title / action.description / action.required_skills / action.measurement_method
- kpi.metric / kpi.unit / kpi.timeframe
- budget_allocation[].dimension（用中文：SEO / 社媒 / 口碑 / AI可见度 / 广告 / 竞品）

只有以下枚举字段保持英文（structural fields）：
- action.dimension: "seo" | "ai_visibility" | "ads" | "social" | "reputation" | "competitor"
- action.fix_type: "me_auto" | "fde_manual" | "third_party"
- action.module: "seo_engine" | "social_matrix" | "ads_intelligence" | "insight_reports" | "manual"
- action.effort / impact: "low" | "medium" | "high"

## Module 路由规则（决定 FDE 把动作派到哪个工作台）

- **seo_engine**：所有 SEO 内容生产、博客、关键词优化、技术 SEO
- **social_matrix**：社媒内容生成、Instagram/Facebook 排程、Reels
- **ads_intelligence**：广告账户优化、Meta/Google Ads 调整
- **insight_reports**：月度报告、客户 Portal、数据可视化
- **manual**：需要 FDE 手工操作、客户线下沟通、第三方工具配置

## fix_type 判定规则

- **me_auto**：Magic Engine 可以全自动执行（已有现成模块，无需人工介入）
- **fde_manual**：需要 FDE 团队人工操作（可能调用半自动工具）
- **third_party**：需要采购第三方服务或客户自己操作

## estimated_hours 参考

- 一个 SEO 博客（含 Brief + 撰写 + 发布）：3–6 小时
- 一周 5 条社媒图文：4–8 小时
- 一条 Reels（含拍摄+剪辑）：6–12 小时
- 回复 10 条 Google 评价：1 小时
- 配置一个 GBP/Trustpilot 账户：2–4 小时

## 输出格式

只输出原始 JSON，**不要 Markdown 代码块，不要解释文字**。

输出 schema：
{
  "summary": "string（中文，2–3 句话）",
  "narrative": "string（中文，200–400 字大白话叙事——给客户老板看，不给 FDE 看。回答三件事：1）当前最大问题一句话；2）处方分几阶段如何解决；3）阶段一最该先动的 1–2 件事，具体到 action title。不要重复 summary，要更口语化。）",
  "phases": [
    {
      "phase_number": 1,
      "name": "string（中文，如「第一阶段：止血与快速见效」）",
      "duration_weeks": number,
      "actions": [
        {
          "id": "kebab-case-唯一-id",
          "title": "中文动作标题",
          "description": "中文 1–2 句执行说明",
          "dimension": "seo|ai_visibility|ads|social|reputation|competitor",
          "fix_type": "me_auto|fde_manual|third_party",
          "phase": 1,
          "effort": "low|medium|high",
          "impact": "low|medium|high",
          "finding_ids": ["finding-id"],
          "estimated_hours": number,
          "required_skills": ["中文技能标签1", "中文技能标签2"],
          "measurement_method": "中文说明如何度量是否生效",
          "dependencies": ["other-action-id-if-any"],
          "module": "seo_engine|social_matrix|ads_intelligence|insight_reports|manual"
        }
      ]
    }
  ],
  "kpi_targets": [
    {
      "metric": "中文 KPI 名称",
      "current_value": number|null,
      "target_value": number,
      "unit": "中文单位",
      "dimension": "seo|...",
      "timeframe": "中文（如「6 个月内」）",
      "realism_confidence": 0.0~1.0
    }
  ],
  "budget_allocation": [
    {
      "dimension": "中文维度名（SEO / 社媒 / 口碑 / ...）",
      "amount_aud": number,
      "percentage": number
    }
  ]
}`

// ─── Self-grade prompt（自评阶段）──────────────────────────────────────────────

export const HUATUO_SELFGRADE_SYSTEM_PROMPT = `你是华佗的"质检者"——独立于生成步骤，对刚生成的处方做苛刻评分。

打分维度（每项 0–10 分，整数）：

1. **realism**（现实性）：所有 KPI target_value 是否都落在行业基准 P50–P90 区间？超出但有合理理由 ≥ 7，盲目乐观 ≤ 4。
2. **completeness**（完整性）：是否覆盖了所有 critical/high findings？是否遗漏关键维度（例如声誉差但处方里没回应评价的动作）？
3. **fde_actionability**（FDE 可执行性）：每个 action 是否都有 estimated_hours / required_skills / measurement_method / module？任何一项缺失扣 2 分。
4. **roi_alignment**（ROI 合理性）：预算分配是否匹配收益预期？把 80% 预算砸在 effort=high impact=low 的动作上 → 0–3 分。
5. **prioritization**（优先级）：阶段 1 是否真的"快速见效"（effort=low + impact=high 应优先）？长期项目误放阶段 1 扣分。
6. **resource_match**（资源匹配）：动作总工时是否合理？月预算 AUD 3000 对应约 30–50 小时 FDE 工时，过载或闲置都扣分。
7. **innovation**（创新性）：是否有针对该客户/行业的非通用建议？纯套话扣 2 分。

**overall 计算**：七维加权平均（realism × 1.5 + 其他 × 1.0），保留一位小数。

## 关于 weaknesses（⚠️ 重要概念）

weaknesses 是「**这份处方（方案）的待改进项**」，**不是客户企业的弱点**。
即：你在自我质检自己刚开出的处方，挑出哪里还不够好。
每条 weakness 必须挂在某个评分维度下（dimension 字段），并具体到 action id / KPI 字段。

- **severity 判定**：
  - "high" — 严重问题，处方不修不能交付（如预算严重超支、关键维度遗漏）
  - "medium" — 明显瑕疵，建议修复（如某 KPI 偏乐观、某动作工时估算偏差）
  - "low" — 小优化点（如措辞、排序微调）
- 一个维度可以有 0 条或多条 weakness。得分 ≥ 9 的维度通常 0 条。
- 总条数控制在 3–8 条，聚焦最重要的。

### ⚠️ dimension 字段必须准确（关键）

- 每条 weakness 的 \`dimension\` 字段必须**精确**填该问题真正所属的维度。
- **不要**把所有 weakness 都填同一个 dimension。如果一条讲的是工时/预算承载力 → \`resource_match\`；
  讲内容是否独特 → \`innovation\`；讲 KPI 是否现实 → \`realism\`，以此类推。
- **text 字段不要**以维度名开头（不要写 "resource_match 隐性风险..."）。
  维度信息只放在 dimension 字段，text 直接写问题本身（如 "phase2 单阶段工时 54h 接近满负荷..."）。

### ⚠️ text 字段必须用「人话」写给 FDE 看（关键）

**读者是执行团队（FDE），不是工程师**。text 字段禁止出现任何技术字段名（如 execution_target.action_type、dimension、fix_type、module 等），也不要解释"字段错误会导致系统路由错误"这类内部技术影响。

**正确写法**：直接说「做什么 / 不做什么 / 改成什么」，让 FDE 一眼知道需要怎么调整。

示例对比：
- ❌ 错误：「action「xxx」的 execution_target.action_type 被错误标记为 geo.build_citations，与声誉管理不符，将导致路由错误。」
- ✅ 正确：「「xxx」是管理 Google 评价的动作，应归入口碑/声誉类，不是 GEO 内容类，请把它移到口碑阶段。」

- ❌ 错误：「action「yyy」的 dimension 字段填写为 competitor，与实际功能不符。」
- ✅ 正确：「「yyy」是月度报告动作，不是竞品分析，请把它归到报告/数据板块下。」

## 输出格式

只输出原始 JSON：
{
  "overall": 7.5,
  "dimensions": {
    "realism": 8,
    "completeness": 7,
    "fde_actionability": 6,
    "roi_alignment": 8,
    "prioritization": 7,
    "resource_match": 9,
    "innovation": 6
  },
  "weaknesses": [
    {
      "dimension": "realism|completeness|fde_actionability|roi_alignment|prioritization|resource_match|innovation",
      "severity": "high|medium|low",
      "text": "中文薄弱点描述，具体到 action id / KPI 字段。不要以维度名开头。"
    }
  ],
  "improvements_made": []
}

如果是 refine pass（输入里会标注 PASS=2 并附上 PREVIOUS_WEAKNESSES），improvements_made 数组要列出针对每个 weakness 做的具体调整。否则留空数组。`

// ─── User prompt builders ──────────────────────────────────────────────────────

/**
 * 构建"补充/修订"模式的上下文段落。普通生成时 prior 为空，返回空串。
 */
function buildPriorSection(prior?: PriorPrescriptionContext): {
  block: string
  instruction: string
} {
  if (!prior) return { block: '', instruction: '' }

  const priorJson = JSON.stringify(prior.priorContent, null, 2)

  if (prior.mode === 'supplement') {
    return {
      block: `
## ⚠️ 补充处方模式（重要）

你现在不是从零开方，而是为一份**已批准、正在执行的处方**生成**补充动作**。

### 原处方全文
\`\`\`json
${priorJson}
\`\`\`

### 原处方执行进度
${prior.executionSummary}

### 补充模式规则
1. **只生成"还缺的"新动作** —— 绝不重复原处方已有的 action
2. 新动作要与原处方**互补**，不冲突
3. phases 仍然是 1/2/3，但只放新动作（原处方的动作不要复制进来）
4. budget_allocation 是**这次补充的增量预算**，不是总预算
5. kpi_targets 只列补充动作对应的新 KPI
6. summary 要说明"这是对原处方的补充，针对 [客户新发现的需求]"
`,
      instruction: '\n8. 这是补充处方 —— 只输出新增动作，不要复制原处方已有的内容',
    }
  }

  // revision
  return {
    block: `
## ⚠️ 修订处方模式（重要）

你现在要为一份**方向需要调整的处方**生成**修订版（v2）**。

### 原处方全文
\`\`\`json
${priorJson}
\`\`\`

### 原处方执行进度
${prior.executionSummary}

### 修订模式规则
1. **已完成的动作要承接** —— 不要让客户白做，已完成的成果作为新处方的起点
2. **进行中/待处理的动作**可以保留、调整或删除，取决于新方向
3. 输出一份**完整的新处方**（不是增量），但要体现"在原处方基础上修订"
4. summary 要说明"这是对原处方的修订，原因：[根据 intake.notes]，调整方向：..."
5. budget_allocation / kpi_targets 是修订后的完整版本
`,
    instruction: '\n8. 这是修订处方 —— 输出完整新处方，但承接已完成的动作，体现方向调整',
  }
}

/**
 * 构建生成阶段的 user message。
 * priorContext 非空时进入"补充/修订"模式。
 * memoryContext 非空时附加 L3 记忆段（Phase 23.D.2）。
 *
 * Phase DAPE W1: 新加 memoryBundle + promptMode。memoryBundle 优先于 memoryContext
 *   - 传 memoryBundle → 走 W1 三层 memory（preferences + zhuge_feedback + outcomes）+ 双模式
 *   - 仅传 memoryContext → 走旧路径（向后兼容 Phase 23.D.2）
 *   - 两个都没传 → 不注入 memory（与旧版完全一致）
 */
export function buildHuatuoGenerationPrompt(
  discovery: DiscoveryReport,
  intake: PrescriptionIntake,
  lookup: HuatuoLookupContext,
  priorContext?: PriorPrescriptionContext,
  memoryContext?: MemoryContext,
  memoryBundle?: HuatuoMemoryBundle,
  promptMode: HuatuoPromptMode = 'long',
): string {
  const d = discovery.diagnosis
  const scores = d?.scores
  const dimensionScoresText = scores
    ? [
        `  - SEO: ${scores.seo}/100`,
        `  - 社媒: ${scores.social}/100`,
        `  - 口碑: ${scores.reputation}/100`,
        `  - AI可见度: ${scores.ai_visibility}/100`,
        `  - 综合: ${scores.overall}/100`,
      ].join('\n')
    : '（无评分数据）'

  const actions = d?.actions
  const actionLines: string[] = []
  if (actions) {
    for (const text of actions.quick_fix ?? []) actionLines.push(`  - [HIGH | 立即可做] ${text}`)
    for (const text of actions.important ?? []) actionLines.push(`  - [HIGH | 重要建设] ${text}`)
    for (const text of actions.talk_to_us ?? []) actionLines.push(`  - [CRITICAL | 专业支持] ${text}`)
  }
  const findingsText = actionLines.length > 0 ? actionLines.join('\n') : '（无明确动作清单）'

  const crisisLine = d?.crisis_type
    ? `**危机类型**：${d.crisis_type}\n**关键发现**：${d.key_finding ?? '（无）'}\n`
    : ''

  const industryName = categoryToChineseName(lookup.industry_category)
  const benchmarksTable = formatBenchmarksForPrompt(lookup.benchmarks, industryName, intake.monthly_budget_aud)
  const trendSection = lookup.trend_summary
    ? formatTrendForPrompt(lookup.trend_summary as TrendSummary)
    : '## 域名历史流量趋势（SEMrush）\n\n**未拉取**（趋势数据可选）。'
  const seasonalSection = lookup.seasonal_calendar
    ? formatSeasonalCalendarForPrompt(lookup.seasonal_calendar)
    : '## 未来 90 天本地营销节点\n\n**未拉取**（季节日历可选）。'
  const interestSection = lookup.industry_interest
    ? formatInterestForPrompt(lookup.industry_interest)
    : '## 行业搜索热度趋势（Google Trends）\n\n**未拉取**（搜索热度数据可选）。'
  const casesSection = formatCasesForPrompt(lookup.similar_cases ?? [])
  const confidenceSection = formatConfidenceForPrompt(lookup.outcome_confidence ?? {})

  const priorityDims = intake.priority_dimensions.length > 0
    ? intake.priority_dimensions.join(', ')
    : '所有维度'

  // 把"真实增长率"作为强硬约束写进 instructions
  const ts = lookup.trend_summary
  const trendConstraint = ts?.has_data && ts.growth_pct_6m != null
    ? `\n6. 该域名过去 6 个月有机流量增长率为 ${ts.growth_pct_6m}%（轨迹：${ts.trajectory}）。SEO 类 KPI 的 6 个月目标增长不应超过 ${Math.max(ts.growth_pct_6m * 2, 30)}%（即实际增速 × 2 倍兜底 30%），否则 realism_confidence ≤ 0.4 并解释。`
    : ts?.has_data
      ? `\n6. 域名历史数据存在但增长率无法计算（流量基数过低）。请保守估算 target_value。`
      : `\n6. 域名无历史数据，target_value 严格按行业 P50–P75 区间估算。`

  // 补充/修订模式段落（普通生成时为空）
  const prior = buildPriorSection(priorContext)
  const taskTitle = priorContext?.mode === 'supplement'
    ? '# 任务：为已有处方生成补充动作'
    : priorContext?.mode === 'revision'
      ? '# 任务：生成处方的修订版（v2）'
      : '# 任务：为以下客户开具 90 天三阶段数字营销处方'

  // Phase DAPE W1: 注入三层 memory（preferences + zhuge_feedback + prescription_outcomes）+ 双模式
  // 优先用 memoryBundle（W1 路径），fallback 旧 memoryContext（Phase 23.D.2 兼容）
  const memorySection = memoryBundle
    ? formatHuatuoMemoryForPrompt(memoryBundle, promptMode)
    : formatMemoryForPrompt(memoryContext)

  return `${taskTitle}

## 客户画像
- 域名：${discovery.domain}
- 业务：${discovery.business.name}（${discovery.business.industry.join(' / ')}）
- 映射行业代码：${lookup.industry_category ?? '未匹配（使用通用基准）'}

## 张骞诊断结果（品牌健康快照）
${crisisLine}
**维度评分**：
${dimensionScoresText}

**张骞建议的动作（你需要基于此细化为可执行处方）**：
${findingsText}

${benchmarksTable}

${trendSection}

${seasonalSection}

${interestSection}
${casesSection ? `\n${casesSection}\n` : ''}
${confidenceSection ? `\n${confidenceSection}\n` : ''}
${memorySection}
${prior.block}
## 客户意向
- **业务目标**：${intake.business_goal}
- **时间紧迫度**：${intake.timeline_urgency}
- **月度预算**：AUD ${intake.monthly_budget_aud}
- **优先维度**：${priorityDims}
- **补充说明**：${intake.notes ?? '（无）'}

## 现在生成处方 JSON

记住：
1. KPI current_value 必须使用 SEMrush 趋势表的最近真实数字（如有），不要凭空估算
2. KPI target_value 必须引用基准表的 P50–P90 区间
3. 预算分配各项之和 ≤ AUD ${intake.monthly_budget_aud}
4. 每个 action 必须有 estimated_hours / required_skills / measurement_method / module
5. 危机类型「${d?.crisis_type ?? '未指定'}」决定预算重心${trendConstraint}
7. 全部中文（除枚举值）${prior.instruction}`
}

/**
 * 构建自评阶段的 user message。
 */
export function buildHuatuoSelfGradePrompt(
  prescription: PrescriptionContent,
  intake: PrescriptionIntake,
  lookup: HuatuoLookupContext,
  options?: { pass?: number; previousWeaknesses?: SelfGradeWeakness[] },
): string {
  const passNum = options?.pass ?? 1
  const prevWeaknesses = options?.previousWeaknesses ?? []

  const industryName = categoryToChineseName(lookup.industry_category)
  const benchmarksTable = formatBenchmarksForPrompt(lookup.benchmarks, industryName, intake.monthly_budget_aud)

  const prevSection = passNum > 1 && prevWeaknesses.length > 0
    ? `\n## PASS=${passNum}\n## PREVIOUS_WEAKNESSES（上一轮自评指出的问题，本轮应已修复）\n${prevWeaknesses.map((w, i) => `${i + 1}. [${w.dimension} | ${w.severity}] ${w.text}`).join('\n')}\n`
    : `\n## PASS=${passNum}\n`

  return `# 任务：对以下处方做苛刻的质检评分

## 客户预算与意向
- 月度预算：AUD ${intake.monthly_budget_aud}
- 业务目标：${intake.business_goal}
- 时间紧迫度：${intake.timeline_urgency}

${benchmarksTable}

## 待评分的处方
\`\`\`json
${JSON.stringify(prescription, null, 2)}
\`\`\`

${prevSection}

## 现在输出评分 JSON

记住：苛刻打分，每项 0–10 整数。overall = (realism×1.5 + 其他六项) / 7.5，保留一位小数。`
}
