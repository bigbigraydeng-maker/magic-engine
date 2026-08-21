/**
 * 受治理的「候选身份 → ActionKey」配对表。
 *
 * 🔴 **只登记已经有受治理提交边界的动作。**
 *    每一行都必须指向已存在的 ActionKey，并明确由哪个提交边界组装输入；
 *    不能因为“以后可能会用”就先占一个模糊映射。
 *
 * 🔴 **逐项精确比对，不拼字符串。**
 *    早先设计用 `${domain}:${intent}` 当键，那样
 *    `{domain:'geo:x', intent:'y'}` 和 `{domain:'geo', intent:'x:y'}`
 *    会撞成同一个键 —— 一个分隔符就能让两个不同的候选映射到同一个动作。
 *    数组 + 两个字段各自 `===`：既没有分隔符碰撞，也没有对象键的原型链问题
 *    （`registry.ts` 用 `hasOwnProperty` 防的是同一类事）。
 */

import type { ActionKey } from '@/lib/kernel/types'

export interface CandidateMappingEntry {
  readonly domain: string
  readonly intent: string
  /** 🔴 只能是注册表里真实存在的 key —— 类型层封闭，编不出新的。 */
  readonly actionKey: ActionKey
  /** Which audited submitter is allowed to assemble this action's input. */
  readonly submissionBoundary?:
    | 'generic_page_optimization'
    | 'wordpress_reference_loop'
    | 'cts_github_reference_loop'
}

export const MAPPING_TABLE: readonly CandidateMappingEntry[] = [
  // GEO Module (WP05) → Page Optimization Apply (v1).
  // spec: docs/specs/2026-08-19-me2-page-optimization-apply-action-v1.0.md §12
  {
    domain: 'geo',
    intent: 'optimize_page_answerability',
    actionKey: 'page.apply_optimization_request',
  },
  {
    domain: 'seo',
    intent: 'clarify_page_query_url_ownership',
    actionKey: 'page.apply_cts_github_metadata_request',
    submissionBoundary: 'cts_github_reference_loop',
  },
  {
    domain: 'seo',
    intent: 'apply_wordpress_page_metadata',
    actionKey: 'page.apply_wordpress_optimization_request',
    submissionBoundary: 'wordpress_reference_loop',
  },
]
