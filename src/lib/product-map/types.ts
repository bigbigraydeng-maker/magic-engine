/**
 * ME2 Product Map v1 —— registry 契约（Issue #974 / Parent #859）。
 *
 * 🔴 顶层分类**不是本文件发明的**。它直接引用
 *    `docs/specs/2026-08-10-me2-wp00-contract-freeze-v1.0.md` §3 冻结的七层角色，
 *    那份文档写明「ME2 只有下面七个角色，**没有第八个**」。
 *    本文件不得新增、重命名或合并其中任何一个。
 *
 * 🔴 这个文件不做任何事 —— 没有执行、没有落库、没有 GitHub 调用。
 *    校验逻辑在 `validators.ts`，成熟度推导在 `maturity.ts`，
 *    动态事实的推导接口在 `assessment.ts`。
 */

/**
 * WP00 §3 冻结的七层角色。**没有第八个。**
 *
 * 曾经出现在 v1 草案里的 `adapter` / `playbook` / `platform` / `registry` **都不是角色**：
 * - `adapter` → 归到所属组件的 `supportingArtifacts`（`kind: 'provider_adapter'`）；
 * - `playbook` → 编排视图，不是组件；
 * - `platform` → 产品口语，实例（执行内核）属于 `kernel`；
 * - `registry` → 本工具自身的基础设施，不是被登记的 ME2 组件。
 */
export type ArchitecturalRole =
  /** WP00 §3.1 AI 推理：出主意，不能执行、不能自我授权。 */
  | 'agent'
  /** WP00 §3.2 域模块：证据→发现→处方→ActionCandidate。产出候选，不是命令。 */
  | 'domain_module'
  /** WP00 §3.3 测量：采集身份与解释身份；对不上必须 `not_comparable`。 */
  | 'measurement'
  /** WP00 §3.4 共享能力：唯一能对外写的地方，且 apply/rollback 必须经 Kernel。 */
  | 'shared_capability'
  /** WP00 §3.5 执行内核：授权 / 幂等 / 成本 / 审计 / lineage。不做业务判断。 */
  | 'kernel'
  /** WP00 §3.6 归因飞轮：分析投影，**不是执行权威**。 */
  | 'attribution_flywheel'
  /** WP00 §3.7 注意力投影：现在该看什么。不是真相，也不是授权状态。 */
  | 'operating_brief'

/** 业务线是筛选视图，不是数据分叉 —— 同一个组件不许为每条业务线复制一份。 */
export type BusinessLane = 'shared' | 'geo' | 'seo' | 'social' | 'ads'

/** DAPE 全流程八段。 */
export type DapeStage =
  | 'discovery'
  | 'analysis'
  | 'prescription'
  | 'authorization'
  | 'execution'
  | 'verification'
  | 'outcome'
  | 'learning'

/** M0–M5 成熟度。数值顺序即证据强度顺序，禁止跳级判定。 */
export type Maturity = 'M0' | 'M1' | 'M2' | 'M3' | 'M4' | 'M5'

/** 复用仓库既有的 A/B/C 风险分级（`docs/ENGINEERING_QUALITY_GATES.md`），不另发明一套。 */
export type RiskLevel = 'A' | 'B' | 'C'

/**
 * 三态。
 *
 * 🔴 **`unknown` 与 `no` 必须分开**，这是 WP00 §2 附加规则 1 的字面要求：
 *    「『查不到』不等于『不存在』」。任何把两者压成一个 boolean 的实现，
 *    都会把「还没查」渲染成「确定没有」。
 */
export type EvidenceStatus = 'yes' | 'no' | 'unknown'

/**
 * 一条可追溯证据。`link` 必须指向具体东西 —— issue/PR 编号、文件路径、
 * 生产表名——不接受「大概是这样」式的自由文本。
 */
export interface EvidenceRecord {
  readonly kind:
    | 'issue'
    | 'pull_request'
    | 'commit'
    | 'source_path'
    | 'production_table'
    | 'doc_reference'
  readonly description: string
  readonly link: string
}

/**
 * 「四问」里的一问。
 *
 * 🔴 三个字段缺一不可：光有 `status` 没有 `evidenceSource` / `checkedAt`，
 *    读的人无法判断这个答案是**什么时候、凭什么**得出的 —— 那就退化成又一份
 *    会过期的手填文档，正是本工具要取代的东西。
 */
export interface OperationalCheck {
  readonly status: EvidenceStatus
  /** 这个答案是从哪来的：`github:main-sha` / `production:information_schema` / `code-scan:callers` … */
  readonly evidenceSource: string
  /** 实际核对时间。`status === 'unknown'` 且从未核对过时为 `null`。 */
  readonly checkedAt: string | null
  readonly note?: string
}

/**
 * 「四问」运营快照 —— WP00 §2 证据优先级的可执行版本。
 *
 * 🔴 **它不替代 M0–M5**：M0/M1 表达的是 proposed / contracted（静态事实），
 *    M5 要求重复且可归因的 outcome。四问回答的是另一个问题 ——
 *    「这东西**现在**到底在不在跑」。两套并存，互不换算。
 */
export interface OperationalSnapshot {
  /** ① 代码进 main 了吗？ */
  readonly codeInMain: OperationalCheck
  /** ② 生产前置（表 / 列 / 函数）**真的存在**吗？—— migration 文件存在不算。 */
  readonly productionPrerequisitesExist: OperationalCheck
  /** ③ 有真实调用方吗？（不是只有测试在调） */
  readonly realCallerWired: OperationalCheck
  /** ④ 生产里真的跑过吗？ */
  readonly productionRunObserved: OperationalCheck
}

/**
 * 驱动 M0–M5 上限判定的六道信号。
 *
 * 🔴 全部是三态，**不是 boolean** —— 见 `EvidenceStatus`。
 * 🔴 这些信号**不允许出现在种子数据里**：它们只能由 `assessment.ts` 从
 *    GitHub snapshot / 代码扫描 / 生产只读接口推导。seed 手填 = 又一份会过期的文档。
 */
export interface MaturitySignals {
  /** M1：schema / 边界 / 依赖 / 验收标准已冻结（由 `contractSpecPaths` 是否在 main 中存在推导）。 */
  readonly contractFrozen: EvidenceStatus
  /** M2 的一半：代码已合并到 main。 */
  readonly mergedToMain: EvidenceStatus
  /** M2 的另一半：目标测试通过。 */
  readonly targetedTestsPassing: EvidenceStatus
  /** M3：接入了真实调用链（不是只有测试调用）。 */
  readonly realIntegration: EvidenceStatus
  /** M4：有受控生产运行 + receipt + verification + 可观察证据。 */
  readonly productionRun: EvidenceStatus
  /** M5：有重复运行，且能归因到具体业务 outcome。 */
  readonly repeatedAttributableOutcome: EvidenceStatus
}

/** 阻塞条件。`since` 是首次发现阻塞的时间，用于判断阻塞是不是已经拖太久。 */
export interface ComponentBlocker {
  readonly statement: string
  readonly since: string
}

/**
 * 附属产物 —— 归属于某个七层组件，**本身不是角色**。
 *
 * `provider_adapter` 是其中最常见的一种：它连接外部系统，按 WP00 §3.4 只能活在
 * 共享能力边界内，不能自己成为顶层组件。
 */
export interface SupportingArtifact {
  readonly kind: 'provider_adapter' | 'orchestration_view' | 'tooling'
  readonly name: string
  readonly description: string
  readonly sourcePaths: readonly string[]
  /** `provider_adapter` 必须非空 —— 连接外部系统不可能零权限。 */
  readonly requiredPermissions: readonly string[]
  readonly evidence: readonly EvidenceRecord[]
}

/**
 * Registry 里的一个组件条目 —— **只登记稳定映射**。
 *
 * 🔴 这里**没有** `maturity`，也**没有** `maturitySignals` / 四问快照。
 *    那些全是动态事实，Git 或生产一变就过期；它们由 `assessment.ts` 从快照推导，
 *    查不到时是 `unknown`，不补 `false`。种子只负责回答「有哪些组件、它属于七层里的哪一层、
 *    代码在哪、关联哪个 Issue/PR、父子关系是什么」。
 */
export interface RegistryComponent {
  /** kebab-case 唯一 ID，例如 `me2-execution-kernel`。 */
  readonly componentId: string
  /** WP00 §3 冻结七层之一。 */
  readonly architecturalRole: ArchitecturalRole
  readonly name: string
  readonly description: string
  /** 至少一条 —— 组件必须能被归到至少一条业务线（`shared` 也算一条）。 */
  readonly businessLanes: readonly BusinessLane[]
  /** 可以为空数组，但字段必须显式存在。 */
  readonly dapeStages: readonly DapeStage[]
  /** 至少一个 owner —— 无主组件不许进 registry。 */
  readonly owners: readonly string[]
  readonly version: string
  /** 依赖的其它 `componentId`。 */
  readonly dependencies: readonly string[]
  /** 消费本组件的其它 `componentId`。 */
  readonly consumers: readonly string[]
  /** 至少一条仓库相对路径。 */
  readonly sourcePaths: readonly string[]
  /**
   * 冻结契约文档的路径。可以为空（还没冻结），但字段必须显式存在。
   * `contractFrozen` 信号由「这些路径在 main 中是否存在」推导，**不是手填**。
   */
  readonly contractSpecPaths: readonly string[]
  readonly issueNumbers: readonly number[]
  readonly pullRequestNumbers: readonly number[]
  readonly riskLevel: RiskLevel
  readonly requiredPermissions: readonly string[]
  /** 附属产物（adapter / 编排视图 / 工具）。可以为空数组。 */
  readonly supportingArtifacts: readonly SupportingArtifact[]
  /** 至少一条 —— 没有证据支撑的组件不许存在于 registry。 */
  readonly evidence: readonly EvidenceRecord[]
  /** 可以为空数组，但字段必须显式存在。 */
  readonly blockers: readonly ComponentBlocker[]
}

/**
 * 一次评估的结果 = 静态登记 + 当时查到的动态事实。
 *
 * `maturity` 只是 `maturitySignals` 的推导结果，任何调用方都不许直接设置它。
 */
export interface ComponentAssessment {
  readonly componentId: string
  readonly operational: OperationalSnapshot
  readonly maturitySignals: MaturitySignals
  readonly maturity: MaturityAssessment
}

/**
 * 成熟度判定结果。
 *
 * `limitedBy` 说明「为什么没更高」：
 * - `'confirmed_absent'` —— 下一级证据**确认不存在**，这是真天花板；
 * - `'unknown'` —— 下一级证据**没查到**，`level` 只是**下限**，不是天花板；
 * - `null` —— 已到 M5。
 */
export interface MaturityAssessment {
  readonly level: Maturity
  readonly limitedBy: 'confirmed_absent' | 'unknown' | null
  /** 卡住的那道信号名；`limitedBy === null` 时为 `null`。 */
  readonly blockingSignal: keyof MaturitySignals | null
}
