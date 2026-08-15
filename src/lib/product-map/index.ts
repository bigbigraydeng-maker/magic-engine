/**
 * ME2 Product Map v1 —— 公共门面（Issue #974）。
 *
 * PR2 的 reconciliation cron / webhook 路由、PR3 的 Dashboard 都从这里导入，
 * 不直接伸进子模块 —— 子模块内部文件划分允许在后续 PR 调整，门面签名是稳定契约。
 */

export type {
  BusinessLane,
  ComponentBlocker,
  ComponentType,
  DapeStage,
  EvidenceRecord,
  Maturity,
  MaturityEvidenceFlags,
  RegistryComponent,
  RiskLevel,
} from './types'

export { MATURITY_ORDER, deriveMaturityCeiling, isMaturityAbove } from './maturity'

export type { ProductMapValidationResult } from './validators'
export { validateEvidenceRecord, validateMaturityEvidenceFlags, validateRegistryComponent } from './validators'

export type { GraphValidationResult } from './graph'
export {
  findDependencyCycle,
  findUnclassifiedIssueNumbers,
  findUnclassifiedPullRequestNumbers,
  findUnclassifiedSourcePaths,
  validateRegistryGraph,
} from './graph'

export type {
  GithubCheckRun,
  GithubIssueSnapshot,
  GithubOpenPullRequestSummary,
  GithubPullRequestSnapshot,
  PullRequestState,
} from './github-adapter'
export {
  GithubSyncError,
  getIssueSnapshot,
  getMainSha,
  getPullRequestSnapshot,
  listOpenPullRequests,
} from './github-adapter'

export type { ComponentSyncSnapshot, SyncOutcome } from './reconciliation'
export { mergeSyncSnapshot, runSyncStep, shouldProcessDelivery } from './reconciliation'

export { SEED_COMPONENTS } from './registry-data/seed-components'
