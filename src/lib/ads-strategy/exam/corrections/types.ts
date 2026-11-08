import type { ExamExpect, ExamQuestion } from '../questions'

/** PM 指出广告 agent / 规则「判错了」时的归类。 */
export type AdsCorrectionKind =
  | 'diagnosis'
  | 'draft_advice'
  | 'metrics_read'
  | 'suggestion'

/** 一条机器可读的纠正记录（仓库内 JSON，不含客户私有 ID）。 */
export interface AdsAgentCorrection {
  readonly id: string
  /** YYYY-MM-DD */
  readonly recordedOn: string
  /** 固定枚举，不写真人姓名。 */
  readonly saidBy: 'pm'
  readonly kind: AdsCorrectionKind
  /** 错在哪：系统或 agent 当时说了什么（脱敏文案）。 */
  readonly wrongSummary: string
  /** 正确答案应该是什么（脱敏文案）。 */
  readonly correctSummary: string
  /** 出处：台账指针 / 文档指针，如 ledger:2026-11-03-… */
  readonly source: string
  /** 已升入正式考卷题号（如 Q23）后填写；有此字段则不再出现在候选输出。 */
  readonly promoted_to?: string
}

/** 考卷候选题：结构同正式题，但未并入 ADS_EXAM_QUESTIONS。 */
export interface ExamCandidateQuestion extends ExamQuestion {
  readonly lifecycle: 'candidate'
  readonly correctionId: string
}

export const CORRECTION_RECORD_SCHEMA_VERSION = 1 as const

export interface AdsCorrectionRecordsFile {
  readonly schemaVersion: typeof CORRECTION_RECORD_SCHEMA_VERSION
  readonly corrections: readonly AdsAgentCorrection[]
}
