/**
 * 华佗 Hua Tuo — Prescription Agent (multi-step orchestration).
 *
 * Reference: ROADMAP.md P8.10.S3
 *
 * Pipeline:
 *   1. Lookup     — 行业基准库查询（+ 未来：SEMrush 趋势 + 案例库）
 *   2. Generate   — Claude Sonnet 生成处方 JSON
 *   3. Self-grade — 独立 Claude 调用做 7 维 0-10 分自评
 *   4. Refine     — 如果 overall < 7.0，带着 weaknesses 再生成一次
 *
 * 成本上限：3 次 Claude 调用（generate + grade + 可选 refine）= 约 $0.15–0.30 / 处方
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { parseJsonResponse, MODEL_SONNET } from '@/lib/anthropic/client'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { PrescriptionContent, PrescriptionIntake, PrescriptionAction, PriorPrescriptionContext } from '@/types/diagnostic'
import { deriveExecutionTarget } from '@/lib/flywheel/execution-target'
import type {
  HuatuoPrescriptionResult,
  HuatuoLookupContext,
  SelfGrade,
  SelfGradeWeakness,
} from './types'
import { fetchBenchmarks, extractBenchmarkIds } from './benchmarks'
import { mapIndustryToCategory } from './industry-mapper'
import { getDomainTrafficTrend } from '@/lib/semrush/client'
import { summarizeTrend } from './trends'
import { getSeasonalCalendar } from './seasonal-calendar'
import { getIndustryInterestTrend } from '@/lib/gtrends/client'
import { coerceWeaknesses } from './weakness-utils'

// re-export 供 refine route 等使用
export { coerceWeaknesses } from './weakness-utils'
import {
  HUATUO_GENERATION_SYSTEM_PROMPT,
  HUATUO_SELFGRADE_SYSTEM_PROMPT,
  buildHuatuoGenerationPrompt,
  buildHuatuoSelfGradePrompt,
} from './prompts'

// ─── Constants ────────────────────────────────────────────────────────────────

export const HUATUO_AGENT_VERSION = '1.0.0'

// Sonnet 4.5 supports up to 8192 output tokens. 3 阶段中文处方含 FDE 字段
// 经常超过 4096 → 必须用 8192，否则 JSON 被截断在中间数组里。
const MAX_OUTPUT_TOKENS_GENERATION = 8192
const MAX_OUTPUT_TOKENS_SELFGRADE = 2048

// 单次 Claude 调用硬超时（毫秒）。Anthropic SDK 默认 10 分钟 + 默认重试 2 次
// = 最坏 30 分钟挂起。这里给充足空间但仍禁用 SDK 重试。
// 现在异步执行，不再受 Render 100s 请求超时约束。
const CLAUDE_TIMEOUT_GENERATION_MS = 240_000   // 4 分钟（中文 8192 tokens 需要 ~120s）
const CLAUDE_TIMEOUT_SELFGRADE_MS = 90_000     // 1.5 分钟

/** 给华佗专用的 Anthropic client — 显式 timeout + 禁用重试，避免挂起。 */
function getHuatuoAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  return new Anthropic({
    apiKey,
    timeout: CLAUDE_TIMEOUT_GENERATION_MS,  // SDK 层兜底（4 分钟）
    maxRetries: 0,                          // 异步执行下我们自己控制重试
  })
}

/** Promise.race 兜底 — 即使 SDK timeout 失效也保证主流程不挂死。 */
async function withHardTimeout<T>(label: string, p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 调用超过 ${(ms / 1000) | 0}s 硬超时`)), ms),
    ),
  ])
}

const REFINE_THRESHOLD = 7.0       // 自评低于此分触发 refine
const MAX_PASSES = 2                // 最多生成两次（不含 self-grade）

// Sonnet 4.5 pricing per million tokens
const PRICE_INPUT_PER_M = 3.0
const PRICE_OUTPUT_PER_M = 15.0

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RunHuatuoOptions {
  /** 跳过 self-grade（用于测试或预览） — 默认 false（执行自评） */
  skipSelfGrade?: boolean
  /**
   * 是否精修。**默认 true（跳过）**——避免 Render 100s 超时。
   * 显式传 false 才会在自评低分时触发第 2 轮生成。
   */
  skipRefine?: boolean
  /** 进度回调（UI 显示阶段提示） */
  onProgress?: (note: string) => void | Promise<void>
  /** 补充/修订模式：携带原处方全文 + 执行进度（P8.10.S5） */
  priorContext?: PriorPrescriptionContext
}

/**
 * 华佗主入口：从张骞 discovery + 客户意向生成处方（含自评 + 基准引用）。
 */
export async function runHuatuo(
  supabase: SupabaseClient,
  discovery: DiscoveryReport,
  intake: PrescriptionIntake,
  options: RunHuatuoOptions = {},
): Promise<HuatuoPrescriptionResult> {
  const startedAt = Date.now()
  const onProgress = options.onProgress ?? (() => undefined)

  let totalInputTokens = 0
  let totalOutputTokens = 0
  let passes = 0

  // ── Step 1: Lookup（基准库 + SEMrush 历史趋势 + Google Trends，并行）────────
  await onProgress('查询行业基准库 + SEMrush 历史趋势 + 行业搜索热度…')
  const industryCategory = mapIndustryToCategory(discovery.business.industry)
  // Google Trends 查询用客户行业关键词（兜底用业务名）
  const interestQuery = discovery.business.industry[0] ?? discovery.business.name

  const [benchmarks, trendPoints, industryInterest] = await Promise.all([
    fetchBenchmarks(supabase, {
      industryCategory,
      businessSize: 'small',
      market: 'AU_NZ',
    }),
    // 趋势失败不阻塞 — getDomainTrafficTrend 内部已 try/catch 返回 []
    getDomainTrafficTrend(discovery.domain, undefined, 12),
    // Google Trends 失败不阻塞 — getIndustryInterestTrend 内部已兜底返回 no_data
    getIndustryInterestTrend(interestQuery, 'AU'),
  ])

  const trendSummary = summarizeTrend(trendPoints)

  // 季节日历为纯静态查表（无外部依赖），同步获取未来 90 天本地营销节点
  const currentMonth = new Date().toISOString().slice(0, 7)  // YYYY-MM
  const seasonalCalendar = getSeasonalCalendar('AU', currentMonth)

  const lookup: HuatuoLookupContext = {
    benchmarks,
    industry_category: industryCategory,
    trend_summary: trendSummary,
    seasonal_calendar: seasonalCalendar,
    industry_interest: industryInterest,
  }

  // ── Step 2: Generate（pass 1）────────────────────────────────────────────
  await onProgress('华佗正在开方…')
  const client = getHuatuoAnthropicClient()
  let pass1
  try {
    pass1 = await withHardTimeout(
      '处方生成',
      generatePrescription(client, discovery, intake, lookup, options.priorContext),
      CLAUDE_TIMEOUT_GENERATION_MS,
    )
  } catch (err) {
    throw wrapError(err, '华佗生成第1轮失败')
  }
  passes = 1
  totalInputTokens += pass1.usage.input
  totalOutputTokens += pass1.usage.output

  let content = pass1.content
  let selfGrade: SelfGrade | null = null

  // ── Step 3: Self-grade ───────────────────────────────────────────────────
  if (!options.skipSelfGrade) {
    await onProgress('华佗自检处方…')
    try {
      const grade1 = await withHardTimeout(
        '处方自评',
        selfGradePrescription(client, content, intake, lookup, { pass: 1 }),
        CLAUDE_TIMEOUT_SELFGRADE_MS,
      )
      totalInputTokens += grade1.usage.input
      totalOutputTokens += grade1.usage.output
      selfGrade = grade1.grade
    } catch (err) {
      // 自评失败不阻塞主流程 — 标记降级并继续
      console.warn('[huatuo] self-grade pass 1 failed, falling back', err)
      selfGrade = makeDefaultGrade()
    }

    // ── Step 4: Refine if grade too low ──────────────────────────────────
    // 默认 skipRefine = true（避免 Render 100s 请求超时）。用户想要精修需在 UI 显式开启。
    const shouldRefine = options.skipRefine === false  // 明确 false 才精修
    if (
      shouldRefine &&
      selfGrade.overall < REFINE_THRESHOLD &&
      selfGrade.overall > 0 &&
      passes < MAX_PASSES
    ) {
      await onProgress(`首轮自评 ${selfGrade.overall}/10 偏低，华佗精修中…`)
      try {
        const pass2 = await withHardTimeout(
          '处方精修',
          generatePrescriptionWithFeedback(
            client, discovery, intake, lookup,
            { previousContent: content, weaknesses: selfGrade.weaknesses, priorContext: options.priorContext },
          ),
          CLAUDE_TIMEOUT_GENERATION_MS,
        )
        passes = 2
        totalInputTokens += pass2.usage.input
        totalOutputTokens += pass2.usage.output
        content = pass2.content

        // Re-grade pass 2
        const grade2 = await withHardTimeout(
          '精修后自评',
          selfGradePrescription(client, content, intake, lookup, {
            pass: 2,
            previousWeaknesses: selfGrade.weaknesses,
          }),
          CLAUDE_TIMEOUT_SELFGRADE_MS,
        )
        totalInputTokens += grade2.usage.input
        totalOutputTokens += grade2.usage.output
        selfGrade = grade2.grade
      } catch (err) {
        // refine 失败保持 pass 1 结果
        console.warn('[huatuo] refine pass failed, keeping pass 1 result', err)
      }
    }
  }

  // ── Step 5: Enforce budget ceiling ───────────────────────────────────────
  clampBudgetAllocation(content, intake.monthly_budget_aud)

  // ── Assemble result ──────────────────────────────────────────────────────
  const costUsd =
    (totalInputTokens / 1_000_000) * PRICE_INPUT_PER_M +
    (totalOutputTokens / 1_000_000) * PRICE_OUTPUT_PER_M

  return {
    content,
    self_grade: selfGrade ?? makeDefaultGrade(),
    benchmarks_used: extractBenchmarkIds(benchmarks),
    trend_summary: trendSummary,
    meta: {
      agent_version: HUATUO_AGENT_VERSION,
      passes,
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens,
      cost_usd: Number(costUsd.toFixed(4)),
      duration_ms: Date.now() - startedAt,
      industry_category_used: industryCategory,
    },
  }
}

// ─── Public: Refine an existing prescription (called by /prescription/[pId]/refine) ──

export interface RefineHuatuoOptions {
  onProgress?: (note: string) => void | Promise<void>
  /** P8.10.S3: 用户的修改建议，比 AI 自评 weaknesses 优先级更高 */
  humanComments?: string
  /** 上一版处方的 passes 值；新结果 = previousPasses + 1。默认 1。 */
  previousPasses?: number
}

/**
 * 重新精修一份已生成的处方。流程：
 *   1. 重新 lookup（基准库 + SEMrush trend 可能变了）
 *   2. 用 previousContent + previousWeaknesses 触发 refine pass
 *   3. 重新自评 pass 2
 *
 * 适合放在独立 API 请求里调用，避免主生成请求超时。
 */
export async function refineHuatuoPrescription(
  supabase: SupabaseClient,
  discovery: DiscoveryReport,
  intake: PrescriptionIntake,
  previousContent: PrescriptionContent,
  previousWeaknesses: SelfGradeWeakness[],
  options: RefineHuatuoOptions = {},
): Promise<HuatuoPrescriptionResult> {
  const startedAt = Date.now()
  const onProgress = options.onProgress ?? (() => undefined)

  let totalInputTokens = 0
  let totalOutputTokens = 0

  // Step 1: re-lookup
  await onProgress('重新查询基准库和趋势…')
  const industryCategory = mapIndustryToCategory(discovery.business.industry)
  const [benchmarks, trendPoints] = await Promise.all([
    fetchBenchmarks(supabase, {
      industryCategory,
      businessSize: 'small',
      market: 'AU_NZ',
    }),
    getDomainTrafficTrend(discovery.domain, undefined, 12),
  ])
  const trendSummary = summarizeTrend(trendPoints)
  const lookup: HuatuoLookupContext = {
    benchmarks,
    industry_category: industryCategory,
    trend_summary: trendSummary,
  }

  const client = getHuatuoAnthropicClient()

  // Step 2: refine（融入人工意见，如有）
  const progressMsg = options.humanComments
    ? '华佗根据您的意见精修…'
    : '华佗针对自检薄弱点精修…'
  await onProgress(progressMsg)
  const refinePass = await withHardTimeout(
    '处方精修',
    generatePrescriptionWithFeedback(
      client, discovery, intake, lookup,
      {
        previousContent,
        weaknesses: previousWeaknesses,
        humanComments: options.humanComments,
      },
    ),
    CLAUDE_TIMEOUT_GENERATION_MS,
  )
  totalInputTokens += refinePass.usage.input
  totalOutputTokens += refinePass.usage.output

  // Step 3: re-grade (pass 2)
  await onProgress('华佗复检精修结果…')
  let selfGrade: SelfGrade
  try {
    const grade = await withHardTimeout(
      '精修后自评',
      selfGradePrescription(client, refinePass.content, intake, lookup, {
        pass: 2,
        previousWeaknesses,
      }),
      CLAUDE_TIMEOUT_SELFGRADE_MS,
    )
    totalInputTokens += grade.usage.input
    totalOutputTokens += grade.usage.output
    selfGrade = grade.grade
  } catch (err) {
    console.warn('[huatuo] refine re-grade failed, keeping refine content', err)
    selfGrade = makeDefaultGrade()
  }

  // Clamp budget
  clampBudgetAllocation(refinePass.content, intake.monthly_budget_aud)

  const costUsd =
    (totalInputTokens / 1_000_000) * PRICE_INPUT_PER_M +
    (totalOutputTokens / 1_000_000) * PRICE_OUTPUT_PER_M

  return {
    content: refinePass.content,
    self_grade: selfGrade,
    benchmarks_used: extractBenchmarkIds(benchmarks),
    trend_summary: trendSummary,
    meta: {
      agent_version: HUATUO_AGENT_VERSION,
      passes: (options.previousPasses ?? 1) + 1,
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens,
      cost_usd: Number(costUsd.toFixed(4)),
      duration_ms: Date.now() - startedAt,
      industry_category_used: industryCategory,
    },
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface ClaudeCallResult<T> {
  content: T
  usage: { input: number; output: number }
}

async function generatePrescription(
  client: Anthropic,
  discovery: DiscoveryReport,
  intake: PrescriptionIntake,
  lookup: HuatuoLookupContext,
  priorContext?: PriorPrescriptionContext,
): Promise<ClaudeCallResult<PrescriptionContent>> {
  const userPrompt = buildHuatuoGenerationPrompt(discovery, intake, lookup, priorContext)
  const message = await client.messages.create({
    model: MODEL_SONNET,
    max_tokens: MAX_OUTPUT_TOKENS_GENERATION,
    system: HUATUO_GENERATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  assertNotTruncated(message, 'generation')

  const rawText = extractText(message.content)
  const parsed = parseJsonResponse<Partial<PrescriptionContent>>(rawText)
  return {
    content: normalizePrescriptionContent(parsed),
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
  }
}

/**
 * 提前捕获 max_tokens 截断 — 给出明确错误，而非让下游 JSON.parse 报神秘的位置错误。
 */
function assertNotTruncated(
  message: { stop_reason?: string | null; usage: { output_tokens: number } },
  stage: string,
): void {
  if (message.stop_reason === 'max_tokens') {
    throw new Error(
      `Claude 输出在 ${stage} 阶段被 max_tokens 截断（已输出 ${message.usage.output_tokens} tokens）。处方复杂度过高，请减少 action 数量或缩短 description，或在代码里继续上调 max_tokens。`
    )
  }
}

/**
 * Defensive normalization — Claude sometimes omits arrays or returns null where empty arrays expected.
 * This shields downstream code (UI rendering, .map() calls) from runtime explosions.
 */
/**
 * P12.A.11: Attach execution_target to every action so the prescription stored
 * in DB natively carries flywheel routing. Falls back silently if dimension /
 * fix_type are missing — downstream execution-generator re-derives if needed.
 */
function attachExecutionTarget(action: PrescriptionAction): PrescriptionAction {
  if (action.execution_target) return action
  if (!action.dimension || !action.fix_type) return action
  return {
    ...action,
    execution_target: deriveExecutionTarget(action.dimension, action.fix_type),
  }
}

function normalizePrescriptionContent(p: Partial<PrescriptionContent>): PrescriptionContent {
  return {
    summary: typeof p.summary === 'string' ? p.summary : '',
    phases: Array.isArray(p.phases)
      ? p.phases.map(ph => ({
          phase_number:   typeof ph.phase_number === 'number' ? ph.phase_number : 0,
          name:           typeof ph.name === 'string' ? ph.name : '',
          duration_weeks: typeof ph.duration_weeks === 'number' ? ph.duration_weeks : 0,
          actions:        Array.isArray(ph.actions) ? ph.actions.map(attachExecutionTarget) : [],
        }))
      : [],
    kpi_targets: Array.isArray(p.kpi_targets) ? p.kpi_targets : [],
    budget_allocation: Array.isArray(p.budget_allocation) ? p.budget_allocation : [],
  }
}

async function generatePrescriptionWithFeedback(
  client: Anthropic,
  discovery: DiscoveryReport,
  intake: PrescriptionIntake,
  lookup: HuatuoLookupContext,
  feedback: {
    previousContent: PrescriptionContent
    weaknesses: SelfGradeWeakness[]
    humanComments?: string
    priorContext?: PriorPrescriptionContext
  },
): Promise<ClaudeCallResult<PrescriptionContent>> {
  // 精修 prompt 强调"针对性修复 + 保持紧凑"
  // 防止 Claude 看到 8 条 weaknesses 后过度扩写超出 8192 max_tokens
  const basePrompt = buildHuatuoGenerationPrompt(discovery, intake, lookup, feedback.priorContext)

  // 人工意见（如有）— 比 AI 自评 weaknesses 优先级更高
  const humanCommentsBlock = feedback.humanComments && feedback.humanComments.trim()
    ? `\n\n## 👤 用户的修改建议（**最高优先级，必须采纳**）

用户审阅了上一版处方后给出以下修改意见：

\`\`\`
${feedback.humanComments.trim()}
\`\`\`

这些是来自实际服务该客户的 FDE / 顾问的人类经验判断，**比下面的 AI 自评 weaknesses 优先级更高**。本轮处方必须明确反映用户的意见。
`
    : ''

  const feedbackBlock = `\n\n## 上一轮的处方与 AI 自检反馈
${humanCommentsBlock}
上一轮 AI 自检指出的问题（次优先级，结合用户意见酌情修复）：

${feedback.weaknesses.map((w, i) => `${i + 1}. [${w.dimension} | ${w.severity}] ${w.text}`).join('\n')}

上一轮处方 JSON（保留你认为合理的部分）：
\`\`\`json
${JSON.stringify(feedback.previousContent, null, 2)}
\`\`\`

## ⚠️ 输出约束（重要 — 防止超 max_tokens）

1. **保持原 description 简洁度**：每个 action.description 不超过 80 字，title 不超过 20 字
2. **不要扩写 measurement_method**：保持 1 句话，不超过 30 字
3. **总 actions 数量不增加**：原处方有 N 个 actions，新处方 ≤ N 个
4. **kpi_targets ≤ 8 个**：精挑关键 KPI，不堆砌
5. **如需新增 action**，必删另一个低优先级 action（保持总数不变）

现在输出**修订后的完整处方 JSON**（精炼版${feedback.humanComments ? '，并明确体现用户的修改建议' : ''}）。`
  const userPrompt = basePrompt + feedbackBlock

  const message = await client.messages.create({
    model: MODEL_SONNET,
    max_tokens: MAX_OUTPUT_TOKENS_GENERATION,
    system: HUATUO_GENERATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })
  assertNotTruncated(message, 'refine')
  const rawText = extractText(message.content)
  const parsed = parseJsonResponse<Partial<PrescriptionContent>>(rawText)
  return {
    content: normalizePrescriptionContent(parsed),
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
  }
}

interface GradeCallResult {
  grade: SelfGrade
  usage: { input: number; output: number }
}

async function selfGradePrescription(
  client: Anthropic,
  prescription: PrescriptionContent,
  intake: PrescriptionIntake,
  lookup: HuatuoLookupContext,
  options: { pass: number; previousWeaknesses?: SelfGradeWeakness[] },
): Promise<GradeCallResult> {
  const userPrompt = buildHuatuoSelfGradePrompt(prescription, intake, lookup, options)
  const message = await client.messages.create({
    model: MODEL_SONNET,
    max_tokens: MAX_OUTPUT_TOKENS_SELFGRADE,
    system: HUATUO_SELFGRADE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })
  assertNotTruncated(message, 'self-grade')
  const rawText = extractText(message.content)
  const parsed = parseJsonResponse<Partial<SelfGrade>>(rawText)

  // Normalize all fields defensively — Claude may omit some keys
  const normalized: SelfGrade = {
    overall: clamp(parsed.overall ?? 0, 0, 10),
    dimensions: {
      realism:          clamp(parsed.dimensions?.realism ?? 0, 0, 10),
      completeness:     clamp(parsed.dimensions?.completeness ?? 0, 0, 10),
      fde_actionability:clamp(parsed.dimensions?.fde_actionability ?? 0, 0, 10),
      roi_alignment:    clamp(parsed.dimensions?.roi_alignment ?? 0, 0, 10),
      prioritization:   clamp(parsed.dimensions?.prioritization ?? 0, 0, 10),
      resource_match:   clamp(parsed.dimensions?.resource_match ?? 0, 0, 10),
      innovation:       clamp(parsed.dimensions?.innovation ?? 0, 0, 10),
    },
    weaknesses: coerceWeaknesses(parsed.weaknesses),
    improvements_made: Array.isArray(parsed.improvements_made) ? parsed.improvements_made.filter(w => typeof w === 'string') : [],
  }

  return {
    grade: normalized,
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
  }
}


/** Wrap an error with a stage context so the API can show "stage: X failed: reason" */
function wrapError(err: unknown, stage: string): Error {
  const original = err instanceof Error ? err.message : String(err)
  const wrapped = new Error(`${stage}: ${original}`)
  if (err instanceof Error && err.stack) {
    wrapped.stack = err.stack
  }
  return wrapped
}

function extractText(blocks: Array<{ type: string; text?: string }>): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('')
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function clampBudgetAllocation(content: PrescriptionContent, maxBudget: number): void {
  if (!content.budget_allocation || content.budget_allocation.length === 0) return
  const total = content.budget_allocation.reduce((sum, b) => sum + b.amount_aud, 0)
  if (total <= maxBudget) return
  const ratio = maxBudget / total
  for (const item of content.budget_allocation) {
    item.amount_aud = Math.floor(item.amount_aud * ratio)
    item.percentage = Math.round(item.percentage * ratio)
  }
}

function makeDefaultGrade(): SelfGrade {
  return {
    overall: 0,
    dimensions: {
      realism: 0, completeness: 0, fde_actionability: 0, roi_alignment: 0,
      prioritization: 0, resource_match: 0, innovation: 0,
    },
    weaknesses: [{ dimension: 'completeness', severity: 'low', text: '自评步骤被跳过' }],
    improvements_made: [],
  }
}
