/**
 * 种子 registry 数据必须是自己校验器眼里合法的数据。
 *
 * 🔴 这一版新增的核心判据：**种子里不许出现任何动态事实字段**。
 *    上一版把 `maturity` / `maturityEvidence` 手填进种子，Git 或生产一变就过期 ——
 *    正是本工具要取代的东西。
 */

import { describe, it, expect } from 'vitest'
import { SEED_COMPONENTS } from '../registry-data/seed-components'
import { validateRegistryComponent } from '../validators'
import { validateRegistryGraph } from '../graph'
import { assessComponent } from '../assessment'

describe('SEED_COMPONENTS', () => {
  it('至少有一条数据（防止判据空跑）', () => {
    expect(SEED_COMPONENTS.length).toBeGreaterThan(0)
  })

  it('componentId 全局唯一', () => {
    const ids = SEED_COMPONENTS.map((c) => c.componentId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(SEED_COMPONENTS.map((c) => [c.componentId, c] as const))(
    '%s 通过 validateRegistryComponent',
    (_id, component) => {
      expect(validateRegistryComponent(component)).toEqual({ ok: true })
    },
  )

  it.each(SEED_COMPONENTS.map((c) => [c.componentId, c] as const))(
    '%s 不携带任何动态事实字段（maturity / 信号 / 四问快照）',
    (_id, component) => {
      const record = component as unknown as Record<string, unknown>
      for (const forbidden of ['maturity', 'maturityEvidence', 'maturitySignals', 'operational']) {
        expect(forbidden in record, `${component.componentId} 不该带 ${forbidden}`).toBe(false)
      }
    },
  )

  it('未接证据源时，每条组件的评估结果都是 unknown 受限，而不是被判定成「确定没有」', () => {
    for (const component of SEED_COMPONENTS) {
      const assessment = assessComponent(component)
      expect(assessment.maturity.limitedBy, component.componentId).toBe('unknown')
    }
  })

  it('依赖图内部一致：无悬空引用、无环', () => {
    expect(validateRegistryGraph(SEED_COMPONENTS)).toEqual({ ok: true })
  })

  it('architecturalRole 只取 WP00 §3 冻结七值 —— 没有第八个', () => {
    const frozen = new Set([
      'agent', 'domain_module', 'measurement', 'shared_capability',
      'kernel', 'attribution_flywheel', 'operating_brief',
    ])
    for (const component of SEED_COMPONENTS) {
      expect(frozen.has(component.architecturalRole), `${component.componentId} 角色越界`).toBe(true)
    }
  })

  it('adapter 只能作为附属产物出现，不得成为顶层组件', () => {
    for (const component of SEED_COMPONENTS) {
      expect((component as unknown as Record<string, unknown>).type).toBeUndefined()
    }
    const adapters = SEED_COMPONENTS.flatMap((c) =>
      c.supportingArtifacts.filter((a) => a.kind === 'provider_adapter'),
    )
    expect(adapters.length).toBeGreaterThan(0)
    for (const adapter of adapters) {
      expect(adapter.requiredPermissions.length).toBeGreaterThan(0)
    }
  })

  it('每一条组件至少一个 sourcePath 真实存在于本仓库（用真实文件系统检查，不是互相印证）', async () => {
    const { existsSync } = await import('fs')
    const { join } = await import('path')
    const root = process.cwd()
    for (const component of SEED_COMPONENTS) {
      const anyExists = component.sourcePaths.some((p) => existsSync(join(root, p)))
      expect(
        anyExists,
        `${component.componentId} 的 sourcePaths 一个都不存在于磁盘：${component.sourcePaths.join(', ')}`,
      ).toBe(true)
    }
  })

  it('声明的 contractSpecPaths 必须真实存在 —— 它驱动 M1 判定，不许指向不存在的文档', async () => {
    const { existsSync } = await import('fs')
    const { join } = await import('path')
    const root = process.cwd()
    for (const component of SEED_COMPONENTS) {
      for (const specPath of component.contractSpecPaths) {
        expect(existsSync(join(root, specPath)), `${component.componentId} 的 ${specPath} 不存在`).toBe(true)
      }
    }
  })

  it('附属产物的 sourcePath 同样必须真实存在', async () => {
    const { existsSync } = await import('fs')
    const { join } = await import('path')
    const root = process.cwd()
    for (const component of SEED_COMPONENTS) {
      for (const artifact of component.supportingArtifacts) {
        const anyExists = artifact.sourcePaths.some((p) => existsSync(join(root, p)))
        expect(anyExists, `${component.componentId} / ${artifact.name} 的路径都不存在`).toBe(true)
      }
    }
  })
})
