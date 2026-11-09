/**
 * Social Tune v1 — evaluator 层的共享类型。
 *
 * 只在 Gate B 步骤 1（evaluator 纯函数）用。**不**依赖 Supabase、Inngest、Meta Graph
 * 或任何 I/O：调用方（步骤 2 的 cohort 拉取层）负责把回执翻译成 PostMeasurement。
 *
 * 边界：这些类型只描述 Facebook Daily Plan Post 的 T+N 测量与建议。
 * 不做跨客户、跨支柱 benchmark。CTS 只是测试数据来源，客户 / 行业事实不进类型。
 */

/** 与 social-post-measurement 存储层一致的三态。 */
export type PostMeasurementStatus = 'ok' | 'partial' | 'unmeasurable'

/** 一个测量窗口（T+4 或 T+72）的最小可评估形状。 */
export interface PostMeasurement {
  /** flywheel_actions.id — lineage 唯一标识 */
  actionId:     string
  /** 4 或 72 */
  windowHours:  number
  status:       PostMeasurementStatus
  /** metric key（POST_METRIC_KEYS 的 key，例如 'likes' / 'comments' / 'shares'）→ 数值 */
  values:       Partial<Record<PostMetricField, number>>
  /** metric key → 缺失原因（例如 'omitted_unverified'） */
  missing:      Partial<Record<PostMetricField, string>>
}

/** 与 post-measurement-store 的 POST_METRIC_KEYS 对齐（保持字段名同源）。 */
export type PostMetricField = 'likes' | 'comments' | 'shares'

/** evaluator 输入。target 是要评估的这一条，cohort 是同客户 + 同活动 + 同窗口的历史（不含 target 自己）。 */
export interface PostEvaluationInput {
  target: PostMeasurement
  cohort: PostMeasurement[]
  /** 可选阈值覆盖。默认见 evaluator 常量。Playbook / Profile 未来可以传不同值。 */
  thresholds?: Partial<TuneThresholds>
}

export interface TuneThresholds {
  /** cohort 里至少要有几条可比样本 */
  minSampleSize:     number
  /** delta% ≥ 此值 → REPEAT */
  repeatDeltaPct:    number
  /** delta% ≤ 此值 → STOP */
  stopDeltaPct:      number
}

/** 4 种终局决策 + 一种「说不了」。 */
export type TuneDecision = 'REPEAT' | 'ITERATE' | 'STOP' | 'INCONCLUSIVE'

/** 判定不了的原因，用于 UI 与 lineage 追溯。 */
export type InconclusiveReason =
  | 'missing_t72'              // target 不是 T+72 窗口
  | 'unmeasurable_target'      // target.status === 'unmeasurable'
  | 'no_comparable_metric'     // target 与 cohort 没有共同的主指标
  | 'insufficient_cohort'      // 可比样本数 < minSampleSize

export interface TuneRecommendation {
  decision:         TuneDecision
  /** 说人话的一句解释。不含客户名 / 行业词。 */
  rationale:        string
  /** INCONCLUSIVE 时必填。 */
  inconclusiveReason?: InconclusiveReason
  /** 用了哪个 metric 做判断（likes / comments）；INCONCLUSIVE 时可能 null。 */
  primaryMetric?:   PostMetricField | null
  targetValue?:     number | null
  cohortMean?:      number | null
  deltaPct?:        number | null
  /** 实际参与均值计算的可比样本数（不是 cohort 输入总数）。 */
  sampleSize:       number
  /** 例如 'shares_missing_on_target' / 'shares_missing_across_cohort' / 't4_only'。 */
  caveats:          string[]
  /** lineage：判断依据来自哪些 action。第一条永远是 target.actionId。 */
  sourceActionIds:  string[]
  /** 实际生效的阈值（可能被入参覆盖）。 */
  thresholdsUsed:   TuneThresholds
}
