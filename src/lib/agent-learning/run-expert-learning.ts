/**
 * 第一次正式专家学习：名册 RSS → 蒸馏 → 脱敏闸 → 未启用候选经验。
 *
 * - 依赖全部注入（抓取、LLM、账本、写库），本文件不 import supabase / SDK。
 * - 机器只写 `isActive:false` 的候选；"启用"= Ray 在广告引擎页点开，本文件不做。
 * - `dryRun` 时不写库，只把候选连同脱敏结论一起返回；返回里不含文章正文。
 * - 账本由调用方传入（路由用内存版）：额度是**单次运行**的 0.20 美元硬上限，不跨运行累计。
 * - 已存在的 lesson_key 一律跳过，避免重跑把 Ray 已点开的经验改回未启用。
 */

import { createHash } from 'node:crypto'
import type { BudgetLedger } from '@/lib/agent-learning/budget/types'
import { contentHash, fetchFeedItems, type FetchText } from '@/lib/agent-learning/collect/feeds'
import type { DistilledRule } from '@/lib/agent-learning/contracts'
import { distillOne, type DistillLlm } from '@/lib/agent-learning/distill/run'
import { EXPERT_ROSTER, suggestedValidUntil } from '@/lib/agent-learning/expert-roster'
import type { LessonInput, WriteLessonResult } from '@/lib/memory/write-lesson'
import type { ShareabilityVerdict } from '@/lib/memory/lesson-shareability'

/** 正文太短蒸馏不出东西，不花额度 */
const MIN_TEXT_CHARS = 200
const CANDIDATE_CONFIDENCE = 0.7
export const MAX_PER_SOURCE = 5
export const DEFAULT_PER_SOURCE = 3

export interface ExpertRunDeps {
  fetchText: FetchText
  llm: DistillLlm
  ledger: BudgetLedger
  now: () => Date
  /** 返回这批 key 里库里已经有的 */
  existingKeys: (keys: string[]) => Promise<string[]>
  /** 只读脱敏检查（dryRun 与真写都先过一遍） */
  checkShareable: (lesson: string, rationale: string | null) => Promise<ShareabilityVerdict>
  writeLesson: (input: LessonInput) => Promise<WriteLessonResult>
}

export interface CandidateLine {
  lessonKey: string
  rule: string
  expert: string
  url: string
  quote: string
  validUntilSuggested: string
  outcome: 'would_write' | 'written' | 'exists_skipped' | 'not_shareable' | 'write_failed'
  detail: string | null
}

export interface ExpertRunSummary {
  dryRun: boolean
  sources: Array<{ sourceKey: string; fetched: number; error: string | null }>
  itemsDistilled: number
  itemsSkipped: number
  itemsFailed: number
  candidates: CandidateLine[]
  costUsd: number
}

/** 同一来源同一规则句得到同一个 key，重跑幂等 */
export function candidateKey(sourceKey: string, rule: string): string {
  const h = createHash('sha256').update(rule.trim().toLowerCase(), 'utf8').digest('hex').slice(0, 12)
  return `expert-${sourceKey}-${h}`
}

/** 候选 → 写库入参：来源、链接、日期、引用、建议有效期全进 evidence（不进提示词） */
export function toLessonInput(rule: DistilledRule, sourceKey: string, validUntil: string): LessonInput {
  const card = rule.sourceCard
  return {
    lessonKey: candidateKey(sourceKey, rule.rule),
    scope: 'global',
    lesson: rule.rule,
    rationale: rule.rationale,
    confidence: CANDIDATE_CONFIDENCE,
    isActive: false,
    evidence: {
      kind: 'expert_rss_candidate',
      expert: card.expert,
      url: card.url,
      publishedAt: card.publishedAt,
      domain: card.domain,
      quote: card.quote,
      authorClaims: rule.authorClaims,
      suggestedValidUntil: validUntil,
    },
  }
}

interface Pending {
  line: CandidateLine
  input: LessonInput
}

export async function runExpertLearning(
  deps: ExpertRunDeps,
  opts: { dryRun: boolean; perSource: number },
): Promise<ExpertRunSummary> {
  const perSource = Math.min(Math.max(1, Math.floor(opts.perSource)), MAX_PER_SOURCE)
  const summary: ExpertRunSummary = {
    dryRun: opts.dryRun,
    sources: [],
    itemsDistilled: 0,
    itemsSkipped: 0,
    itemsFailed: 0,
    candidates: [],
    costUsd: 0,
  }
  const pending: Pending[] = []
  const seen = new Set<string>()
  let stopped = false

  for (const source of EXPERT_ROSTER) {
    if (stopped) break
    const feed = await fetchFeedItems(
      { fetchText: deps.fetchText },
      { sourceKey: source.sourceKey, feedUrl: source.feedUrl },
      { limit: perSource },
    )
    if (!feed.ok) {
      summary.sources.push({ sourceKey: source.sourceKey, fetched: 0, error: feed.error })
      continue
    }
    summary.sources.push({ sourceKey: source.sourceKey, fetched: feed.value.length, error: null })

    for (const item of feed.value) {
      const hash = contentHash(item.text.length > 0 ? item.text : item.title)
      if (seen.has(hash) || item.text.trim().length < MIN_TEXT_CHARS) {
        summary.itemsSkipped += 1
        continue
      }
      seen.add(hash)

      const result = await distillOne(
        { llm: deps.llm, ledger: deps.ledger, now: deps.now },
        { externalRef: item.externalRef, title: item.title, text: item.text, publishedAt: item.publishedAt },
        { sourceKey: source.sourceKey, expert: source.expert, domain: source.domain },
        1,
      )
      if (!result.ok) {
        summary.itemsFailed += 1
        // 额度被拒，后面的条目也会被拒，直接停，不空转
        if (result.code === 'gate_blocked') {
          stopped = true
          break
        }
        continue
      }
      summary.itemsDistilled += 1
      summary.costUsd += result.value.actualUsd
      for (const rule of result.value.rules) {
        const validUntil = suggestedValidUntil(source.domain, rule.sourceCard.publishedAt, deps.now())
        const input = toLessonInput(rule, source.sourceKey, validUntil)
        pending.push({
          input,
          line: {
            lessonKey: input.lessonKey,
            rule: rule.rule,
            expert: rule.sourceCard.expert,
            url: rule.sourceCard.url,
            quote: rule.sourceCard.quote,
            validUntilSuggested: validUntil,
            outcome: 'would_write',
            detail: null,
          },
        })
      }
    }
  }

  await settleCandidates(deps, pending, opts.dryRun)
  summary.candidates = pending.map((p) => p.line)
  return summary
}

/** 跳过已存在 → 脱敏 → （非 dryRun）写入 */
async function settleCandidates(deps: ExpertRunDeps, pending: Pending[], dryRun: boolean): Promise<void> {
  const existing = new Set(await deps.existingKeys(pending.map((p) => p.line.lessonKey)))
  for (const { line, input } of pending) {
    if (existing.has(line.lessonKey)) {
      line.outcome = 'exists_skipped'
      continue
    }
    const verdict = await deps.checkShareable(input.lesson, input.rationale ?? null)
    if (!verdict.shareable) {
      line.outcome = 'not_shareable'
      line.detail = verdict.summary
      continue
    }
    if (dryRun) continue

    const r = await deps.writeLesson(input)
    if (r.ok) {
      line.outcome = 'written'
    } else {
      line.outcome = 'write_failed'
      line.detail = r.reason === 'not_shareable' ? r.verdict.summary : r.error
    }
  }
}
