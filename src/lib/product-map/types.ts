/**
 * ME2 Product Map —— 组件登记册的类型契约（WP: ME2 Product Map v1，PR 1/3）。
 *
 * 这一层回答的是 PO 那个问题：「Module / Capability / Adapter / Agent 都做到哪了」。
 * 登记册是 **Git 里的静态真值**，只存组件的身份、语义、依赖和证据**声明**；
 * GitHub 的动态状态（PR merged 与否、checks、review threads）**不落在这里**——
 * 它们通过 `ExternalFacts`（见 external-facts.ts）在推导时注入，PR 2 会把注入源
 * 换成 GitHub 同步快照。把动态事实手抄进静态登记册 = 两套真值，此仓库反复出事的形状。
 *
 * 🔴 成熟度的铁律（每条都有对应校验或推导硬墙 + 变异探针）：
 *   - Issue 关闭 ≠ 生产完成；PR merge 最多自动证明 M2；
 *   - 没有 wiring 证据不成 M3；没有可审计生产执行证据不成 M4；
 *   - 没有重复 Outcome/Learning 证据不成 M5；聊天报告不能作为唯一证据。
 */

// ---------------------------------------------------------------------------
// 🔴 componentType —— 这不是 WP00 architectural role（Build Control Room
//    2026-08-15 05:43 复审 Blocker 1）。它是本登记册沿用的历史 / 目录形状
//    分类（"这条东西长得像什么"），legacy 件也用它描述考古形状。
//    ME2 冻结七层角色见下方 ARCHITECTURAL_ROLE，两个字段独立存在、独立校验，
//    不得互相推断（id 前缀 === componentType 的假设已删除，见 validate.ts）。
// ---------------------------------------------------------------------------

export const COMPONENT_TYPE = [
  'module',
  'capability',
  'adapter',
  'agent',
  'playbook',
  'platform',
  'registry',
] as const
export type ComponentType = (typeof COMPONENT_TYPE)[number]

// ---------------------------------------------------------------------------
// WP00 §3 冻结的七层架构角色："ME2 只有下面七个角色。没有第八个。"
// （docs/specs/2026-08-10-me2-wp00-contract-freeze-v1.0.md §3）
//
// 只适用于 origin === 'me2_native' 的组件：
// - me2_native 必须填 architecturalRole，且只能是这七个值之一；
// - legacy 必须不填（校验器双向硬校验，见 validate.ts）——
//   legacy 件的生产人生记在 operationalStatus / legacyOperationalNote，
//   不得借架构角色伪装成已纳入 ME2 治理契约。
//
// Adapter / Playbook / Platform / Registry 不是第八个角色：
// - Adapter 是所属七层组件的 supporting artifact，用 adapterOf 挂回父组件；
// - Playbook 是跨组件编排视图，不落这个字段；
// - Platform 是产品口语，真实对象落回 kernel / shared_capability / measurement；
// - Registry（含本工具自己）是基础设施，不是 ME2 组件角色。
// ---------------------------------------------------------------------------

export const ARCHITECTURAL_ROLE = [
  'agent',
  'domain_module',
  'measurement',
  'shared_capability',
  'kernel',
  'attribution_flywheel',
  'operating_brief',
] as const
export type ArchitecturalRole = (typeof ARCHITECTURAL_ROLE)[number]

export const BUSINESS_LANE = ['shared', 'geo', 'seo', 'social', 'ads'] as const
export type BusinessLane = (typeof BUSINESS_LANE)[number]

export const DAPE_STAGE = [
  'discovery',
  'analysis',
  'prescription',
  'authorization',
  'execution',
  'verification',
  'outcome',
  'learning',
] as const
export type DapeStage = (typeof DAPE_STAGE)[number]

/** 顺序即梯子：索引越大越成熟。推导依赖这个顺序，不许重排。 */
export const MATURITY = [
  'M0_REGISTERED',
  'M1_CONTRACT_FROZEN',
  'M2_IMPLEMENTED',
  'M3_INTEGRATED',
  'M4_PRODUCTION_VALIDATED',
  'M5_OPERATING_AND_LEARNING',
] as const
export type Maturity = (typeof MATURITY)[number]

export const DEPENDENCY_TYPE = [
  'requires',
  'blocks',
  'consumes',
  'implements',
  'adapts',
  'verifies',
] as const
export type DependencyType = (typeof DEPENDENCY_TYPE)[number]

// ---------------------------------------------------------------------------
// 证据 —— 四类分开存，每级梯子只认自己那类（累积：到 M_n 要求 M1..M_n 全齐）
// ---------------------------------------------------------------------------

/**
 * 每条证据必须声明自己是怎么被核验的。
 *
 * - `manual_claim`：登记时人工写入，**未经机器核验** —— PR 1 阶段所有证据都是这个。
 *   控制台（PR 3）必须把它明示出来，M4/M5 若只靠 manual_claim 会出结构化 warning。
 * - `repo_verified`：registry.test 在测试时对着磁盘/源码核验过（如 importer 真的 import 了）。
 * - `sync_verified`：GitHub 同步快照核验过（PR 2 起才存在）。
 */
export const EVIDENCE_VERIFICATION = ['manual_claim', 'repo_verified', 'sync_verified'] as const
export type EvidenceVerification = (typeof EVIDENCE_VERIFICATION)[number]

/** 各类证据的合法 kind —— 校验器运行时逐条比对,挡 JSON 注入绕过编译期。 */
export const CONTRACT_EVIDENCE_KIND = ['frozen_contract'] as const
export const INTEGRATION_EVIDENCE_KIND = ['importer', 'caller_route', 'caller_cron', 'wired_registry'] as const
export const PRODUCTION_EVIDENCE_KIND = ['production_run', 'production_data'] as const
export const LEARNING_EVIDENCE_KIND = ['recurring_outcome', 'memory_writeback'] as const
export const PR_ROLE = ['implements', 'extends'] as const

interface EvidenceBase {
  /** 可审计的指针：文件路径 / batch id / cron run id / 文档路径。禁止散文。 */
  readonly ref: string
  readonly note?: string
  /** YYYY-MM-DD。M5 的重复性判定靠它。 */
  readonly observedAt?: string
  readonly verification: EvidenceVerification
}

/**
 * M1 只认 `frozen_contract`（真被冻结的契约：spec 文档、代码里的版本常量）。
 * 提案性质的 spec 不算 —— 半个 docs/specs/ 都能抬 M1 的口子不开。
 */
export interface ContractEvidence extends EvidenceBase {
  readonly kind: 'frozen_contract'
}

/**
 * M3 = 真接上了线。`importer` / `caller_route` / `caller_cron` 的 ref 必须是
 * 仓库内真实文件路径，registry.test 会核验该文件确实引用了本组件的代码。
 */
export interface IntegrationEvidence extends EvidenceBase {
  readonly kind: 'importer' | 'caller_route' | 'caller_cron' | 'wired_registry'
}

/**
 * M4 = 生产真跑过。只有两种：
 * - `production_run`：一次可审计的生产执行（ref = batch id / run id）。
 * - `production_data`：生产库里躺着它产出的数据（ref = 表名+行数+核对日期）。
 *
 * 🔴 没有 `applied_migration` 这一档：migration 已 apply 证明的是 provisioning
 *    （schema 存在），不是「生产验证」；且账本版本号不可信，判 apply 只认对象存在性，
 *    纯代码层核验不了 —— 这类事实记进 blocker（kind: 'provisioning'）而不是证据。
 */
export interface ProductionEvidence extends EvidenceBase {
  readonly kind: 'production_run' | 'production_data'
}

/** M5 = 持续出结果在学习：≥2 条 `recurring_outcome` 且 observedAt 不同日。 */
export interface LearningEvidence extends EvidenceBase {
  readonly kind: 'recurring_outcome' | 'memory_writeback'
}

// ---------------------------------------------------------------------------
// 依赖 / blocker / PO 决策
// ---------------------------------------------------------------------------

/**
 * 依赖挂在**依赖方**身上：`{ type: 'requires', target: 'X' }` 读作「本组件 requires X」。
 * `blocks` 读作「本组件卡住了 target」。
 *
 * 允许边矩阵（validate.ts 按此执行，超纲即 error）：
 * - requires / blocks / verifies：任意 → 任意
 * - consumes：任意 → capability | adapter | registry | platform
 * - implements：任意 → module | capability | platform；**agent → module 绝对禁止**
 *   （#870 冻结：Agent 不随 Module 机械增殖）
 * - adapts：**只有 adapter 可以有**，且 → capability | platform
 */
export interface ComponentDependency {
  readonly type: DependencyType
  /** 目标组件 id。必须存在于登记册，否则校验失败（悬空依赖）。 */
  readonly target: string
  readonly note?: string
}

/**
 * blocker 的六类对应 PO 最关心的问题「卡在哪一类」。
 * 🔴 没有 'po_decision' 这一类 —— 「等 PO 拍板」只住在 poDecisionRequired 一个家，
 *    两处记同一件事必然分家。
 */
export const BLOCKER_KIND = [
  'code',
  'data',
  'authorization',
  'security',
  'provisioning',
  'external_platform',
] as const
export type BlockerKind = (typeof BLOCKER_KIND)[number]

export interface ComponentBlocker {
  /** 组件内唯一、稳定的短 id（如 'kernel-tables-not-applied'），nextMilestone 用它引用。 */
  readonly id: string
  readonly kind: BlockerKind
  readonly summary: string
  /** 指针：issue 号 / 文档路径 / 表名。 */
  readonly ref?: string
}

export const PO_DECISION_KIND = [
  'merge',
  'migration_apply',
  'credential',
  'deploy',
  'enable',
  'scope',
] as const
export type PoDecisionKind = (typeof PO_DECISION_KIND)[number]

export interface PoDecision {
  readonly kind: PoDecisionKind
  /** 给 PO 看的一句话，说清「回什么就行」。 */
  readonly decision: string
}

export interface NextMilestone {
  readonly target: Maturity
  /** 引用本组件 currentBlockers 里的 blocker id（校验器核对，防散文断头）。 */
  readonly unlockedBy: readonly string[]
  readonly note?: string
}

// ---------------------------------------------------------------------------
// GitHub 关联 —— 只存身份，不存状态
// ---------------------------------------------------------------------------

/** 唯一获准仓库。Issue/PR 号一律指向它；跨仓库输入在结构上不存在（fail closed）。 */
export const APPROVED_REPO = 'bigbigraydeng-maker/magic-engine' as const

export interface LinkedPullRequest {
  readonly number: number
  /** implements = 交付本组件的 PR；extends = 后续扩展它的 PR。 */
  readonly role: 'implements' | 'extends'
  // 🔴 故意没有 merged / state 字段：那是动态事实，由 ExternalFacts 注入。
}

// ---------------------------------------------------------------------------
// 组件本体
// ---------------------------------------------------------------------------

/**
 * legacy 轴：区分「ME2 原生」和「legacy 在跑但还没进 ME2 DAPE」。
 * legacy 件在本地图上的成熟度 = 它作为 ME2 组件的集成度（封顶 M3，
 * production/learning 证据必须为空 —— 校验硬规则），
 * 「它天天在生产干活」这个事实由 operationalStatus 表达，不靠夸大成熟度。
 */
export const COMPONENT_ORIGIN = ['me2_native', 'legacy'] as const
export type ComponentOrigin = (typeof COMPONENT_ORIGIN)[number]

export const OPERATIONAL_STATUS = ['operating_legacy', 'operating_me2', 'not_operating'] as const
export type OperationalStatus = (typeof OPERATIONAL_STATUS)[number]

/**
 * 三个变体共享的字段。判别键 origin 与 architecturalRole / adapterOf /
 * legacyOperationalNote 不在这里 —— 它们落在各变体上（B1 判别式 union）。
 */
interface ComponentCore {
  /**
   * 🔴 id 是稳定契约：全小写 kebab，`<type>.<name>` 形态（如 'platform.execution-kernel'）。
   *    **只可废弃，不可改名** —— PR 2 的持久化快照按 id 挂，改名 = 孤儿一片。
   */
  readonly id: string
  readonly name: string
  readonly componentType: ComponentType
  readonly businessLane: BusinessLane
  /**
   * 组件覆盖的 DAPE 阶段。填写指引：
   * - module 解释证据、出发现和处方 → discovery/analysis/prescription(/learning)，
   *   **不得含 execution**（module 不产生外部副作用，校验硬规则）；
   * - adapter 只做翻译 → **不得含 authorization / prescription**（校验硬规则）；
   * - capability 干真活 → 多为 execution(/verification)。
   */
  readonly dapeStages: readonly DapeStage[]
  /** 一句大白话：这个组件存在是为了什么业务结果。 */
  readonly businessOutcome: string
  readonly description: string
  readonly operationalStatus: OperationalStatus
  /**
   * 声明成熟度。允许保守（低于证据上限）；高于上限会得到 warning；
   * 声明 M4/M5 而对应证据数组为空 = hard error（WP 明文）。
   */
  readonly declaredMaturity: Maturity
  readonly dependencies: readonly ComponentDependency[]
  /** Issue 号，一律挂在 APPROVED_REPO 上。 */
  readonly linkedIssues: readonly number[]
  readonly linkedPullRequests: readonly LinkedPullRequest[]
  /**
   * 本组件认领的代码路径（相对仓库根，如 'src/lib/kernel/'；目录必须带尾斜杠）。
   * registry.test 会核验每条路径真实存在且目录非空；两个组件认领同一路径 = error。
   */
  readonly ownedPaths: readonly string[]
  readonly contractEvidence: readonly ContractEvidence[]
  readonly integrationEvidence: readonly IntegrationEvidence[]
  readonly productionEvidence: readonly ProductionEvidence[]
  readonly learningEvidence: readonly LearningEvidence[]
  readonly currentBlockers: readonly ComponentBlocker[]
  readonly poDecisionRequired: readonly PoDecision[]
  readonly nextMilestone?: NextMilestone
  /** 谁对它负责（岗位不是人名）：如 'claude-code' / 'build-control-room' / 'fde'。 */
  readonly ownerRole: string
}

/**
 * ME2 原生、占据七层角色之一的顶层组件（Portfolio 按 architecturalRole 展示）。
 * 🔴 不得设 adapterOf：占了角色就不是别人的零件。
 */
export interface Me2RoleComponent extends ComponentCore {
  readonly origin: 'me2_native'
  /** WP00 §3 冻结七层之一，必填。 */
  readonly architecturalRole: ArchitecturalRole
  readonly adapterOf?: never
  readonly legacyOperationalNote?: never
}

/**
 * ME2 原生、但是某个七层父组件的 supporting artifact（典型是 provider adapter）。
 * 🔴 B2：supporting artifact **不占顶层角色** —— architecturalRole 结构上不可设
 *    （类型 never），语义从 adapterOf 指向的父组件继承。"零件冒充第八层"在构造点
 *    就编译不过，不靠运行时才发现。
 */
export interface Me2SupportingComponent extends ComponentCore {
  readonly origin: 'me2_native'
  /** 指向登记册里真实存在的七层父组件 id，必填。 */
  readonly adapterOf: string
  readonly architecturalRole?: never
  readonly legacyOperationalNote?: never
}

/**
 * Legacy：生产可能仍在运行，但尚未纳入 ME2 七层 / Kernel 治理。
 * 🔴 architecturalRole / adapterOf 结构上都不可设（never）—— legacy 不许借架构角色
 *    伪装成"已治理"，也不是任何 ME2 组件的零件。生产人生记在 operationalStatus +
 *    legacyOperationalNote，不靠夸大成熟度。
 */
export interface LegacyComponent extends ComponentCore {
  readonly origin: 'legacy'
  readonly architecturalRole?: never
  readonly adapterOf?: never
  /** 可选补一句「legacy 生产在跑」的事实来源（静态声明，非机器核验）。 */
  readonly legacyOperationalNote?: string
}

/**
 * 🔴 B1：判别式 union。三个世界不再混成一张带一堆可选字段的假表 —— origin 是判别键，
 *    architecturalRole / adapterOf 的可设性由变体在类型层锁死。
 */
export type ProductMapComponent = Me2RoleComponent | Me2SupportingComponent | LegacyComponent

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

export function maturityRank(m: Maturity): number {
  return MATURITY.indexOf(m)
}

export function minMaturity(a: Maturity, b: Maturity): Maturity {
  return maturityRank(a) <= maturityRank(b) ? a : b
}

export const GOVERNANCE_STATUS = ['me2_governed', 'not_mapped_to_me2'] as const
export type GovernanceStatus = (typeof GOVERNANCE_STATUS)[number]

/**
 * 治理状态是从 origin 派生的只读投影,不是第二份手填真值——只有一个字段
 * （origin）能决定它,这里只是给消费方一个语义清楚的名字，不建第二套真值。
 * 'not_mapped_to_me2' 明确表达 Build Control Room 2026-08-15 复审的要求：
 * legacy 组件即使天天在生产跑,也不构成"已纳入 ME2 七层 / Kernel 治理"。
 */
export function governanceStatusOf(component: ProductMapComponent): GovernanceStatus {
  return component.origin === 'me2_native' ? 'me2_governed' : 'not_mapped_to_me2'
}
