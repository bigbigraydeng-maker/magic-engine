/**
 * ActionCandidate → ActionKey bridge —— 类型。
 *
 * 🔴 **依赖方向是单向的：bridge → kernel，只此一条。**
 *    · Kernel 不 import 本模块，也不 import 任何 Domain Module；
 *    · Domain Module（`src/lib/growth`）不 import Kernel，也不 import 本模块。
 *
 *    这样将来加第二个、第三个 Domain Module 时，Kernel 和本模块的 import
 *    **都不用动** —— 候选身份按**结构**匹配，不按名义类型（见 `CandidateIdentity`）。
 *    反过来（把映射放进 Kernel）会逼着 Kernel 每接一个域就多 import 一个域模块。
 */

import type { ActionKey, SideEffectClass } from '@/lib/kernel/types'

/**
 * 候选身份 —— 本模块**自己声明**的最小形状。
 *
 * 🔴 刻意**不** import `GrowthActionCandidateIdentity`。它结构上就是
 *    `{domain, intent}`，TypeScript 的结构化类型让它直接满足这个接口，
 *    两边谁都不用 import 谁。将来别的域模块带自己的候选类型过来，
 *    只要形状一样就照样能过，本文件一个字都不用改。
 */
export interface CandidateIdentity {
  readonly domain: string
  readonly intent: string
}

/**
 * 映射不上的原因。**只有这三种**，各自对应一件不同的事，不许合并：
 *
 * · `malformed_identity` —— 调用方给的东西根本不成立（该修调用方）
 * · `unmapped_identity`  —— 身份是好的，只是还没有人给它配一个动作（该走治理加配对）
 * · `registry_drift`     —— 配对指向的动作在注册表里没有（是配置漂移，不是调用方的错）
 *
 * 合并成一句「映射失败」的话，这三件事的处置就没法分开了。
 */
export type CandidateMappingRejectionCode =
  | 'malformed_identity'
  | 'unmapped_identity'
  | 'registry_drift'

/**
 * 映射结果 —— **诚实判别联合**。
 *
 * 🔴 为什么不是 `{ ok: boolean; actionKey?: ActionKey; reason?: string }`：
 *    那个形状允许 `{ok: true}` 不带 key，也允许失败结果带着 key。
 *    两种都不该表达得出来。这里 `mapped` 分支必须完整带上 key 与版本，
 *    `rejected` 分支**结构上**带不了成功字段。
 */
export type CandidateMappingResult =
  | {
      readonly outcome: 'mapped'
      readonly actionKey: ActionKey
      /**
       * 🔴 从**注册表**读，不从映射表读。
       *    映射表里存版本号 = 契约升版之后两边悄悄对不上。
       */
      readonly actionVersion: number
      /** Omitted means the legacy generic page-optimization boundary. */
      readonly submissionBoundary?:
        | 'generic_page_optimization'
        | 'wordpress_reference_loop'
        | 'cts_github_reference_loop'
    }
  | {
      readonly outcome: 'rejected'
      readonly code: CandidateMappingRejectionCode
      /** 给人看的原因。将来的调用方会原样落进拒绝记录。 */
      readonly reason: string
    }

/**
 * 受治理的动作词汇表条目。
 *
 * 🔴 每一个字段都是**派生**的：`domain` / `intent` 来自映射表，
 *    其余来自 `ACTION_REGISTRY`。全仓不存在第二份手写的动作清单 ——
 *    手写第二份的下场就是「36 种自由文本 + 一张对不上的表」。
 */
export interface GovernedActionVocabularyEntry {
  readonly domain: string
  readonly intent: string
  readonly actionKey: ActionKey
  readonly title: string
  readonly sideEffect: SideEffectClass
}
