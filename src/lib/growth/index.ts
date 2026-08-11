/**
 * Magic Engine 2.0 · Growth Module 契约 —— 对外门面（Issue #877 / WP01）
 *
 * 这里**只有**类型与纯校验器。没有执行、没有授权、没有持久化、没有 provider
 * 调用、没有域推理，也没有任何 legacy 兼容适配器 —— 调研逐字段核过之后确认
 * 没有一个既有形状的语义是完整的（见 #877 的调研回执 Q5）。
 *
 * 🔴 想让系统做事只有一条路：提交一个 `action_run` 交给执行内核。本模块
 *    产出的是**候选**，不是命令。
 */

export type {
  GrowthUnknownReason,
  GrowthMaybeUnknown,
  GrowthJsonValue,
  GrowthEvidence,
  GrowthFinding,
  GrowthPrescription,
  GrowthActionCandidateIdentity,
  GrowthActionCandidate,
  GrowthVerificationDefinition,
} from './types'

export {
  validateGrowthEvidence,
  validateGrowthFinding,
  validateGrowthPrescription,
  validateGrowthActionCandidate,
  validateGrowthVerificationDefinition,
  type GrowthValidationResult,
} from './validators'
