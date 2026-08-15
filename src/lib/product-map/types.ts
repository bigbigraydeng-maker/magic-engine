/**
 * ME2 Product Map v1 —— registry 契约（Issue #974 / Parent #859）。
 *
 * 只描述形状：Module / Capability / Adapter / Agent / Playbook / Platform / Registry
 * 七种组件类型的机器可读 schema，以及 M0–M5 成熟度证据字段。
 *
 * 🔴 这个文件不做任何事 —— 没有执行、没有落库、没有 GitHub 调用。
 *    校验逻辑在 `validators.ts`，成熟度推导在 `maturity.ts`。
 */

/** 七种组件类型，Issue #974「分类模型」一节冻结的集合，没有第八个。 */
export type ComponentType =
  | 'module'
  | 'capability'
  | 'adapter'
  | 'agent'
  | 'playbook'
  | 'platform'
  | 'registry'

/** 业务线是筛选视图，不是数据分叉 —— 同一个 Capability 不许为每条业务线复制一份。 */
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
 * 驱动 M0–M5 上限判定的六个证据标志（`maturity.ts` 的输入）。
 *
 * 🔴 这些标志只应该由「查到了什么」来填，不是由「希望它是什么」来填 ——
 *    `maturity` 字段本身必须等于由它们推导出的天花板（见 `validators.ts`）。
 */
export interface MaturityEvidenceFlags {
  /** M1：schema / 边界 / 依赖 / 验收标准已冻结。 */
  readonly hasContractFrozen: boolean
  /** M2 的一半：代码已合并到 main。 */
  readonly hasMergedToMain: boolean
  /** M2 的另一半：目标测试通过。 */
  readonly hasTargetedTestsPassing: boolean
  /** M3：接入了真实调用链（不是只有测试调用）。 */
  readonly hasRealIntegrationEvidence: boolean
  /** M4：有受控生产运行 + receipt + verification + 可观察证据。 */
  readonly hasProductionRunEvidence: boolean
  /** M5：有重复运行，且能归因到具体业务 outcome。 */
  readonly hasRepeatedOutcomeEvidence: boolean
}

/** 阻塞条件。`since` 是首次发现阻塞的时间，用于判断阻塞是不是已经拖太久。 */
export interface ComponentBlocker {
  readonly statement: string
  readonly since: string
}

/**
 * Registry 里的一个组件条目。
 *
 * 🔴 `maturity` 不是自由字段 —— 校验器强制它等于 `deriveMaturityCeiling(maturityEvidence)`，
 *    这是 Issue #974「成熟度必须由证据推导，不能由人工随意改成完成」的字面落地。
 */
export interface RegistryComponent {
  /** kebab-case 唯一 ID，例如 `me2-execution-kernel`。 */
  readonly componentId: string
  readonly type: ComponentType
  readonly name: string
  readonly description: string
  /** 至少一条 —— 组件必须能被归到至少一条业务线（`shared` 也算一条）。 */
  readonly businessLanes: readonly BusinessLane[]
  /** 可以为空数组（例如纯基础设施型 Platform），但字段必须显式存在。 */
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
  readonly issueNumbers: readonly number[]
  readonly pullRequestNumbers: readonly number[]
  readonly riskLevel: RiskLevel
  readonly requiredPermissions: readonly string[]
  /** 至少一条 —— 没有证据支撑的组件不许存在于 registry。 */
  readonly evidence: readonly EvidenceRecord[]
  readonly maturityEvidence: MaturityEvidenceFlags
  readonly maturity: Maturity
  /** 可以为空数组，但字段必须显式存在。 */
  readonly blockers: readonly ComponentBlocker[]
}
