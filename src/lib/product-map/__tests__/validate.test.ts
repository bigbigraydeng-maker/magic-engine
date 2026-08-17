/** 校验器测试 —— 每条 hard error 规则至少一个触发用例 + 一个不误伤用例。 */

import { describe, expect, it } from 'vitest'
import { EMPTY_EXTERNAL_FACTS } from '../external-facts'
import type { ProductMapComponent } from '../types'
import { validateRegistry } from '../validate'
import { makeComponent, makeFacts, mergedPr } from './_fixtures'

function errorCodes(components: readonly ProductMapComponent[]): string[] {
  return validateRegistry(components, EMPTY_EXTERNAL_FACTS).errors.map((e) => e.code)
}

describe('结构规则', () => {
  it('重复 id 报错', () => {
    expect(errorCodes([makeComponent(), makeComponent()])).toContain('duplicate_id')
  })

  it('悬空依赖报错', () => {
    const c = makeComponent({ dependencies: [{ type: 'requires', target: 'platform.ghost' }] })
    expect(errorCodes([c])).toContain('dangling_dependency')
  })

  it('requires 成环报错', () => {
    const a = makeComponent({ id: 'platform.a', dependencies: [{ type: 'requires', target: 'platform.b' }] })
    const b = makeComponent({ id: 'platform.b', dependencies: [{ type: 'requires', target: 'platform.a' }] })
    expect(errorCodes([a, b])).toContain('ordering_cycle')
  })

  it('as-cast 绕过编译期的非法枚举被运行时抓住', () => {
    const c = makeComponent({ businessLane: 'growth' as unknown as ProductMapComponent['businessLane'] })
    expect(errorCodes([c])).toContain('illegal_enum')
  })

  it('id 格式不合契约报错', () => {
    expect(errorCodes([makeComponent({ id: 'BadName' })])).toContain('bad_id_format')
  })

  it('两个组件认领同一路径报错', () => {
    const a = makeComponent({ id: 'platform.a', ownedPaths: ['src/lib/x/'] })
    const b = makeComponent({ id: 'platform.b', ownedPaths: ['src/lib/x/'] })
    expect(errorCodes([a, b])).toContain('owned_path_conflict')
  })
})

describe('防夸大规则', () => {
  it('声明 M4 但 productionEvidence 为空 = hard error', () => {
    const c = makeComponent({ declaredMaturity: 'M4_PRODUCTION_VALIDATED' })
    expect(errorCodes([c])).toContain('declared_m4_without_evidence')
  })

  it('声明 M5 但 learningEvidence 为空 = hard error', () => {
    const c = makeComponent({
      declaredMaturity: 'M5_OPERATING_AND_LEARNING',
      productionEvidence: [{ kind: 'production_run', ref: 'x', verification: 'manual_claim' }],
    })
    expect(errorCodes([c])).toContain('declared_m5_without_evidence')
  })

  it('legacy 件带 ME2 生产/学习证据 = hard error', () => {
    const c = makeComponent({
      origin: 'legacy',
      architecturalRole: undefined,
      operationalStatus: 'operating_legacy',
      ownedPaths: ['src/lib/x/'],
      productionEvidence: [{ kind: 'production_run', ref: 'x', verification: 'manual_claim' }],
    })
    expect(errorCodes([c])).toContain('legacy_with_me2_evidence')
  })

  it('legacy 件标 operating_me2 = hard error', () => {
    const c = makeComponent({
      origin: 'legacy',
      architecturalRole: undefined,
      operationalStatus: 'operating_me2',
      ownedPaths: ['src/lib/x/'],
    })
    expect(errorCodes([c])).toContain('legacy_operating_me2')
  })

  it('me2_native 组件缺 architecturalRole = hard error', () => {
    const c = makeComponent({ architecturalRole: undefined })
    expect(errorCodes([c])).toContain('missing_architectural_role')
  })

  it('architecturalRole 非法值被运行时抓住', () => {
    const c = makeComponent({ architecturalRole: 'platform' as unknown as ProductMapComponent['architecturalRole'] })
    expect(errorCodes([c])).toContain('illegal_enum')
  })

  it('legacy 组件声明 architecturalRole = hard error（不许伪装成已纳入 ME2 治理）', () => {
    // 判别式 union 在类型层已禁掉 legacy+architecturalRole；这里绕过类型强行构造脏对象,
    // 验证运行时闸也拦得住（PR2 从 JSON 快照 hydrate 时这是唯一的门）。
    const base = makeComponent({
      origin: 'legacy',
      operationalStatus: 'operating_legacy',
      ownedPaths: ['src/lib/x/'],
    })
    const dirty = { ...base, architecturalRole: 'kernel' } as unknown as ProductMapComponent
    expect(errorCodes([dirty])).toContain('legacy_with_architectural_role')
  })

  it('B2：supporting artifact（me2_native + adapterOf）声明 architecturalRole = hard error', () => {
    // 同样绕过类型层，验证运行时守卫 supporting_artifact_with_role
    const parent = makeComponent({ id: 'capability.parent', componentType: 'capability' })
    const base = makeComponent({ id: 'adapter.child', componentType: 'adapter', adapterOf: 'capability.parent' })
    const dirty = { ...base, architecturalRole: 'measurement' } as unknown as ProductMapComponent
    expect(errorCodes([parent, dirty])).toContain('supporting_artifact_with_role')
  })

  it('B2（Codex）：me2_native 的 adapter 省略 adapterOf 就报错，不给它当顶层角色的口子', () => {
    // componentType=adapter、me2_native、有 architecturalRole、没 adapterOf ——
    // 类型层会把它当 Me2RoleComponent 放行，运行时闸必须堵死
    const c = makeComponent({ id: 'adapter.rogue', componentType: 'adapter' }) // 默认 me2_native + kernel role
    expect(errorCodes([c])).toContain('native_adapter_must_attach')
  })

  it('B2（Codex）：adapterOf 指向 legacy 父组件 = 报错（角色语义无处继承）', () => {
    const legacyParent = makeComponent({ id: 'platform.legacy-parent', origin: 'legacy', architecturalRole: undefined })
    const child = makeComponent({ id: 'adapter.child', componentType: 'adapter', adapterOf: 'platform.legacy-parent' })
    expect(errorCodes([legacyParent, child])).toContain('adapter_of_invalid_parent')
  })

  it('B2（Codex）：adapterOf 指向另一个 supporting artifact = 报错（它自己没角色可继承）', () => {
    const roleParent = makeComponent({ id: 'capability.root', componentType: 'capability' })
    // 真正的 supporting artifact：无 architecturalRole（显式清掉 makeComponent 的默认 role）
    const supporting = makeComponent({ id: 'adapter.mid', componentType: 'adapter', adapterOf: 'capability.root', architecturalRole: undefined })
    const child = makeComponent({ id: 'adapter.leaf', componentType: 'adapter', adapterOf: 'adapter.mid', architecturalRole: undefined })
    expect(errorCodes([roleParent, supporting, child])).toContain('adapter_of_invalid_parent')
  })

  it('adapterOf 指向不存在的组件报错', () => {
    const c = makeComponent({ componentType: 'adapter', adapterOf: 'platform.ghost' })
    expect(errorCodes([c])).toContain('dangling_adapter_of')
  })

  it('非 adapter 声明 adapterOf 报错', () => {
    const parent = makeComponent({ id: 'platform.parent' })
    const c = makeComponent({ id: 'capability.c', componentType: 'capability', adapterOf: 'platform.parent' })
    expect(errorCodes([c, parent])).toContain('adapter_of_from_non_adapter')
  })

  it('adapter 正确挂靠真实父组件不误伤', () => {
    const parent = makeComponent({ id: 'platform.parent' })
    const c = makeComponent({ id: 'adapter.c', componentType: 'adapter', adapterOf: 'platform.parent' })
    expect(errorCodes([c, parent])).not.toContain('dangling_adapter_of')
    expect(errorCodes([c, parent])).not.toContain('adapter_of_from_non_adapter')
  })

  it('声明高于证据上限 → warning 露头(不是 error)', () => {
    const c = makeComponent({ declaredMaturity: 'M2_IMPLEMENTED' })
    const r = validateRegistry([c], EMPTY_EXTERNAL_FACTS)
    expect(r.errors).toHaveLength(0)
    expect(r.warnings.map((w) => w.code)).toContain('declared_above_ceiling')
  })

  it('声明与证据相符时无 warning', () => {
    const c = makeComponent({
      declaredMaturity: 'M2_IMPLEMENTED',
      contractEvidence: [{ kind: 'frozen_contract', ref: 'docs/x.md', verification: 'manual_claim' }],
      linkedPullRequests: [{ number: 5, role: 'implements' }],
    })
    const r = validateRegistry([c], makeFacts([mergedPr(5)]))
    expect(r.errors).toHaveLength(0)
    expect(r.warnings).toHaveLength(0)
  })
})

describe('组件语义边界(module / adapter / agent)', () => {
  it('module 声明 execution 阶段 = hard error', () => {
    const c = makeComponent({ id: 'module.x', componentType: 'module', dapeStages: ['analysis', 'execution'] })
    expect(errorCodes([c])).toContain('module_declares_execution')
  })

  it('module 认领对外写入口模块 = hard error(别名已归一化)', () => {
    const c = makeComponent({ id: 'module.x', componentType: 'module', dapeStages: ['analysis'], ownedPaths: ['src/lib/cms/'] })
    expect(errorCodes([c])).toContain('module_owns_provider_write')
  })

  it('module 认领普通路径不误伤', () => {
    const c = makeComponent({ id: 'module.x', componentType: 'module', dapeStages: ['analysis'], ownedPaths: ['src/lib/diagnostic/'] })
    expect(errorCodes([c])).not.toContain('module_owns_provider_write')
  })

  it('module 带 adapts 边 = hard error', () => {
    const t = makeComponent({ id: 'capability.t', componentType: 'capability' })
    const c = makeComponent({ id: 'module.x', componentType: 'module', dapeStages: ['analysis'], dependencies: [{ type: 'adapts', target: 'capability.t' }] })
    expect(errorCodes([c, t])).toContain('module_adapts')
  })

  it('adapter 声明 authorization / prescription 阶段 = hard error', () => {
    const a = makeComponent({ id: 'adapter.x', componentType: 'adapter', dapeStages: ['authorization'] })
    expect(errorCodes([a])).toContain('adapter_owns_business_stage')
    const b = makeComponent({ id: 'adapter.y', componentType: 'adapter', dapeStages: ['prescription'] })
    expect(errorCodes([b])).toContain('adapter_owns_business_stage')
  })

  it('agent implements 一个 module = hard error(#870:Agent 不随 Module 增殖)', () => {
    const m = makeComponent({ id: 'module.m', componentType: 'module', dapeStages: ['analysis'] })
    const a = makeComponent({ id: 'agent.a', componentType: 'agent', dependencies: [{ type: 'implements', target: 'module.m' }] })
    expect(errorCodes([m, a])).toContain('agent_implements_module')
  })

  it('非 adapter 带 adapts 边 = hard error', () => {
    const t = makeComponent({ id: 'capability.t', componentType: 'capability' })
    const c = makeComponent({ id: 'capability.c', componentType: 'capability', dependencies: [{ type: 'adapts', target: 'capability.t' }] })
    expect(errorCodes([c, t])).toContain('adapts_from_non_adapter')
  })

  it('consumes 指向 module = 超出允许矩阵', () => {
    const m = makeComponent({ id: 'module.m', componentType: 'module', dapeStages: ['analysis'] })
    const c = makeComponent({ id: 'capability.c', componentType: 'capability', dependencies: [{ type: 'consumes', target: 'module.m' }] })
    expect(errorCodes([c, m])).toContain('edge_target_not_allowed')
  })
})

describe('blocker 与里程碑', () => {
  it('blocker id 重复报错', () => {
    const c = makeComponent({
      currentBlockers: [
        { id: 'b1', kind: 'code', summary: 'x' },
        { id: 'b1', kind: 'data', summary: 'y' },
      ],
    })
    expect(errorCodes([c])).toContain('duplicate_blocker_id')
  })

  it('nextMilestone 引用不存在的 blocker 报错(防散文断头)', () => {
    const c = makeComponent({
      nextMilestone: { target: 'M2_IMPLEMENTED', unlockedBy: ['ghost-blocker'] },
    })
    expect(errorCodes([c])).toContain('milestone_dangling_blocker')
  })
})
