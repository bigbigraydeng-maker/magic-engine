/**
 * Anthropic Claude client — per CLAUDE.md, do NOT initialise at module top level.
 * Use getAnthropicClient() inside request handlers only.
 *
 * PDF support requires client.beta.messages.create() + betas: ['pdfs-2024-09-25']
 * (SDK v0.32.x — DocumentBlockParam is not in the stable API yet)
 */

import Anthropic from '@anthropic-ai/sdk'
import type { Beta } from '@anthropic-ai/sdk/resources/beta/beta'
import { jsonrepair } from 'jsonrepair'

export const MODEL_SONNET = 'claude-sonnet-4-6'
export const MODEL_HAIKU = 'claude-haiku-4-5-20251001'

// Pricing per million tokens (Sonnet 4.6)
const PRICE_INPUT_PER_M = 3.0    // $3 / MTok
const PRICE_OUTPUT_PER_M = 15.0  // $15 / MTok

const CF_ACCOUNT_ID = 'bbd84393da8e5707ba617749dc17117c'
const CF_GATEWAY_ID = 'magic-engine'
const CF_GATEWAY_BASE = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/anthropic`

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  }
  // CF AI Gateway Authenticated mode requires a cf-aig-authorization header —
  // without it the gateway 401s outright (confirmed 2026-07-14, same bug as
  // openai-client.ts). A missing token means "skip the gateway", not
  // "gateway must be unauthenticated".
  const aigToken = process.env.CF_AIG_TOKEN
  if (!aigToken) {
    console.warn('[anthropic-client] CF_AIG_TOKEN not set — bypassing CF AI Gateway, calls go direct to Anthropic (no gateway logging/caching)')
    return new Anthropic({ apiKey })
  }
  return new Anthropic({
    apiKey,
    baseURL: CF_GATEWAY_BASE,
    defaultHeaders: { 'cf-aig-authorization': `Bearer ${aigToken}` },
  })
}

/**
 * Direct Anthropic client that bypasses CF AI Gateway.
 *
 * Use for long-running Claude calls (>60s) that would otherwise be killed by
 * Cloudflare's gateway timeout (524). Marketing Plan generation is the primary
 * use case — it calls Claude with maxOutputTokens=8000 and can take 60-120s.
 *
 * Trade-off: no CF Gateway caching/logging for these calls, but the call
 * actually completes rather than returning HTML 524.
 */
export function getAnthropicClientDirect(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  }
  // No baseURL override — uses Anthropic SDK default (api.anthropic.com)
  return new Anthropic({ apiKey })
}

export interface ClaudeDocInput {
  type: 'pdf' | 'text'
  /** Base64 for PDF, plain string for text */
  content: string
  filename?: string
}

export interface ClaudeCallResult {
  text: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

/**
 * Call Claude with optional documents (PDFs or text blobs) and a user message.
 * Uses the beta messages API when PDFs are present (required for PDF support in SDK v0.32.x).
 *
 * @param bypassGateway - When true, calls Anthropic API directly (no CF Gateway).
 *   Use for long-running calls (>60s) to avoid Cloudflare 524 timeout.
 *   See: fix/marketing-plan-cf-timeout
 */
export async function callClaudeWithDocs(params: {
  systemPrompt: string
  userMessage: string
  docs?: ClaudeDocInput[]
  maxOutputTokens?: number
  bypassGateway?: boolean
}): Promise<ClaudeCallResult> {
  const { systemPrompt, userMessage, docs = [], maxOutputTokens = 8096, bypassGateway = false } = params

  const client = bypassGateway ? getAnthropicClientDirect() : getAnthropicClient()
  const hasPdfs = docs.some(d => d.type === 'pdf')

  // Build content array — docs first, then user message
  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = []

  for (const doc of docs) {
    if (doc.type === 'pdf') {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: doc.content,
        },
      } as Anthropic.Beta.Messages.BetaBase64PDFBlock)
    } else {
      content.push({
        type: 'text',
        text: doc.content,
      } as Anthropic.Beta.Messages.BetaTextBlockParam)
    }
  }

  content.push({
    type: 'text',
    text: userMessage,
  } as Anthropic.Beta.Messages.BetaTextBlockParam)

  let text: string
  let inputTok: number
  let outputTok: number

  if (hasPdfs) {
    // Beta API required for PDF document support
    const message = await client.beta.messages.create({
      model: MODEL_SONNET,
      max_tokens: maxOutputTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content }],
      betas: ['pdfs-2024-09-25'],
    })
    text = message.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
    inputTok = message.usage.input_tokens
    outputTok = message.usage.output_tokens
  } else {
    // Use stable API when no PDFs (avoids invalid empty anthropic-beta header)
    const stableContent: Anthropic.MessageParam['content'] = content.map(b => ({
      type: 'text',
      text: (b as Anthropic.Beta.Messages.BetaTextBlockParam).text ?? '',
    }))
    const message = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: maxOutputTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: stableContent }],
    })
    text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
    inputTok = message.usage.input_tokens
    outputTok = message.usage.output_tokens
  }

  const costUsd = (inputTok / 1_000_000) * PRICE_INPUT_PER_M
    + (outputTok / 1_000_000) * PRICE_OUTPUT_PER_M

  return { text, input_tokens: inputTok, output_tokens: outputTok, cost_usd: costUsd }
}

/**
 * Call Claude for a multi-turn conversation (used in brief refinement).
 */
export async function callClaudeChat(params: {
  systemPrompt: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  maxOutputTokens?: number
}): Promise<ClaudeCallResult> {
  const { systemPrompt, messages, maxOutputTokens = 4096 } = params

  const body = {
    model: MODEL_SONNET,
    max_tokens: maxOutputTokens,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  }

  let message: Anthropic.Message
  try {
    message = await getAnthropicClient().messages.create(body)
  } catch (sdkErr) {
    // SDK 兜底:@anthropic-ai/sdk 0.32.1(2024 年版)在 Node 24 上会
    // `Invalid response body ... Premature close` —— 同样的请求 curl/fetch 直连是通的,
    // 纯粹是老 SDK 的 HTTP 层与新版 Node 打架。2026-07-25 本机实测复现 100%。
    // 静默失败的代价:调用方(如 copy-generator)只会看到抛错并落模板兜底,
    // 表现为「AI 文案永远不生效」,极难反查。所以这里用原生 fetch 重试一次。
    const msg = sdkErr instanceof Error ? sdkErr.message : String(sdkErr)
    console.warn(`[anthropic-client] SDK 调用失败,改用原生 fetch 重试: ${msg}`)
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw sdkErr
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`Anthropic fetch fallback failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
    }
    message = (await res.json()) as Anthropic.Message
  }

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')

  const inputTok = message.usage.input_tokens
  const outputTok = message.usage.output_tokens
  const costUsd = (inputTok / 1_000_000) * PRICE_INPUT_PER_M
    + (outputTok / 1_000_000) * PRICE_OUTPUT_PER_M

  return { text, input_tokens: inputTok, output_tokens: outputTok, cost_usd: costUsd }
}

// ─── callClaudeWithWebSearch — Anthropic server-side web search helper ───────

const WEB_SEARCH_TOOL_VERSION = 'web_search_20250305' as const
const DEFAULT_WEB_SEARCH_MAX_USES = 5

export interface WebSearchCitation {
  url: string
  title?: string
}

export interface ClaudeWebSearchResult {
  text: string
  citations: WebSearchCitation[]
  input_tokens: number
  output_tokens: number
  cost_usd: number
  web_search_calls: number
}

/**
 * Call Claude with the server-side `web_search` tool enabled. Returns the
 * natural-language text portion plus deduped citations harvested from
 * `web_search_tool_result` blocks. Anthropic resolves web_search server-side,
 * so this is a single-call API — no client-side tool loop required.
 *
 * Used by market-context synthesis (P8.10.S3.4) and any future module that
 * needs Claude to ground its answer in current public web data.
 */
export async function callClaudeWithWebSearch(params: {
  systemPrompt: string
  userMessage: string
  maxOutputTokens?: number
  maxWebSearches?: number
  /** ISO country code for geo-targeting (e.g. 'AU', 'NZ'). */
  country?: string
  /** IANA timezone (e.g. 'Australia/Sydney'). */
  timezone?: string
}): Promise<ClaudeWebSearchResult> {
  const {
    systemPrompt,
    userMessage,
    maxOutputTokens = 2048,
    maxWebSearches = DEFAULT_WEB_SEARCH_MAX_USES,
    country,
    timezone,
  } = params

  const client = getAnthropicClient()

  const userLocation = country
    ? { type: 'approximate' as const, country, ...(timezone ? { timezone } : {}) }
    : undefined

  const tools = [
    {
      type: WEB_SEARCH_TOOL_VERSION,
      name: 'web_search',
      max_uses: maxWebSearches,
      ...(userLocation ? { user_location: userLocation } : {}),
    },
  ] as unknown as Anthropic.MessageCreateParams['tools']

  const message = await client.messages.create({
    model: MODEL_SONNET,
    max_tokens: maxOutputTokens,
    system: systemPrompt,
    tools,
    messages: [{ role: 'user', content: userMessage }],
  })

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n\n')
    .trim()

  const citations = extractWebSearchCitations(message.content)
  const webSearchCalls = countWebSearchCalls(message.content)

  const inputTok = message.usage.input_tokens
  const outputTok = message.usage.output_tokens
  const costUsd = (inputTok / 1_000_000) * PRICE_INPUT_PER_M
    + (outputTok / 1_000_000) * PRICE_OUTPUT_PER_M

  return {
    text,
    citations,
    input_tokens: inputTok,
    output_tokens: outputTok,
    cost_usd: costUsd,
    web_search_calls: webSearchCalls,
  }
}

function extractWebSearchCitations(content: Anthropic.ContentBlock[]): WebSearchCitation[] {
  const seen = new Set<string>()
  const out: WebSearchCitation[] = []
  for (const block of content) {
    const b = block as unknown as { type: string; content?: unknown }
    if (b.type !== 'web_search_tool_result') continue
    if (!Array.isArray(b.content)) continue
    for (const r of b.content) {
      if (!r || typeof r !== 'object') continue
      const url = (r as { url?: unknown }).url
      if (typeof url !== 'string' || seen.has(url)) continue
      seen.add(url)
      const title = (r as { title?: unknown }).title
      out.push({ url, ...(typeof title === 'string' ? { title } : {}) })
    }
  }
  return out
}

function countWebSearchCalls(content: Anthropic.ContentBlock[]): number {
  let n = 0
  for (const block of content) {
    const b = block as unknown as { type: string; name?: unknown }
    if (b.type === 'server_tool_use' && b.name === 'web_search') n++
  }
  return n
}

// ─── callClaudeWithTools — 通用 tool loop（鲁班执行代理 P8.12.S3.1）────────────

export interface ClaudeToolCall {
  name: string
  input: unknown
  result: string
  is_error: boolean
}

export interface ClaudeToolLoopResult {
  text: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  /** 实际执行了几轮工具（不含纯文本轮） */
  tool_rounds: number
  /** 全部工具调用明细 — 供持久化进 meta */
  tool_calls: ClaudeToolCall[]
  /**
   * 最终一轮 Claude 的 stop_reason。'max_tokens' 表示输出被截断 —
   * 调用方若要解析 JSON（如诸葛亮 conductor）必须检查此字段，
   * 否则截断的坏 JSON 会被 jsonrepair 静默补全成残缺结果（spec §3.4）。
   */
  stop_reason: string | null
}

const DEFAULT_MAX_TOOL_ROUNDS = 6
// 单轮 Claude 硬超时。20s 太紧 — 鲁班 system prompt 大、工具列表长，
// 仅初次调用本身就常 ~20s。给 60s 留余量，配合 route.ts maxDuration=180s。
const DEFAULT_PER_CALL_TIMEOUT_MS = 60_000

/** Promise.race 硬超时兜底，避免单轮 Claude 调用挂死。 */
function withClaudeTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}超过 ${(ms / 1000) | 0}s 超时`)), ms),
    ),
  ])
}

function extractTextFromBlocks(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
}

function buildToolLoopResult(
  text: string,
  inputTok: number,
  outputTok: number,
  toolRounds: number,
  toolCalls: ClaudeToolCall[],
  stopReason: string | null,
): ClaudeToolLoopResult {
  const costUsd = (inputTok / 1_000_000) * PRICE_INPUT_PER_M
    + (outputTok / 1_000_000) * PRICE_OUTPUT_PER_M
  return {
    text,
    input_tokens: inputTok,
    output_tokens: outputTok,
    cost_usd: costUsd,
    tool_rounds: toolRounds,
    tool_calls: toolCalls,
    stop_reason: stopReason,
  }
}

/**
 * Call Claude in a tool-use loop. Claude decides which tools to call; we resolve
 * the client-side handlers and feed results back until it emits a final text
 * answer or hits `maxToolRounds` (then one final tool-free call forces text).
 *
 * 通用 helper — 鲁班对话代理使用，华佗未来 tool 化也可复用。
 * 不影响 callClaudeChat（brief refinement 仍走无工具路径）。
 */
export async function callClaudeWithTools(params: {
  systemPrompt: string
  messages: Anthropic.MessageParam[]
  tools: Anthropic.Tool[]
  toolHandlers: Record<string, (input: unknown) => Promise<string>>
  maxOutputTokens?: number
  maxToolRounds?: number
  perCallTimeoutMs?: number
}): Promise<ClaudeToolLoopResult> {
  const {
    systemPrompt, messages, tools, toolHandlers,
    maxOutputTokens = 4096,
    maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS,
    perCallTimeoutMs = DEFAULT_PER_CALL_TIMEOUT_MS,
  } = params

  const client = getAnthropicClient()
  const convo: Anthropic.MessageParam[] = [...messages]

  let totalInput = 0
  let totalOutput = 0
  let toolRounds = 0
  const toolCalls: ClaudeToolCall[] = []

  for (let round = 0; round < maxToolRounds; round++) {
    const message = await withClaudeTimeout(
      client.messages.create({
        model: MODEL_SONNET,
        max_tokens: maxOutputTokens,
        system: systemPrompt,
        tools,
        messages: convo,
      }),
      perCallTimeoutMs,
      `Claude tool-loop 第 ${round + 1} 轮`,
    )

    totalInput += message.usage.input_tokens
    totalOutput += message.usage.output_tokens
    convo.push({ role: 'assistant', content: message.content })

    // end_turn / max_tokens / refusal — 不再用工具，收尾返回
    if (message.stop_reason !== 'tool_use') {
      return buildToolLoopResult(
        extractTextFromBlocks(message.content),
        totalInput, totalOutput, toolRounds, toolCalls,
        message.stop_reason,
      )
    }

    const toolUseBlocks = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )
    if (toolUseBlocks.length === 0) {
      // stop_reason 是 tool_use 但没有 tool_use block — 轻推继续
      convo.push({ role: 'user', content: 'Continue.' })
      continue
    }

    toolRounds++
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUseBlocks) {
      const handler = toolHandlers[tu.name]
      if (!handler) {
        const msg = `Unknown tool: ${tu.name}`
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: msg, is_error: true })
        toolCalls.push({ name: tu.name, input: tu.input, result: msg, is_error: true })
        continue
      }
      try {
        const result = await handler(tu.input)
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
        toolCalls.push({ name: tu.name, input: tu.input, result, is_error: false })
      } catch (err) {
        const msg = `Tool failed: ${err instanceof Error ? err.message : String(err)}`
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: msg, is_error: true })
        toolCalls.push({ name: tu.name, input: tu.input, result: msg, is_error: true })
      }
    }
    convo.push({ role: 'user', content: toolResults })
  }

  // 撞 maxToolRounds — 去掉 tools 再调一次，强制 Claude 给最终文本回复
  const finalMessage = await withClaudeTimeout(
    client.messages.create({
      model: MODEL_SONNET,
      max_tokens: maxOutputTokens,
      system: systemPrompt,
      messages: convo,
    }),
    perCallTimeoutMs,
    'Claude tool-loop 收尾',
  )
  totalInput += finalMessage.usage.input_tokens
  totalOutput += finalMessage.usage.output_tokens

  return buildToolLoopResult(
    extractTextFromBlocks(finalMessage.content),
    totalInput, totalOutput, toolRounds, toolCalls,
    finalMessage.stop_reason,
  )
}

/**
 * Parse a Claude response that should be JSON.
 * Robust extraction: finds the outermost { } block regardless of surrounding text.
 * Three-level fallback:
 *   1. Direct JSON.parse (fast path)
 *   2. sanitizeJsonControlChars → handles literal \n/\r/\t inside string values
 *   3. jsonrepair → handles unescaped quotes, trailing commas, and other LLM quirks
 */
export function parseJsonResponse<T>(text: string): T {
  const trimmed = text.trim()

  // Find the outermost JSON object
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object found in Claude response. Preview: ${trimmed.slice(0, 300)}`)
  }

  const raw = trimmed.slice(start, end + 1)

  // Level 1: direct parse (fast path)
  try {
    return JSON.parse(raw) as T
  } catch { /* fall through */ }

  // Level 2: sanitize literal control characters
  const sanitized = sanitizeJsonControlChars(raw)
  try {
    return JSON.parse(sanitized) as T
  } catch { /* fall through */ }

  // Level 3: jsonrepair handles unescaped quotes, trailing commas, etc.
  return JSON.parse(jsonrepair(sanitized)) as T
}

/**
 * Walk the raw JSON text character by character.
 * Inside string values, replace literal control characters with proper escape sequences.
 * Ignores already-escaped sequences (e.g. \\n stays \\n).
 */
function sanitizeJsonControlChars(str: string): string {
  let inString = false
  let escaped = false
  let result = ''

  for (const char of str) {
    if (escaped) {
      result += char
      escaped = false
      continue
    }
    if (char === '\\' && inString) {
      escaped = true
      result += char
      continue
    }
    if (char === '"') {
      inString = !inString
      result += char
      continue
    }
    if (inString) {
      if (char === '\n') { result += '\\n'; continue }
      if (char === '\r') { result += '\\r'; continue }
      if (char === '\t') { result += '\\t'; continue }
    }
    result += char
  }

  return result
}
