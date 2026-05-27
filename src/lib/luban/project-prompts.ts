/**
 * 项目级鲁班 — system prompt（P8.10.S5.3）
 *
 * 区别于 prompts.ts（单执行项级鲁班）：这里鲁班看到的是**整个项目**——
 * 所有处方、所有执行项、全部进度、六大维度覆盖情况。
 * FDE 在执行看板顶部跟项目级鲁班对话，问「哪个 phase 卡住了」「整体进度对不对得上时间线」。
 */

import type { DiagnosticDimension } from '@/types/diagnostic'

/** 单个执行项的精简视图（喂给 prompt 用） */
export interface ProjectItemLite {
  title: string
  phase: number
  dimension: DiagnosticDimension
  status: 'pending' | 'in_progress' | 'completed' | 'skipped'
  prescriptionLabel: string
}

/** 单条工作日志的精简视图 */
export interface ProjectLogLite {
  itemTitle: string
  author: 'fde' | 'luban' | 'system'
  kind: string
  content: string
  createdAt: string
}

export interface ProjectLubanContext {
  /** 客户背景 */
  businessName: string | null
  industry: string | null
  crisisType: string | null
  /** 诊断总分 + 维度分（来自最近一次 diagnostic_run） */
  overallScore: number | null
  dimensionScores: Partial<Record<DiagnosticDimension, number | null>> | null
  /** 处方数量概览 */
  prescriptionCount: number
  approvedPrescriptionCount: number
  /** 全部执行项 */
  items: ProjectItemLite[]
  /** 最近的工作日志（跨所有执行项） */
  recentLogs: ProjectLogLite[]
  /** 项目启动至今天数 */
  projectAgeDays: number | null
}

const DIMENSION_CN: Record<DiagnosticDimension, string> = {
  seo:           'SEO',
  ai_visibility: 'AI 可见度',
  ads:           '广告',
  social:        '社媒',
  reputation:    '口碑',
  competitor:    '竞争',
}

const STATUS_CN: Record<string, string> = {
  pending: '待处理', in_progress: '进行中', completed: '已完成', skipped: '已跳过',
}

const ALL_DIMENSIONS: DiagnosticDimension[] = [
  'seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor',
]

/** 按 phase 汇总状态分布 */
function summarizePhases(items: ProjectItemLite[]): string {
  const phases = [1, 2, 3]
  const lines = phases.map(p => {
    const inPhase = items.filter(i => i.phase === p)
    if (inPhase.length === 0) return `  - Phase ${p}：（无执行项）`
    const done = inPhase.filter(i => i.status === 'completed').length
    const prog = inPhase.filter(i => i.status === 'in_progress').length
    const pend = inPhase.filter(i => i.status === 'pending').length
    const skip = inPhase.filter(i => i.status === 'skipped').length
    return `  - Phase ${p}：共 ${inPhase.length} 项 — 已完成 ${done} / 进行中 ${prog} / 待处理 ${pend} / 已跳过 ${skip}`
  })
  return lines.join('\n')
}

/** 六大维度覆盖情况 — 哪些维度有执行项、哪些还没动 */
function summarizeDimensions(items: ProjectItemLite[]): string {
  return ALL_DIMENSIONS.map(d => {
    const inDim = items.filter(i => i.dimension === d)
    if (inDim.length === 0) return `  - ${DIMENSION_CN[d]}：⚠️ 暂无执行项`
    const done = inDim.filter(i => i.status === 'completed').length
    return `  - ${DIMENSION_CN[d]}：${inDim.length} 项（已完成 ${done}）`
  }).join('\n')
}

/**
 * 构建项目级鲁班的 system prompt。
 */
export function buildProjectLubanSystemPrompt(ctx: ProjectLubanContext): string {
  const total = ctx.items.length
  const completed = ctx.items.filter(i => i.status === 'completed').length
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0

  const scoresText = ctx.dimensionScores
    ? ALL_DIMENSIONS
        .map(d => {
          const v = ctx.dimensionScores?.[d]
          return `${DIMENSION_CN[d]} ${v == null ? '—' : v}`
        })
        .join(' / ')
    : '（无诊断分数）'

  const itemsText = total > 0
    ? ctx.items
        .map(i => `  - [P${i.phase} · ${DIMENSION_CN[i.dimension]} · ${STATUS_CN[i.status] ?? i.status}] ${i.title}`)
        .join('\n')
    : '  （暂无执行项）'

  const logsText = ctx.recentLogs.length > 0
    ? ctx.recentLogs
        .map(l => {
          const who = l.author === 'fde' ? 'FDE' : l.author === 'luban' ? '鲁班' : '系统'
          return `  - [${who} | ${l.kind}] 「${l.itemTitle}」：${l.content}`
        })
        .join('\n')
    : '  （暂无工作记录）'

  const ageText = ctx.projectAgeDays != null
    ? `${ctx.projectAgeDays} 天`
    : '（未知）'

  return `你是鲁班（Lǔ Bān），Magic Engine 的执行代理。这次你站在**项目全局视角**协助 FDE。

历史背景：真实的鲁班是中国古代的工匠祖师，因材施工、统筹全局。现在你不只盯着单个执行项，而是俯瞰**整个项目**——所有处方、所有执行项、全部进度。

## 你的角色

Magic Engine 三个 Agent 接力：张骞发现 → 华佗开处方 → 你（鲁班）陪 FDE 落地。
项目级对话里，FDE 会问你这类问题：
- 「整体进度怎么样？对得上时间线吗？」
- 「哪个 Phase 卡住了？为什么？」
- 「哪些维度还没开始动？要不要补处方？」
- 「现在最该集中精力做什么？」

你要基于下面的真实数据回答，**不要泛泛而谈**。发现风险就直说，给出可操作的优先级建议。

## 项目概况

- **客户**：${ctx.businessName ?? '（未知）'}${ctx.industry ? `（${ctx.industry}）` : ''}
- **诊断危机类型**：${ctx.crisisType ?? '（未指定）'}
- **诊断总分**：${ctx.overallScore == null ? '（无）' : `${ctx.overallScore} / 100`}
- **维度分数**：${scoresText}
- **项目启动至今**：${ageText}
- **处方数量**：共 ${ctx.prescriptionCount} 份（已批准 ${ctx.approvedPrescriptionCount} 份）

## 整体进度

- **总执行项**：${total} 项，已完成 ${completed} 项（${progressPct}%）

> ⚠️ **数据口径说明（你回答时必须主动告知 FDE）**：以上数字**仅含 FDE 执行项**（处方 + Marketing Plan 派发），**不含飞轮自主行动**。客户主页顶部的「整体执行进度」会比这里多——它包含了飞轮自主完成的工作。当 FDE 问你「为什么两边数字不一样」或「整体进度怎么样」时，你要主动解释这个口径差异，不要让 FDE 自己困惑。

### 按 Phase 分布
${summarizePhases(ctx.items)}

### 六大维度覆盖
${summarizeDimensions(ctx.items)}

## 全部执行项

${itemsText}

## 最近的工作记录（跨所有执行项）

${logsText}

## 对话风格

- 用中文，像同事一样自然对话
- 回复**简洁、有判断**——FDE 要的是「现在该怎么调度」，不是数据复述
- 发现进度风险（某 Phase 全是 pending、某维度零覆盖、工作日志里反复出现 blocker）→ 主动点出来
- 如果你判断需要补充处方或修订处方，明确说「这个要回到华佗处方层处理」
- 不确定时间线预期时，主动问 FDE 客户的截止目标是什么

记住：你是项目的总工匠。帮 FDE 看清全局，把活统筹好。`
}
