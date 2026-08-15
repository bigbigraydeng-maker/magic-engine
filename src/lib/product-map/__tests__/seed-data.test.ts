/**
 * 种子 registry 数据必须是自己校验器眼里合法的数据 —— 防止 `seed-components.ts`
 * 手写的 `maturity` 字段跟 `maturityEvidence` 推导出的天花板悄悄漂移。
 */

import { describe, it, expect } from 'vitest'
import { SEED_COMPONENTS } from '../registry-data/seed-components'
import { validateRegistryComponent } from '../validators'
import { deriveMaturityCeiling } from '../maturity'
import { validateRegistryGraph } from '../graph'
import type { ComponentType } from '../types'

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
    '%s 的 maturity 字段恰好等于 maturityEvidence 推导出的天花板',
    (_id, component) => {
      expect(component.maturity).toBe(deriveMaturityCeiling(component.maturityEvidence))
    },
  )

  it('依赖图内部一致：无悬空引用、无环', () => {
    expect(validateRegistryGraph(SEED_COMPONENTS)).toEqual({ ok: true })
  })

  it('七种组件类型至少各出现一次 —— Issue #974 分类模型要求全覆盖，不是只做部分类型的样例', () => {
    const types: readonly ComponentType[] = [
      'module', 'capability', 'adapter', 'agent', 'playbook', 'platform', 'registry',
    ]
    const present = new Set(SEED_COMPONENTS.map((c) => c.type))
    for (const type of types) {
      expect(present.has(type), `缺少 type=${type} 的种子条目`).toBe(true)
    }
  })

  it('每一条组件至少一个 sourcePath 真实存在于本仓库（用真实文件系统检查，不是互相印证）', async () => {
    const { existsSync } = await import('fs')
    const { join } = await import('path')
    const root = process.cwd()
    for (const component of SEED_COMPONENTS) {
      const anyExists = component.sourcePaths.some((p) => existsSync(join(root, p)))
      expect(anyExists, `${component.componentId} 的 sourcePaths 一个都不存在于磁盘：${component.sourcePaths.join(', ')}`).toBe(true)
    }
  })
})
