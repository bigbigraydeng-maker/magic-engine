/**
 * P21.2 — AI Factory 核心服务层
 *
 * runFactoryJob():
 *   1. 加载客户 L3 记忆（loadMemoryForClient）
 *   2. 加载 Data Intelligence 信号（Phase 22.C.2）
 *   3. 构建注入记忆 + 数据信号的 system/user prompt
 *   4. 用 Haiku 生产层（routeModel('production')）调用 Anthropic
 *   5. 返回 FactoryResult（含 token 消耗 + USD 成本）
 *
 * SDK 客户端在 handler 内部初始化（遵循 CLAUDE.md 约定，禁止模块顶层初始化）。
 */

import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAnthropicClient } from '@/lib/anthropic/client'
import { routeModel, calcCost } from '@/lib/ai/model-router'
import { loadMemoryForClient } from '@/lib/memory/service'
import { loadIntelligenceContext } from './intelligence-context'
import { buildSystemPrompt, buildUserPrompt } from './prompts'
import type { FactoryJobInput, FactoryResult, FactoryVariant } from './types'

const MAX_TOKENS = 1200

export async function runFactoryJob(
  supabase: SupabaseClient,
  input: FactoryJobInput,
): Promise<FactoryResult> {
  const { clientId, flywheel } = input

  // 1. 加载 L3 记忆（flywheel 过滤，若无指定则全量加载）
  const memoryContext = await loadMemoryForClient(supabase, clientId, {
    flywheel,
    maxRecentDecisions: 0,  // production 层跳过决策历史，省 token
    minConfidence: 0.6,
  })

  // 2. Phase 22.C.2 — 加载 Data Intelligence 信号（非阻塞，失败静默降级）
  const intelligenceBlock = input.intelligenceBlock !== undefined
    ? input.intelligenceBlock  // caller 已预加载（orchestrator 路径）
    : await loadIntelligenceContext(supabase, clientId)

  // 3. 构建 prompt（记忆 + intelligence 信号注入在 buildSystemPrompt 内完成）
  const systemPrompt = buildSystemPrompt({ ...input, intelligenceBlock }, memoryContext)
  const userPrompt   = buildUserPrompt(input)

  // 3. 按 production 档位路由 → Haiku 4.5
  const { model } = routeModel('production')
  const anthropic   = getAnthropicClient()

  const message = await anthropic.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const rawText    = extractText(message.content)
  const variants   = parseVariants(rawText)
  const inputTok   = message.usage.input_tokens
  const outputTok  = message.usage.output_tokens
  const costUsd    = calcCost('production', inputTok, outputTok)

  return {
    jobId:           randomUUID(),
    clientId,
    platform:        input.platform,
    contentType:     input.contentType,
    topic:           input.topic,
    variants,
    memoryInjected:  memoryContext.has_content,
    modelUsed:       model,
    inputTokens:     inputTok,
    outputTokens:    outputTok,
    costUsd,
    generatedAt:     new Date().toISOString(),
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(content: { type: string; text?: string }[]): string {
  return content
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text!)
    .join('')
}

function parseVariants(raw: string): FactoryVariant[] {
  try {
    // Pull the first JSON object out of the response
    const match = raw.match(/\{[\s\S]*"variants"[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as { variants?: FactoryVariant[] }
      if (Array.isArray(parsed.variants) && parsed.variants.length > 0) {
        return parsed.variants.map(v => ({
          content:  String(v.content ?? '').trim(),
          hashtags: Array.isArray(v.hashtags) ? v.hashtags.map(String) : [],
        }))
      }
    }
  } catch {
    // Fallback: return raw text as single variant, no hashtags
  }

  // Graceful degradation — return raw text as a single variant
  return [{ content: raw.trim(), hashtags: [] }]
}
