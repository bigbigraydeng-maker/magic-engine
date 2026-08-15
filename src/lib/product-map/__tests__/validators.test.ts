import { describe, it, expect } from 'vitest'
import { validateEvidenceRecord, validateRegistryComponent } from '../validators'
import type { RegistryComponent } from '../types'

function validComponent(overrides: Partial<RegistryComponent> = {}): RegistryComponent {
  return {
    componentId: 'test-widget',
    type: 'capability',
    name: 'Test Widget',
    description: 'A component used only in tests.',
    businessLanes: ['shared'],
    dapeStages: ['discovery'],
    owners: ['owner-a'],
    version: '1.0.0',
    dependencies: [],
    consumers: [],
    sourcePaths: ['src/lib/test-widget'],
    issueNumbers: [1],
    pullRequestNumbers: [2],
    riskLevel: 'B',
    requiredPermissions: [],
    evidence: [{ kind: 'source_path', description: 'exists', link: 'src/lib/test-widget' }],
    maturityEvidence: {
      hasContractFrozen: true,
      hasMergedToMain: true,
      hasTargetedTestsPassing: true,
      hasRealIntegrationEvidence: false,
      hasProductionRunEvidence: false,
      hasRepeatedOutcomeEvidence: false,
    },
    maturity: 'M2',
    blockers: [],
    ...overrides,
  }
}

describe('validateRegistryComponent — happy path', () => {
  it('接受一个字段齐全的合法组件', () => {
    expect(validateRegistryComponent(validComponent())).toEqual({ ok: true })
  })

  it('dapeStages 允许空数组', () => {
    expect(validateRegistryComponent(validComponent({ dapeStages: [] }))).toEqual({ ok: true })
  })
})

describe('validateRegistryComponent — 结构校验', () => {
  it('拒绝非对象', () => {
    expect(validateRegistryComponent(null)).toEqual({ ok: false, reason: expect.any(String) })
    expect(validateRegistryComponent('x')).toEqual({ ok: false, reason: expect.any(String) })
  })

  it('拒绝不认识的 type', () => {
    const result = validateRegistryComponent(validComponent({ type: 'domain' as never }))
    expect(result.ok).toBe(false)
  })

  it('拒绝非 kebab-case 的 componentId', () => {
    expect(validateRegistryComponent(validComponent({ componentId: 'Test_Widget' })).ok).toBe(false)
    expect(validateRegistryComponent(validComponent({ componentId: '-leading-hyphen' })).ok).toBe(false)
    expect(validateRegistryComponent(validComponent({ componentId: 'trailing-hyphen-' })).ok).toBe(false)
  })

  it('businessLanes 至少一条，且必须是已登记的车道', () => {
    expect(validateRegistryComponent(validComponent({ businessLanes: [] })).ok).toBe(false)
    expect(validateRegistryComponent(validComponent({ businessLanes: ['crypto' as never] })).ok).toBe(false)
  })

  it('owners / sourcePaths / evidence 不能为空数组', () => {
    expect(validateRegistryComponent(validComponent({ owners: [] })).ok).toBe(false)
    expect(validateRegistryComponent(validComponent({ sourcePaths: [] })).ok).toBe(false)
    expect(validateRegistryComponent(validComponent({ evidence: [] })).ok).toBe(false)
  })

  it('sourcePaths 拒绝绝对路径与目录穿越', () => {
    expect(validateRegistryComponent(validComponent({ sourcePaths: ['/etc/passwd'] })).ok).toBe(false)
    expect(validateRegistryComponent(validComponent({ sourcePaths: ['../secrets'] })).ok).toBe(false)
  })

  it('dependencies / consumers 里的引用必须是合法 componentId 格式', () => {
    expect(validateRegistryComponent(validComponent({ dependencies: ['Not Valid'] })).ok).toBe(false)
    expect(validateRegistryComponent(validComponent({ dependencies: ['valid-id'] })).ok).toBe(true)
  })

  it('riskLevel 必须是 A/B/C', () => {
    expect(validateRegistryComponent(validComponent({ riskLevel: 'D' as never })).ok).toBe(false)
  })

  it('blockers 必须显式给出（可以是空数组）', () => {
    expect(validateRegistryComponent(validComponent({ blockers: undefined as never })).ok).toBe(false)
    expect(validateRegistryComponent(validComponent({ blockers: [] })).ok).toBe(true)
  })

  it('blockers 里的每一条都要有 statement 和可解析的 since', () => {
    const bad = validComponent({ blockers: [{ statement: '', since: '2026-01-01' }] })
    expect(validateRegistryComponent(bad).ok).toBe(false)
    const bad2 = validComponent({ blockers: [{ statement: 'blocked', since: 'not-a-date' }] })
    expect(validateRegistryComponent(bad2).ok).toBe(false)
  })
})

describe('validateRegistryComponent — 成熟度必须由证据推导', () => {
  it('声明的 maturity 高于证据能撑住的天花板 —— 拒绝', () => {
    const result = validateRegistryComponent(validComponent({ maturity: 'M5' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('天花板')
  })

  it('声明的 maturity 低于证据天花板 —— 同样拒绝（必须恰好等于推导值）', () => {
    const result = validateRegistryComponent(validComponent({ maturity: 'M0' }))
    expect(result.ok).toBe(false)
  })

  it('声明的 maturity 恰好等于推导值 —— 接受', () => {
    expect(validateRegistryComponent(validComponent({ maturity: 'M2' })).ok).toBe(true)
  })
})

describe('validateRegistryComponent — 分类规则（Issue #974「分类模型」）', () => {
  it('type=adapter 必须声明至少一项 requiredPermissions', () => {
    const noPermissions = validComponent({ type: 'adapter', requiredPermissions: [] })
    expect(validateRegistryComponent(noPermissions).ok).toBe(false)

    const withPermissions = validComponent({ type: 'adapter', requiredPermissions: ['provider:read'] })
    expect(validateRegistryComponent(withPermissions).ok).toBe(true)
  })

  it('type=platform 的 businessLanes 必须严格等于 [shared]', () => {
    const wrongLane = validComponent({ type: 'platform', businessLanes: ['seo'] })
    expect(validateRegistryComponent(wrongLane).ok).toBe(false)

    const extraLane = validComponent({ type: 'platform', businessLanes: ['shared', 'seo'] })
    expect(validateRegistryComponent(extraLane).ok).toBe(false)

    const correct = validComponent({ type: 'platform', businessLanes: ['shared'] })
    expect(validateRegistryComponent(correct).ok).toBe(true)
  })

  it('type=registry 的 businessLanes 必须严格等于 [shared]', () => {
    const wrongLane = validComponent({ type: 'registry', businessLanes: ['ads'] })
    expect(validateRegistryComponent(wrongLane).ok).toBe(false)
  })
})

describe('validateEvidenceRecord', () => {
  it('link 不能为空 —— 证据必须指向具体东西', () => {
    expect(validateEvidenceRecord({ kind: 'issue', description: 'x', link: '' }).ok).toBe(false)
  })

  it('kind 必须是已登记的证据类型', () => {
    expect(validateEvidenceRecord({ kind: 'vibes', description: 'x', link: 'y' }).ok).toBe(false)
  })
})
