/**
 * Magic Engine 2.0 · Growth Module 契约 —— 纯类型（Issue #877 / WP01）
 *
 * 任何 Domain Module（GEO Module 是第一个）推理时共用的五段契约：
 * `observe → diagnose → prescribe → propose → verify`。
 *
 * 🔴 **这个文件只描述形状，不做任何事。** 没有执行、没有授权、没有落库、
 *    没有 provider 调用、没有域逻辑。
 *    契约冻结见 `docs/specs/2026-08-10-me2-wp00-contract-freeze-v1.0.md` §4 / §5。
 *
 * 🔴 五个概念一律带 `Growth` 前缀 —— `src/types/diagnostic.ts` 里已经有语义
 *    不同的 `Prescription` 和诊断 finding，同名不同事是这个仓库反复出事的形状。
 */

import type { DiagnosticDimension, DiagnosticSeverity } from '@/types/diagnostic'

// ── 共用原语 ──────────────────────────────────────────────────────────────────

/** 「不知道」的理由码（WP00 §4 / §6 / §14.2 #14 · GEO 契约 §3.4 第 3 条）。 */
export type GrowthUnknownReason =
  /** 来源系统当时根本没记这一项。 */
  | 'not_recorded_by_source'
  /** 这一项对这条证据不适用（例如非解析产物就没有 parser 版本）。 */
  | 'not_applicable'
  /** 来源里有值但指向不唯一，认不准是哪一个。 */
  | 'source_ambiguous'

/**
 * 显式的「知道 / 不知道」。
 *
 * 🔴 刻意不用 `T | null`：`null` 不逼消费方分支，判别式联合逼。省略会让下游把
 *    「不知道」读成「一样」，补 0 会读成「一次都没有」。字段缺失一律判非法输入。
 */
export type GrowthMaybeUnknown<T> =
  | { readonly known: true; readonly value: T }
  | { readonly known: false; readonly reason: GrowthUnknownReason }

/** 动作输入允许的值。不含 `undefined` —— JSON 里没有这个东西。 */
export type GrowthJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly GrowthJsonValue[]
  | { readonly [key: string]: GrowthJsonValue }

// ── observe：Evidence ─────────────────────────────────────────────────────────

/**
 * 一条可追溯的观测事实（WP00 §5.1）。
 *
 * 🔴 不可变 ⇒ **本模块不导出任何修改器**（无 update / merge / upsert），架构测试盯着导出面。
 */
export interface GrowthEvidence {
  /**
   * 哪来的。`kind` 是来源系统的名字，`sourceId` 是它自己的行标识。
   *
   * 🔴 刻意**不**在 WP01 冻结一张来源枚举表：来源目录属于测量层（WP02 / WP03），
   *    在这里定死等于替它们拍板。
   */
  readonly source: {
    readonly kind: string
    readonly sourceId: string
  }
  /** 什么时候观测到的。 */
  readonly observedAt: string
  /** 原始形态在哪（原始响应或快照的定位）。定位不出来就显式记未知。 */
  readonly rawLocator: GrowthMaybeUnknown<string>
  /** 解释身份 —— 用哪一版逻辑把原始回答读成结构的（GEO 契约 §3.3）。 */
  readonly interpretation: GrowthMaybeUnknown<{ readonly parserVersion: string }>
  /** 解析置信度 0–1。**是质量信号与阈值，不是身份维度**（GEO 契约 §3.3）。 */
  readonly confidence: GrowthMaybeUnknown<number>
}

// ── diagnose：Finding ─────────────────────────────────────────────────────────

/**
 * 一条有证据支撑的问题或机会陈述（WP00 §5.2：没有 Evidence 的 Finding 不许存在）。
 *
 * 🔴 用**结构包含**而不是 id 引用 —— WP03 之前 Evidence 没有存储身份，用 id 就得凭空发明一个。
 */
export interface GrowthFinding {
  /** 属于哪个支柱。复用仓库既有的六维，不另发明一套。 */
  readonly pillar: DiagnosticDimension
  /** 有多严重 / 多值得。同样复用既有分级。 */
  readonly severity: DiagnosticSeverity
  /** 是什么。 */
  readonly statement: string
  /** 凭哪几条证据。**至少一条。** */
  readonly evidence: readonly GrowthEvidence[]
}

// ── prescribe：Prescription ───────────────────────────────────────────────────

/**
 * 一段时间内「做什么、不做什么、凭什么这么排」的说明（WP00 §5.3）。
 *
 * 🔴 **不带诸葛亮那套破坏性 supersede 语义**：本模块不定义任何把前一份处方置为
 *    superseded 的状态或函数。ME2 的处方要跟 Kernel 的 append-only 授权账本对齐，
 *    不能靠把旧记录改掉来表达「换了一版」。
 *
 * 🔴 **不带客户归属。** 租户身份留在编排 / Kernel 提交上下文里
 *    （`SubmitActionInput.clientId` → `action_runs.client_id`），不进契约。
 */
export interface GrowthPrescription {
  /**
   * 服务哪个增长目标（`goals.id`）。允许未知是刻意的 —— 目标可能还没建，
   * 强行要求一个 id 会逼调用方编一个。
   */
  readonly goalId: GrowthMaybeUnknown<string>
  /** 覆盖哪些 Finding。**至少一条** —— 处方要有依据，「什么都不做」用 `notDoing` 表达。 */
  readonly covers: readonly GrowthFinding[]
  /**
   * 刻意**不**做什么，以及为什么不做（WP00 §5.3）。
   *
   * 🔴 必填，可以是空数组但不许省略 —— 做成可选字段就等于永远没人填。
   */
  readonly notDoing: readonly {
    readonly statement: string
    readonly reason: string
  }[]
  /** 凭什么这么排 —— 资源怎么分、为什么是现在。 */
  readonly orderingRationale: string
}

// ── propose：ActionCandidate + VerificationDefinition ─────────────────────────

/**
 * 候选动作的身份。
 *
 * 🔴 **它不是 `ActionKey`，也永远不许被当成 `ActionKey` 用。**
 *    `ActionKey` 是 Kernel 里封闭的字符串字面量联合；这里是一个结构体，
 *    两者在类型层结构上互不可赋。候选身份 → ActionKey 的映射归 K-WP02
 *    （WP00 §8.3），映射不上必须拒绝并留痕，本模块不提供任何映射函数。
 *
 * 🔴 **命名规范（大小写 / 分隔符 / 长度）归 K-WP02，不在这里定。**
 *    WP01 只保证它不是一段自由文本。
 */
export interface GrowthActionCandidateIdentity {
  /** 域前缀，例如 `geo`。 */
  readonly domain: string
  /** 意图，例如 `optimize_page_answerability`。 */
  readonly intent: string
}

/**
 * 在动作发生**之前**写下的验证判据。
 *
 * 🔴 **它是内联的不可变值对象，没有自己的 ID。** `verification_id` 在仓库里不是
 *    一等标识（WP00 §10 / §15 U4 未决），WP01 不发明它 —— 由 Build Control Room
 *    在 2026-08-10 的 WP01 授权评审中明确裁定。
 */
export interface GrowthVerificationDefinition {
  /**
   * 看哪个指标。
   *
   * 🔴 刻意只要求「非空引用」，**不绑定 `FlywheelMetricKey`**：测量层指标与既有
   *    `geo.*` 归因指标**不许假定同名即同义**（GEO 契约 §5 末段），映射归
   *    WP02 / WP05 / WP10。在这里绑死等于替它们宣布语义等价。
   */
  readonly metricRef: string
  /** 在哪个窗口看。正整数天。 */
  readonly windowDays: number
  /** 拿什么做对照。 */
  readonly baseline: string
  /**
   * 什么算成功 / 失败 / 无法判定。**三档缺一不可**（WP00 §5.5）。
   *
   * 🔴 跨 WP 约定（此处只声明，不实现）：测量层判出的 `not_comparable` 只能落到
   *    `indeterminate`，**永远不许落成 `failure`**（据 GEO 契约 §6.2 推导）。
   */
  readonly criteria: {
    readonly success: string
    readonly failure: string
    readonly indeterminate: string
  }
}

/**
 * Domain Module 能产出的最强东西：**一个请求，不是一次执行。**
 *
 * 三条红线（WP00 §5.4）：
 *   1. 不带授权 —— 授权只能由 Kernel 依客户政策签发；
 *   2. 不进 `execution_items`；
 *   3. 动作身份要经 K-WP02 治理才能变成 ActionKey。
 *
 * 🔴 因此这个结构里**没有** risk / sideEffect / policy / approved / actionKey
 *    任何一项 —— CAN 归平台注册表、SHOULD 归客户政策、AUTHORIZED 归 Kernel
 *    每次判定，Domain Module 三个都不答（WP00 §8.2）。校验器用**白名单**拒绝
 *    任何多出来的顶层字段，不是靠一份注定漏的黑名单。
 */
export interface GrowthActionCandidate {
  /** 想做的动作身份（候选，尚未映射到 ActionKey）。 */
  readonly identity: GrowthActionCandidateIdentity
  /**
   * 动作输入。
   *
   * 🔴 **WP01 只强制「形状是 JSON 安全的」** —— 校验器查的是这份数据能不能原样
   *    存活过一次序列化，**不判断字段语义是不是 provider 中立**。
   *    它认不出 provider 专有的字段名，也没有这种黑名单。
   *
   * 🔴 「不许出现 provider 专有字段」这条语义约束由**后续的域映射 / K-WP 层**强制
   *    （Page 契约 §2 第 1 条）。本层不声称做到了这件事。
   */
  readonly input: { readonly [key: string]: GrowthJsonValue }
  /** 凭哪些 Finding（每条自带至少一条 Evidence）。**至少一条。** */
  readonly basis: readonly GrowthFinding[]
  /** 预期影响。 */
  readonly expectedImpact: 'low' | 'medium' | 'high'
  /** 代价。🔴 会花钱却说不出上界 = 非法，校验器 fail closed（WP00 §8.4 · GEO 契约 §7.1 第 3 条）。 */
  readonly cost: {
    readonly spendsMoney: boolean
    readonly ceilingUsd: GrowthMaybeUnknown<number>
  }
  /** 配套的验证定义。**必填** —— 结构上保证判据先于执行确定。 */
  readonly verification: GrowthVerificationDefinition
}
