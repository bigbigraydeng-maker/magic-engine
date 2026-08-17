/**
 * 登记册校验器 —— 纯函数，结构化返回 errors/warnings，不 throw、不吞错。
 *
 * error = 登记册不许进 main 的硬伤；warning = 允许存在但 PR 3 控制台必须露头
 * （铁律 3：发现不许死在日志里 —— facade 把 warnings 原样带给消费方）。
 */

import { PROVIDER_WRITE_MODULES } from '@/lib/kernel/boundaries'
import type { ExternalFacts } from './external-facts'
import { deriveMaturity } from './maturity'
import { findDanglingDependencies, findOrderingCycles } from './graph'
import type { ComponentType, DependencyType, ProductMapComponent } from './types'
import {
  ARCHITECTURAL_ROLE,
  BLOCKER_KIND,
  BUSINESS_LANE,
  COMPONENT_ORIGIN,
  COMPONENT_TYPE,
  CONTRACT_EVIDENCE_KIND,
  DAPE_STAGE,
  DEPENDENCY_TYPE,
  EVIDENCE_VERIFICATION,
  INTEGRATION_EVIDENCE_KIND,
  LEARNING_EVIDENCE_KIND,
  MATURITY,
  OPERATIONAL_STATUS,
  PO_DECISION_KIND,
  PR_ROLE,
  PRODUCTION_EVIDENCE_KIND,
  maturityRank,
} from './types'

export interface ValidationIssue {
  readonly componentId: string
  readonly code: string
  readonly message: string
}

export interface ValidationResult {
  readonly errors: readonly ValidationIssue[]
  readonly warnings: readonly ValidationIssue[]
}

/** id 契约：全小写 kebab + 单个点分隔类型前缀，如 'platform.execution-kernel'。 */
const ID_PATTERN = /^[a-z0-9-]+\.[a-z0-9-]+$/

/**
 * 依赖边允许矩阵（超纲即 error）。design review 定稿：
 * requires/blocks/verifies 任意；consumes/implements/adapts 收紧。
 */
const EDGE_TARGET_ALLOWED: Readonly<Record<DependencyType, readonly ComponentType[] | 'any'>> = {
  requires: 'any',
  blocks: 'any',
  verifies: 'any',
  consumes: ['capability', 'adapter', 'registry', 'platform'],
  implements: ['module', 'capability', 'platform'],
  adapts: ['capability', 'platform'],
}

/** boundaries.ts 存的是 import 别名（'@/lib/...'），归一成磁盘路径再比对 ——
 *  不归一这条规则永远匹配不上任何东西、静默全绿（魏征挑刺审第 4 条）。 */
const PROVIDER_WRITE_PATHS = PROVIDER_WRITE_MODULES.map((m) => m.replace(/^@\//, 'src/'))

function pathOwnsModule(ownedPath: string, modulePath: string): boolean {
  if (ownedPath.endsWith('/')) return modulePath.startsWith(ownedPath)
  return modulePath === ownedPath || modulePath === ownedPath.replace(/\.ts$/, '')
}

export function validateRegistry(
  components: readonly ProductMapComponent[],
  facts: ExternalFacts,
): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const err = (componentId: string, code: string, message: string) =>
    errors.push({ componentId, code, message })
  const warn = (componentId: string, code: string, message: string) =>
    warnings.push({ componentId, code, message })

  // -- 重复 id -------------------------------------------------------------
  const seen = new Map<string, number>()
  for (const c of components) seen.set(c.id, (seen.get(c.id) ?? 0) + 1)
  for (const [id, n] of Array.from(seen.entries())) {
    if (n > 1) err(id, 'duplicate_id', `id 出现 ${n} 次`)
  }

  // -- 悬空依赖 / 环 -------------------------------------------------------
  for (const d of findDanglingDependencies(components)) {
    err(d.componentId, 'dangling_dependency', `依赖指向不存在的组件 '${d.dependency.target}'`)
  }
  for (const cycle of findOrderingCycles(components)) {
    err(cycle[0], 'ordering_cycle', `requires/blocks 成环：${cycle.join(' → ')}`)
  }

  // -- 单组件规则 ----------------------------------------------------------
  const enumChecks: readonly [string, (c: ProductMapComponent) => boolean][] = [
    ['componentType', (c) => (COMPONENT_TYPE as readonly string[]).includes(c.componentType)],
    ['businessLane', (c) => (BUSINESS_LANE as readonly string[]).includes(c.businessLane)],
    ['declaredMaturity', (c) => (MATURITY as readonly string[]).includes(c.declaredMaturity)],
    ['origin', (c) => (COMPONENT_ORIGIN as readonly string[]).includes(c.origin)],
    ['operationalStatus', (c) => (OPERATIONAL_STATUS as readonly string[]).includes(c.operationalStatus)],
  ]

  const ownedPathClaims = new Map<string, string>()

  for (const c of components) {
    // 🔴 故意没有 "id 前缀必须等于 componentType" 的检查：id 是稳定契约、
    //    不可改名（Build Control Room 2026-08-15 05:43 复审裁决），componentType
    //    只是历史形状分类，两者不再假设互相对应。
    if (!ID_PATTERN.test(c.id)) {
      err(c.id, 'bad_id_format', `id 必须是 '<type>.<name>' 全小写 kebab 形态`)
    }

    // 运行时枚举校验：挡住 as-cast / JSON 注入绕过编译期检查的路
    for (const [field, ok] of enumChecks) {
      if (!ok(c)) err(c.id, 'illegal_enum', `${field} 取值非法`)
    }

    // WP00 §3 七层角色 —— 判别式 union 的运行时闸（B1/B2；也挡 JSON 注入 / as-cast
    // 绕过编译期）。三种合法形态：
    //   me2_native 顶层     → 必须有七层之一的 architecturalRole，不得有 adapterOf
    //   me2_native 支持件    → 必须有 adapterOf，不得有 architecturalRole（B2：不占角色）
    //   legacy              → 两者都不得有
    const isSupporting = c.origin === 'me2_native' && c.adapterOf !== undefined
    if (c.origin === 'me2_native') {
      if (isSupporting) {
        // B2：supporting artifact 是父组件的零件，绝不占顶层七角色
        if (c.architecturalRole !== undefined) {
          err(c.id, 'supporting_artifact_with_role', 'adapterOf 已设的 supporting artifact 不得声明 architecturalRole —— 它是七层父组件的零件，不占顶层角色')
        }
      } else if (c.architecturalRole === undefined) {
        err(c.id, 'missing_architectural_role', 'me2_native 顶层组件必须声明 architecturalRole（WP00 冻结七层之一）')
      } else if (!(ARCHITECTURAL_ROLE as readonly string[]).includes(c.architecturalRole)) {
        err(c.id, 'illegal_enum', `architecturalRole 取值非法：'${c.architecturalRole}'`)
      }

      // B2（Codex 复审补漏）：me2_native 的 adapter **必须**是 supporting artifact
      // （挂了 adapterOf）。省略 adapterOf 再填个 architecturalRole，类型会把它当顶层
      // Me2RoleComponent 放行 —— 那就重新给了 adapter 冒充七层角色的口子。堵死。
      if (c.componentType === 'adapter' && c.adapterOf === undefined) {
        err(c.id, 'native_adapter_must_attach', 'me2_native 的 adapter 必须通过 adapterOf 挂靠七层父组件，不得作为顶层角色')
      }
    } else if (c.architecturalRole !== undefined) {
      err(c.id, 'legacy_with_architectural_role', 'legacy 组件不得声明 architecturalRole（尚未纳入 ME2 七层 / Kernel 治理）')
    }

    // adapterOf：只有 componentType === 'adapter' 的 me2_native 组件可以声明"我是谁的零件"
    if (c.adapterOf !== undefined) {
      if (c.origin !== 'me2_native') {
        err(c.id, 'legacy_with_adapter_of', 'legacy 组件不得声明 adapterOf（它不是任何 ME2 组件的零件）')
      }
      if (c.componentType !== 'adapter') {
        err(c.id, 'adapter_of_from_non_adapter', 'adapterOf 只能由 componentType=adapter 的组件声明')
      }
      // B2（Codex 复审补漏）：父组件必须是**真正的七层顶层组件** —— me2_native 且有
      // 合法 architecturalRole。指向 legacy、或指向另一个 supporting artifact（它自己
      // 没角色可继承）都会让"继承父组件角色"这句话断裂，还可能被 governanceStatusOf
      // 错标成已治理。存在性之外，验身份。
      const parent = components.find((t) => t.id === c.adapterOf)
      if (parent === undefined) {
        err(c.id, 'dangling_adapter_of', `adapterOf 指向不存在的组件 '${c.adapterOf}'`)
      } else if (
        parent.origin !== 'me2_native' ||
        parent.architecturalRole === undefined ||
        !(ARCHITECTURAL_ROLE as readonly string[]).includes(parent.architecturalRole)
      ) {
        err(c.id, 'adapter_of_invalid_parent', `adapterOf 必须指向 me2_native 且拥有合法七层 architecturalRole 的父组件（'${c.adapterOf}' 不满足）`)
      }
    }

    for (const s of c.dapeStages) {
      if (!(DAPE_STAGE as readonly string[]).includes(s)) err(c.id, 'illegal_enum', `dapeStages 含非法值 '${s}'`)
    }
    if (c.dapeStages.length === 0) err(c.id, 'empty_dape_stages', 'dapeStages 不得为空')

    for (const dep of c.dependencies) {
      if (!(DEPENDENCY_TYPE as readonly string[]).includes(dep.type)) {
        err(c.id, 'illegal_enum', `dependency type 非法 '${dep.type}'`)
      }
    }
    for (const b of c.currentBlockers) {
      if (!(BLOCKER_KIND as readonly string[]).includes(b.kind)) {
        err(c.id, 'illegal_enum', `blocker kind 非法 '${b.kind}'`)
      }
    }
    for (const p of c.poDecisionRequired) {
      if (!(PO_DECISION_KIND as readonly string[]).includes(p.kind)) {
        err(c.id, 'illegal_enum', `poDecision kind 非法 '${p.kind}'`)
      }
    }

    // 证据 kind / verification / PR role 的运行时校验 —— 编译期只关了半边门,
    // PR2 从持久化快照 hydrate 组件时这里是唯一的闸
    const evidenceKindChecks: readonly [string, readonly string[], readonly { kind: string; verification: string }[]][] = [
      ['contractEvidence', CONTRACT_EVIDENCE_KIND, c.contractEvidence],
      ['integrationEvidence', INTEGRATION_EVIDENCE_KIND, c.integrationEvidence],
      ['productionEvidence', PRODUCTION_EVIDENCE_KIND, c.productionEvidence],
      ['learningEvidence', LEARNING_EVIDENCE_KIND, c.learningEvidence],
    ]
    for (const [field, kinds, entries] of evidenceKindChecks) {
      for (const e of entries) {
        if (!kinds.includes(e.kind)) err(c.id, 'illegal_enum', `${field} kind 非法 '${e.kind}'`)
        if (!(EVIDENCE_VERIFICATION as readonly string[]).includes(e.verification)) {
          err(c.id, 'illegal_enum', `${field} verification 非法 '${e.verification}'`)
        }
      }
    }
    for (const pr of c.linkedPullRequests) {
      if (!(PR_ROLE as readonly string[]).includes(pr.role)) {
        err(c.id, 'illegal_enum', `PR role 非法 '${pr.role}'`)
      }
    }

    // Issue / PR 号必须是正整数（repo 是常量 APPROVED_REPO，结构上没有跨仓输入口）
    for (const n of c.linkedIssues) {
      if (!Number.isInteger(n) || n <= 0) err(c.id, 'bad_issue_number', `issue 号非法：${n}`)
    }
    for (const pr of c.linkedPullRequests) {
      if (!Number.isInteger(pr.number) || pr.number <= 0) {
        err(c.id, 'bad_pr_number', `PR 号非法：${pr.number}`)
      }
    }

    // 声明 M4/M5 但对应证据数组为空 = hard error（WP 明文，防夸大的第一道闸）
    if (maturityRank(c.declaredMaturity) >= maturityRank('M4_PRODUCTION_VALIDATED') && c.productionEvidence.length === 0) {
      err(c.id, 'declared_m4_without_evidence', '声明 M4+ 但 productionEvidence 为空')
    }
    if (c.declaredMaturity === 'M5_OPERATING_AND_LEARNING' && c.learningEvidence.length === 0) {
      err(c.id, 'declared_m5_without_evidence', '声明 M5 但 learningEvidence 为空')
    }

    // legacy 件不许携带 ME2 生产/学习证据 —— 它的生产人生记在 operationalStatus，
    // 不许被夸大成 ME2 M4/M5（WP 第十节）
    if (c.origin === 'legacy' && (c.productionEvidence.length > 0 || c.learningEvidence.length > 0)) {
      err(c.id, 'legacy_with_me2_evidence', 'legacy 组件的 production/learning 证据必须为空')
    }

    // module 边界：不解释就执行 = 不是 module
    if (c.componentType === 'module') {
      if (c.dapeStages.includes('execution')) {
        err(c.id, 'module_declares_execution', 'module 不产生外部副作用，不得声明 execution 阶段')
      }
      for (const dep of c.dependencies) {
        if (dep.type === 'adapts') err(c.id, 'module_adapts', 'module 不得有 adapts 边')
      }
      for (const owned of c.ownedPaths) {
        for (const pw of PROVIDER_WRITE_PATHS) {
          if (pathOwnsModule(owned, pw)) {
            err(c.id, 'module_owns_provider_write', `module 不得认领对外写入口 '${pw}'`)
          }
        }
      }
    }

    // adapter 边界：只翻译，不拥有业务授权/处方（严格版，设计审定稿）
    if (c.componentType === 'adapter') {
      for (const s of ['authorization', 'prescription'] as const) {
        if (c.dapeStages.includes(s)) {
          err(c.id, 'adapter_owns_business_stage', `adapter 不得声明 ${s} 阶段`)
        }
      }
    }

    // agent 边界：不随 module 机械增殖（#870 冻结）
    if (c.componentType === 'agent') {
      for (const dep of c.dependencies) {
        if (dep.type === 'implements') {
          const target = components.find((t) => t.id === dep.target)
          if (target?.componentType === 'module') {
            err(c.id, 'agent_implements_module', 'agent 不得 implements 一个 module')
          }
        }
      }
    }

    // 依赖边允许矩阵
    for (const dep of c.dependencies) {
      if (dep.type === 'adapts' && c.componentType !== 'adapter') {
        err(c.id, 'adapts_from_non_adapter', '只有 adapter 可以有 adapts 边')
      }
      const allowed = EDGE_TARGET_ALLOWED[dep.type]
      if (allowed !== 'any' && allowed !== undefined) {
        const target = components.find((t) => t.id === dep.target)
        if (target && !allowed.includes(target.componentType)) {
          err(c.id, 'edge_target_not_allowed', `${dep.type} 边不得指向 ${target.componentType}（'${dep.target}'）`)
        }
      }
    }

    // blocker id 唯一 + nextMilestone 引用真实 blocker（防散文断头）
    const blockerIds = new Set<string>()
    for (const b of c.currentBlockers) {
      if (blockerIds.has(b.id)) err(c.id, 'duplicate_blocker_id', `blocker id 重复 '${b.id}'`)
      blockerIds.add(b.id)
    }
    if (c.nextMilestone) {
      for (const ref of c.nextMilestone.unlockedBy) {
        if (!blockerIds.has(ref)) {
          err(c.id, 'milestone_dangling_blocker', `nextMilestone 引用不存在的 blocker '${ref}'`)
        }
      }
    }

    // ownedPaths：格式 + 跨组件重叠认领（前缀级 —— A 认领 'src/lib/cms/'、
    // B 认领 'src/lib/cms/x.ts' 同样是冲突，精确串匹配挡不住这种）
    for (const p of c.ownedPaths) {
      if (p.startsWith('/') || p.includes('..')) err(c.id, 'bad_owned_path', `ownedPath 必须是仓库相对路径：'${p}'`)
      for (const [claimed, owner] of Array.from(ownedPathClaims.entries())) {
        if (owner === c.id) continue
        if (p === claimed || pathOwnsModule(p, claimed.replace(/\/$/, '')) || pathOwnsModule(claimed, p.replace(/\/$/, ''))) {
          err(c.id, 'owned_path_conflict', `路径 '${p}' 与 '${owner}' 认领的 '${claimed}' 重叠`)
        }
      }
      ownedPathClaims.set(p, c.id)
    }

    if (c.origin === 'legacy' && c.operationalStatus === 'operating_me2') {
      err(c.id, 'legacy_operating_me2', "legacy 组件不能标 operating_me2（进了 ME2 就改 origin）")
    }

    // -- warnings（允许存在,但必须露头;PR3 控制台渲染,registry.test 锁快照）--
    const d = deriveMaturity(c, facts)
    if (maturityRank(c.declaredMaturity) > maturityRank(d.evidenceCeiling)) {
      warn(c.id, 'declared_above_ceiling', `声明 ${c.declaredMaturity} 高于证据上限 ${d.evidenceCeiling}（${d.ceilingReason}）`)
    }
    if (d.unverifiedCriticalEvidence) {
      warn(c.id, 'unverified_critical_evidence', 'M4+ 仅由 manual_claim 证据支撑，等 GitHub 同步核验')
    }
  }

  return { errors, warnings }
}
