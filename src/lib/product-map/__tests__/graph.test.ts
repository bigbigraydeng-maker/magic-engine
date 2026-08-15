import { describe, it, expect } from 'vitest'
import {
  findDependencyCycle,
  findUnclassifiedIssueNumbers,
  findUnclassifiedPullRequestNumbers,
  findUnclassifiedSourcePaths,
  validateRegistryGraph,
} from '../graph'
import type { RegistryComponent } from '../types'

function component(overrides: Partial<RegistryComponent> & { componentId: string }): RegistryComponent {
  return {
    type: 'capability',
    name: overrides.componentId,
    description: 'test',
    businessLanes: ['shared'],
    dapeStages: [],
    owners: ['owner-a'],
    version: '1.0.0',
    dependencies: [],
    consumers: [],
    sourcePaths: [`src/lib/${overrides.componentId}`],
    issueNumbers: [],
    pullRequestNumbers: [],
    riskLevel: 'B',
    requiredPermissions: [],
    evidence: [{ kind: 'source_path', description: 'x', link: 'x' }],
    maturityEvidence: {
      hasContractFrozen: true,
      hasMergedToMain: false,
      hasTargetedTestsPassing: false,
      hasRealIntegrationEvidence: false,
      hasProductionRunEvidence: false,
      hasRepeatedOutcomeEvidence: false,
    },
    maturity: 'M1',
    blockers: [],
    ...overrides,
  }
}

describe('validateRegistryGraph', () => {
  it('接受空 registry', () => {
    expect(validateRegistryGraph([])).toEqual({ ok: true })
  })

  it('接受依赖都能解析、无环的图', () => {
    const a = component({ componentId: 'a', dependencies: ['b'] })
    const b = component({ componentId: 'b' })
    expect(validateRegistryGraph([a, b])).toEqual({ ok: true })
  })

  it('拒绝指向不存在组件的 dependency', () => {
    const a = component({ componentId: 'a', dependencies: ['ghost'] })
    const result = validateRegistryGraph([a])
    expect(result.ok).toBe(false)
  })

  it('拒绝指向不存在组件的 consumer', () => {
    const a = component({ componentId: 'a', consumers: ['ghost'] })
    expect(validateRegistryGraph([a]).ok).toBe(false)
  })

  it('拒绝依赖环', () => {
    const a = component({ componentId: 'a', dependencies: ['b'] })
    const b = component({ componentId: 'b', dependencies: ['a'] })
    const result = validateRegistryGraph([a, b])
    expect(result.ok).toBe(false)
  })
})

describe('findDependencyCycle', () => {
  it('无环返回 null', () => {
    const a = component({ componentId: 'a', dependencies: ['b'] })
    const b = component({ componentId: 'b', dependencies: ['c'] })
    const c = component({ componentId: 'c' })
    expect(findDependencyCycle([a, b, c])).toBeNull()
  })

  it('自环也能检出', () => {
    const a = component({ componentId: 'a', dependencies: ['a'] })
    expect(findDependencyCycle([a])).toEqual(['a', 'a'])
  })

  it('三节点环能检出', () => {
    const a = component({ componentId: 'a', dependencies: ['b'] })
    const b = component({ componentId: 'b', dependencies: ['c'] })
    const c = component({ componentId: 'c', dependencies: ['a'] })
    const cycle = findDependencyCycle([a, b, c])
    expect(cycle).not.toBeNull()
    expect(cycle).toContain('a')
    expect(cycle).toContain('b')
    expect(cycle).toContain('c')
  })
})

describe('findUnclassifiedSourcePaths', () => {
  const components = [component({ componentId: 'seo', sourcePaths: ['src/lib/seo-gap'] })]

  it('目录前缀被覆盖时不算 unclassified', () => {
    expect(findUnclassifiedSourcePaths(['src/lib/seo-gap/index.ts'], components)).toEqual([])
  })

  it('完全没被任何组件覆盖的路径被列出', () => {
    expect(findUnclassifiedSourcePaths(['src/lib/mystery-dir'], components)).toEqual(['src/lib/mystery-dir'])
  })

  it('前缀相似但不是真前缀（没有 / 分隔）不算覆盖', () => {
    // src/lib/seo-gapfiller 不应该被 src/lib/seo-gap 误判为已覆盖
    expect(findUnclassifiedSourcePaths(['src/lib/seo-gapfiller'], components)).toEqual([
      'src/lib/seo-gapfiller',
    ])
  })
})

describe('findUnclassifiedIssueNumbers / findUnclassifiedPullRequestNumbers', () => {
  const components = [component({ componentId: 'a', issueNumbers: [1, 2], pullRequestNumbers: [10] })]

  it('未被任何组件引用的 issue 编号被列出', () => {
    expect(findUnclassifiedIssueNumbers([1, 2, 3], components)).toEqual([3])
  })

  it('未被任何组件引用的 PR 编号被列出', () => {
    expect(findUnclassifiedPullRequestNumbers([10, 11], components)).toEqual([11])
  })
})
