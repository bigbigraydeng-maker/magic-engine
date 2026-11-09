/**
 * Client knowledge base — communication style/pattern mining (issue #1760).
 *
 * `mining.ts::runKnowledgeMining` (issue #1645) already extracts ONE thing:
 * reusable numeric/policy FACTS from individual reply templates — that
 * covers #1760's "①还没进知识库的事实性信息". This file adds the two NEW
 * pieces #1760 asks for — "②常见问题的标准应对方式" and "③说话语气/套路" —
 * as a SEPARATE, additive entry point rather than folding it into that
 * function's per-template loop, for two reasons:
 *
 * 1. Tone/style is a CORPUS-level observation ("this business is usually
 *    warm and informal"), not a per-message one — judging it from a single
 *    isolated template the way `extractCandidatesFromTemplate` judges a
 *    single fact would only ever see one data point and could never tell
 *    "this business's style" from "this one reply's phrasing". So this asks
 *    the model to look at a SAMPLE of a client's most-repeated templates
 *    together, in one call, and only report a pattern it says is visible
 *    ACROSS multiple of them.
 * 2. `runKnowledgeMining` is extensively covered by
 *    `__tests__/mining-orchestration.test.ts`, which asserts exact
 *    `modelCallsUsed`/`costUsd` values keyed to one model call per template.
 *    Adding an unconditional extra call inside that loop would silently
 *    change those numbers for every existing test and caller already
 *    depending on that function's cost/call-count behaviour — the kind of
 *    "improve something nobody asked to touch" change CLAUDE.md's 「外科
 *    手术式改动」rule exists to prevent. A human (or a future, separately-
 *    reviewed cron) calls `runStylePatternMining` here on its own.
 *
 * Per issue #1760's explicit scope ("先跑通一次性提炼的手动流程，不用同时
 * 处理自动定期重新提炼"), this does NOT do incremental watermark scanning
 * like the fact-mining pass — every call re-reads the client's message
 * history from scratch (bounded by `budget.maxMessages`, same fail-closed
 * budget discipline as mining.ts). Re-running it costs one more model call
 * and produces `ON CONFLICT DO NOTHING` no-ops for identical patterns, never
 * duplicate candidates or duplicate spend beyond that one call.
 *
 * Writes land in the SAME `client_knowledge_facts` table `runKnowledgeMining`
 * writes to, always `status='candidate'` — the existing FDE review queue
 * (issue #1646, `src/lib/knowledge/review.ts`) and `getClientKnowledge`
 * (issue #1644, `src/lib/knowledge/read.ts`) need zero changes to handle
 * these rows: `fact_key`/`scope`/`source_kind` are all unconstrained text on
 * that table specifically so new mining flavours can add a namespace without
 * a migration (see that table's column comments).
 */

import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { callClaudeChat } from '@/lib/anthropic/client'
import { jsonrepair } from 'jsonrepair'
import {
  groupMessagesIntoTemplates,
  redactPersonalInfo,
  estimateWorstCaseExtractionCostUsd,
  computeCandidateFingerprint,
  fetchConversationIds,
  fetchMessagesSince,
  upsertRunRow,
  asRows,
  EXTRACTION_MAX_OUTPUT_TOKENS,
  DEFAULT_CANDIDATE_VALID_DAYS,
  type RawMessage,
  type MiningBudget,
  type NewFactRow,
} from './mining'
import { detectSensitivity } from './sensitivity'

export interface StylePatternCandidate {
  /** Short stable identifier, namespaced by category below into `style.*` / `response.*` before it becomes a `fact_key`. */
  patternKey: string
  category: 'tone' | 'standard_response'
  statement: string
  /**
   * 1-based indices into the sample (matching the `#N` labels in the
   * prompt) the model says actually back this pattern. 🔴 魏征复审
   * （2026-09-15）指出：原实现的 `evidence` 只有一个模板计数，FDE 复审时
   * 没法对照原文核实这条候选是不是真的从样本里总结出来的，还是模型编的
   * ——跟事实萃取"evidence 里能看到源模板"的标准比明显更弱。这个字段让
   * `stylePatternsToFactRows` 能把具体支撑的模板摘要写进 evidence。
   */
  supportingIndices: number[]
}

/**
 * Same "not a one-off" bar as fact mining (`mining.ts::classifyCandidateSpecificity`):
 * a template that only ever appeared in one conversation cannot be evidence
 * of a usual STYLE any more than it can be evidence of a usual FACT.
 */
const MIN_STYLE_TEMPLATE_OCCURRENCES = 2
/** Keeps the prompt (and its cost) bounded regardless of how many distinct templates a client has accumulated — the model only needs a representative sample, not the whole corpus, to notice a repeated pattern. */
const MAX_STYLE_SAMPLE_TEMPLATES = 30

export const STYLE_EXTRACTION_SYSTEM_PROMPT = `You study a SAMPLE of a business's most-repeated employee reply templates (each with the customer question it usually follows), and summarize STABLE PATTERNS in how this business talks to customers. A separate process already extracts factual claims (pricing/policy/etc) from these same messages — do not repeat those; you are only looking for communication PATTERNS.

Extract up to two kinds of pattern, ONLY if it is visible across MULTIPLE templates in the sample (a single template is never evidence of a "usual" pattern, no matter how distinctive it looks):

1. "standard_response" — for a recurring TYPE of customer question, describe the business's standard way of answering it (the structure/content pattern across occurrences, not a verbatim copy of any one template).
2. "tone" — overall communication style observations that hold consistently across the sample (formality level, warmth, greeting/closing conventions, emoji use, language switching).

If nothing in the sample is clearly a repeated pattern, return an empty array — do not invent a pattern to have something to report.

For every pattern, list the 1-based "#N" sample numbers that actually show it — a human reviewer will look those exact templates up to check your claim, so this list must be real, not padded or guessed.

Respond with ONLY a JSON object, no prose, shaped exactly like:
{
  "patterns": [
    {
      "pattern_key": "short.stable.identifier",
      "category": "tone" | "standard_response",
      "statement": "human-readable description, in the same language as the source templates",
      "supporting_indices": [1, 4, 7]
    }
  ]
}`

export function parseStyleExtractionResponse(raw: string): StylePatternCandidate[] {
  const repaired = jsonrepair(raw.trim())
  const parsed = JSON.parse(repaired) as { patterns?: unknown }
  const rawPatterns = Array.isArray(parsed.patterns) ? parsed.patterns : []
  const result: StylePatternCandidate[] = []
  for (const p of rawPatterns) {
    if (!p || typeof p !== 'object') continue
    const r = p as Record<string, unknown>
    if (typeof r.pattern_key !== 'string' || typeof r.statement !== 'string') continue
    if (r.category !== 'tone' && r.category !== 'standard_response') continue
    const supportingIndices = Array.isArray(r.supporting_indices)
      ? r.supporting_indices.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0)
      : []
    result.push({ patternKey: r.pattern_key, category: r.category, statement: r.statement, supportingIndices })
  }
  return result
}

export interface StylePatternSample {
  sampleBody: string
  precedingCustomerQuestion: string | null
}

/** One LLM call over a whole sample (not one call per template — see file header for why). */
export async function extractStylePatterns(
  sample: StylePatternSample[],
): Promise<{ patterns: StylePatternCandidate[]; costUsd: number }> {
  if (sample.length === 0) return { patterns: [], costUsd: 0 }

  const userPrompt = sample
    .map((t, i) => {
      const reply = redactPersonalInfo(t.sampleBody).text
      const question = t.precedingCustomerQuestion ? redactPersonalInfo(t.precedingCustomerQuestion).text : null
      return `#${i + 1}${question ? `\nCustomer asked: ${question}` : ''}\nEmployee replied: ${reply}`
    })
    .join('\n\n')

  const result = await callClaudeChat({
    systemPrompt: STYLE_EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
  })

  return { patterns: parseStyleExtractionResponse(result.text), costUsd: result.cost_usd }
}

export interface StyleMiningReceipt {
  runId: string | null
  status: 'succeeded' | 'failed' | 'skipped_no_data' | 'skipped_already_run'
  templatesConsidered: number
  patternsWritten: number
  costUsd: number
  error?: string
}

/**
 * Turn a batch of extracted patterns into `client_knowledge_facts` candidate
 * rows. Pulled out of `runStylePatternMining` on its own so the write shape
 * (namespacing, forced `sensitivity: 'general'`, evidence payload) is
 * independently testable without a database.
 */
export function stylePatternsToFactRows(
  clientId: string,
  patterns: StylePatternCandidate[],
  sample: StylePatternSample[],
): NewFactRow[] {
  return patterns.map((p) => ({
    client_id: clientId,
    // Namespaced so these never collide with the fact-mining namespaces
    // (`company.*`/`policy.*`/`support.*`) or with each other.
    fact_key: `${p.category === 'tone' ? 'style' : 'response'}.${p.patternKey}`,
    scope: {},
    statement: p.statement,
    structured_value: null,
    status: 'candidate',
    visibility: 'internal_only',
    // 🔴 子牙复审（2026-09-15）指出的真实缺口，已修：'tone' 类观察（问候
    // 习惯/语气/emoji 使用）从不携带事实内容，锁死 'general' 是安全的——
    // 但 'standard_response' 类恰恰是"这个客户平时怎么回答某类问题"，issue
    // #1760 自己举的例子就是"客户问退款政策时通常这样回答"，这句话表面是
    // "风格观察"，内容却是在复述一条 policy/commitment。原实现对两个类别
    // 都无差别锁 'general'，会让一条过时/作废的政策/价格承诺套着"标准应对
    // 套路"的壳子跳过 read.ts 的客户二次确认双签闸——正是 sensitivity.ts
    // 文件头点名要防的那类事故（CTS"AI 报停售团"）在这里重演的路径。现在
    // 对 'standard_response' 真正跑一遍跟事实萃取同一个分类器，只有
    // 'tone' 才保留硬编码。
    sensitivity: p.category === 'tone' ? 'general' : detectSensitivity(p.statement),
    valid_until: new Date(Date.now() + DEFAULT_CANDIDATE_VALID_DAYS * 86_400_000).toISOString(),
    source_kind: 'conversation_mining_style',
    // 🔴 魏征复审（2026-09-15）指出：只存一个模板计数，FDE 复审时没法对照
    // 原文核实这条候选是不是真的从样本总结出来的，还是模型编的——现在把
    // 模型自己指认的支撑样本摘要也存进 evidence，可核实性对齐事实萃取
    // （mining.ts 的 evidence 也留了 first_seen_at/last_seen_at 这类可回查
    // 字段，不只是一个次数）。
    evidence: {
      templates_considered: sample.length,
      category: p.category,
      supporting_samples: p.supportingIndices
        .map((i) => sample[i - 1])
        .filter((t): t is StylePatternSample => t !== undefined)
        .map((t) => t.sampleBody),
    },
    conflict_group_id: null,
    value_fingerprint: computeCandidateFingerprint(p.statement, null),
  }))
}

/**
 * Run one client's style/pattern mining pass. Unlike `runKnowledgeMining`,
 * this always re-scans from scratch (no watermark) and makes exactly one
 * model call — see the file header for why both are deliberate for this
 * issue's scope.
 *
 * `budget` only needs the two caps that actually bound this function's one
 * call: how many messages to read, and the worst-case spend ceiling. There
 * is no `maxModelCalls` to configure — it is always exactly 1.
 */
export async function runStylePatternMining(
  clientId: string,
  budget: Pick<MiningBudget, 'maxMessages' | 'maxSpendUsd'>,
  requestId: string = randomUUID(),
): Promise<StyleMiningReceipt> {
  if (!budget.maxMessages || budget.maxMessages <= 0) {
    throw new Error('runStylePatternMining: maxMessages must be a positive number')
  }
  if (!budget.maxSpendUsd || budget.maxSpendUsd <= 0) {
    throw new Error('runStylePatternMining: maxSpendUsd must be a positive number')
  }

  // Idempotency at the request_id layer, same table/index as fact mining —
  // a retry of the SAME request must never re-spend or re-write. Unlike
  // `runKnowledgeMining`, a non-terminal (running/queued) row is left alone
  // rather than reclaimed: this is a manual, human-triggered, single-model-
  // call flow (issue #1760's explicit "no recurring automation" scope), so
  // a stuck row from a genuinely crashed attempt is rare enough that
  // requiring a human to notice and re-trigger with a fresh request id is an
  // acceptable, deliberately-simpler tradeoff than building the same
  // crash-recovery machinery `runKnowledgeMining` needed for its heavier,
  // multi-step, potentially-cron-driven use.
  const existing = await supabaseAdmin
    .from('client_knowledge_mining_runs')
    .select('id, status, error, candidates_found, llm_cost_usd')
    .eq('request_id', requestId)
    .maybeSingle()
  if (existing.error) {
    throw new Error(`runStylePatternMining: idempotency check failed: ${existing.error.message}`)
  }
  if (existing.data) {
    const row = existing.data as {
      id: string
      status: string
      error: string | null
      candidates_found: number
      llm_cost_usd: number | null
    }
    if (row.status === 'succeeded' || row.status === 'failed') {
      return {
        runId: row.id,
        status: row.status as 'succeeded' | 'failed',
        templatesConsidered: 0,
        patternsWritten: row.candidates_found,
        costUsd: row.llm_cost_usd ?? 0,
        ...(row.error ? { error: row.error } : {}),
      }
    }
    return { runId: row.id, status: 'skipped_already_run', templatesConsidered: 0, patternsWritten: 0, costUsd: 0 }
  }

  let conversationIds: string[]
  let messages: RawMessage[]
  try {
    conversationIds = await fetchConversationIds(clientId)
    messages = await fetchMessagesSince(conversationIds, null, budget.maxMessages)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { runId: null, status: 'failed', templatesConsidered: 0, patternsWritten: 0, costUsd: 0, error: message }
  }

  const templates = groupMessagesIntoTemplates(messages)
  const eligible = templates.filter((t) => t.distinctConversationCount >= MIN_STYLE_TEMPLATE_OCCURRENCES)
  if (eligible.length === 0) {
    return { runId: null, status: 'skipped_no_data', templatesConsidered: 0, patternsWritten: 0, costUsd: 0 }
  }
  const sample = eligible.slice(0, MAX_STYLE_SAMPLE_TEMPLATES)

  const estimatedCost = estimateWorstCaseExtractionCostUsd(sample.map((t) => t.sampleBody).join(' '))
  if (estimatedCost > budget.maxSpendUsd) {
    return {
      runId: null,
      status: 'failed',
      templatesConsidered: sample.length,
      patternsWritten: 0,
      costUsd: 0,
      error: 'estimated_cost_exceeds_budget',
    }
  }

  const runId = await upsertRunRow(null, {
    request_id: requestId,
    client_id: clientId,
    status: 'running',
    conversations_scanned: conversationIds.length,
    messages_scanned: messages.length,
    max_messages_cap: budget.maxMessages,
    max_model_calls_cap: 1,
    max_spend_usd_cap: budget.maxSpendUsd,
    started_at: new Date().toISOString(),
  })
  if (!runId) throw new Error('runStylePatternMining: could not create run row')

  try {
    const { patterns, costUsd } = await extractStylePatterns(sample)
    const rows = stylePatternsToFactRows(clientId, patterns, sample)

    let patternsWritten = 0
    if (rows.length > 0) {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('client_knowledge_facts')
        .upsert(rows, { onConflict: 'client_id,fact_key,scope,value_fingerprint', ignoreDuplicates: true })
        .select('id')
      if (insertError) throw new Error(`style candidate write failed: ${insertError.message}`)
      patternsWritten = asRows<{ id: string }>(inserted).length
    }

    await supabaseAdmin
      .from('client_knowledge_mining_runs')
      .update({
        status: 'succeeded',
        candidates_found: patternsWritten,
        llm_cost_usd: costUsd,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId)

    return { runId, status: 'succeeded', templatesConsidered: sample.length, patternsWritten, costUsd }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await supabaseAdmin
      .from('client_knowledge_mining_runs')
      .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
      .eq('id', runId)
    return {
      runId,
      status: 'failed',
      templatesConsidered: sample.length,
      patternsWritten: 0,
      costUsd: 0,
      error: message,
    }
  }
}
