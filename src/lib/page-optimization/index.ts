/**
 * Magic Engine 2.0 · Page Optimization 共享能力 —— 对外门面（Issue #878 / WP06）
 *
 * 这里只有类型与 provider-neutral 的纯/确定性函数——resolve / draft / diff /
 * validate。没有执行、没有授权、没有落库、没有 provider 客户端 import、没有
 * 模型调用。
 *
 * 🔴 `snapshot` 不在这里——它要读 provider，实现落在
 *    `src/lib/capabilities/page-optimization/snapshot.ts`（WP00 Page 契约 §7
 *    的物理边界：会 import provider-write 模块的代码只能落在 capabilities/
 *    下）。调用方自己决定什么时候跨过这条边界去拿快照，本门面不替它做。
 *
 * 🔴 想让系统真的把改动写出去只有一条路——WP07 的 Kernel 授权 apply。本模块
 *    产出的是可评审的准备结果，不是命令。
 */

export {
  PAGE_OPTIMIZATION_FIELDS,
  type PageOptimizationField,
  type PageOptimizationIntent,
  type PageOptimizationRequest,
  type PageCanonicalIdentity,
  type PageResolution,
  type PageSnapshot,
  type GithubPageSnapshot,
  type WordpressPageSnapshot,
  type UnavailablePageSnapshot,
  type PageDraftField,
  type PageDraftResult,
  type PageFieldDiff,
  type PageDiffResult,
  type RedlineCheckInput,
  type ProviderCheckInput,
  type PageValidationResult,
} from './types'

export { resolvePage, resolveRouting, resolveCanonicalIdentity, type ResolvePageInput } from './resolve'
export { draftPageChange, extractGithubFieldValue } from './draft'
export { diffPageChange } from './diff'
export { validatePageChange } from './validate'
