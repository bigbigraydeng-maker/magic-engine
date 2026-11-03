/**
 * 包拯每周运行记录（`cron_run_logs.summary`）里存的形状。今日待办、复核页、下一轮准确率都从这里读，
 * 所以字段只加不改。客人原话、姓名不进这里（规则书 R5）。
 */

import type { ReviewResult, Ruling, StageAccuracy } from './accuracy'
import type { Outcome } from './outcome'

export const BAOZHENG_JOB = 'baozheng-weekly'
/** 被复核的判断种类：CRM「AI 读对话判阶段」。以后接别的 AI 判断，各加一个种类。 */
export const STAGE_JUDGEMENT_KIND = 'crm_stage'
/** 人裁定存在 crm_segment_feedback.segment 里的前缀：`baozheng:<判断记录 id>`。 */
export const RULING_SEGMENT_PREFIX = 'baozheng:'
export const RULINGS: readonly Ruling[] = ['ai_right', 'review_right', 'neither']

/** sample = 上周的判断；disagreement = 另一个 AI 改过的（单独报，不进准确率）；pool = 读不出来落池的（查漏判） */
export type ReviewKind = 'sample' | 'disagreement' | 'pool'

export interface StoredReview {
  judgment_id: string
  contact_id: string
  kind: ReviewKind
  ai_stage: string
  /** null = 复核模型读不出来，或这次没复核 */
  review_stage: string | null
  /** kind = pool 时：disagree = 疑似漏判（复核判成深入在谈 / 已成交），agree = 没漏 */
  result: ReviewResult
  /** 复核模型的一句理由（不带客人信息），或没复核的原因 */
  reason: string | null
  /** 判断那一刻（截对话用） */
  judged_at: string
  reviewed_at: string
}

export type OutcomeCounts = Record<Outcome, number>

export interface ClientRunSummary {
  client_id: string
  status: 'reviewed' | 'disabled' | 'failed'
  reason: string | null
  /** 全部历史判断按 BZ-06～14 分的个数 */
  outcomes: OutcomeCounts | null
  /** 不带原话的同一 AI 写入：读不出来落池 / 规则判 */
  pool_writes_last_week: number
  reviews: StoredReview[]
  /** 最近 8 周、只算 kind = sample */
  accuracy: StageAccuracy[]
  /** kind = pool 里复核判成「深入在谈 / 已成交」的个数 */
  suspected_missed: number
  cost_usd: number
}

export interface BaozhengRunSummary {
  agent: 'baozheng'
  judgement_kind: typeof STAGE_JUDGEMENT_KIND
  week: string
  produced: number
  undeterminable: number
  reasons: string[]
  cost_usd: number
  no_publish: true
  clients: ClientRunSummary[]
}
