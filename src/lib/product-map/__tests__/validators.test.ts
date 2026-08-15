import { describe, it, expect } from 'vitest'
import {
  validateEvidenceRecord,
  validateMaturitySignals,
  validateOperationalCheck,
  validateOperationalSnapshot,
  validateRegistryComponent,
  validateSupportingArtifact,
} from '../validators'
import type { RegistryComponent } from '../types'

function validComponent(overrides: Partial<RegistryComponent> = {}): RegistryComponent {
  return {
    componentId: 'test-widget',
    architecturalRole: 'shared_capability',
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
    contractSpecPaths: [],
    supportingArtifacts: [],
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

  it('拒绝不认识的 architecturalRole', () => {
    const result = validateRegistryComponent(validComponent({ architecturalRole: 'domain' as never }))
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

describe('validateRegistryComponent — 拒绝动态事实字段', () => {
  it.each(['maturity', 'maturityEvidence', 'maturitySignals', 'operational'])(
    '带 %s 字段一律拒绝 —— 动态事实不许写进种子',
    (field) => {
      const withDynamic = { ...validComponent(), [field]: 'M5' }
      const result = validateRegistryComponent(withDynamic)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toContain(field)
    },
  )
})

describe('validateRegistryComponent — 冻结七层（WP00 §3）', () => {
  it.each([
    'agent', 'domain_module', 'measurement', 'shared_capability',
    'kernel', 'attribution_flywheel', 'operating_brief',
  ] as const)('接受冻结角色 %s', (role) => {
    const lanes = role === 'kernel' || role === 'operating_brief' ? (['shared'] as const) : (['seo'] as const)
    expect(validateRegistryComponent(validComponent({ architecturalRole: role, businessLanes: lanes })).ok).toBe(true)
  })

  it.each(['adapter', 'playbook', 'platform', 'registry', 'module', 'capability'])(
    '拒绝已废除的旧类型 %s —— 它们不是第八层',
    (legacy) => {
      expect(validateRegistryComponent(validComponent({ architecturalRole: legacy as never })).ok).toBe(false)
    },
  )

  it('kernel 的 businessLanes 必须严格等于 [shared]', () => {
    expect(validateRegistryComponent(validComponent({ architecturalRole: 'kernel', businessLanes: ['seo'] })).ok).toBe(false)
    expect(validateRegistryComponent(validComponent({ architecturalRole: 'kernel', businessLanes: ['shared', 'seo'] })).ok).toBe(false)
    expect(validateRegistryComponent(validComponent({ architecturalRole: 'kernel', businessLanes: ['shared'] })).ok).toBe(true)
  })

  it('operating_brief 的 businessLanes 必须严格等于 [shared]', () => {
    expect(
      validateRegistryComponent(validComponent({ architecturalRole: 'operating_brief', businessLanes: ['ads'] })).ok,
    ).toBe(false)
  })
})

describe('validateSupportingArtifact —— adapter 活在这里', () => {
  const artifact = (overrides: Record<string, unknown> = {}) => ({
    kind: 'provider_adapter',
    name: 'X 适配层',
    description: '连接外部系统',
    sourcePaths: ['src/lib/x'],
    requiredPermissions: ['x:read'],
    evidence: [{ kind: 'source_path', description: 'x', link: 'src/lib/x' }],
    ...overrides,
  })

  it('合法的 provider_adapter 通过', () => {
    expect(validateSupportingArtifact(artifact())).toEqual({ ok: true })
  })

  it('provider_adapter 零权限 —— 拒绝', () => {
    expect(validateSupportingArtifact(artifact({ requiredPermissions: [] })).ok).toBe(false)
  })

  it('非 provider_adapter 允许零权限', () => {
    expect(validateSupportingArtifact(artifact({ kind: 'orchestration_view', requiredPermissions: [] })).ok).toBe(true)
  })

  it('kind 越界 —— 拒绝', () => {
    expect(validateSupportingArtifact(artifact({ kind: 'adapter' })).ok).toBe(false)
  })

  it('必须至少一条证据', () => {
    expect(validateSupportingArtifact(artifact({ evidence: [] })).ok).toBe(false)
  })
})

describe('validateOperationalCheck —— 四问的一问', () => {
  it('boolean 一律拒绝 —— 那会丢掉「没查到 / 确定没有」的区别', () => {
    const result = validateOperationalCheck({ status: true, evidenceSource: 'x', checkedAt: '2026-08-15' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('布尔值')
  })

  it('status 必须是三态之一', () => {
    expect(validateOperationalCheck({ status: 'maybe', evidenceSource: 'x', checkedAt: null }).ok).toBe(false)
  })

  it('evidenceSource 不能为空 —— 必须说明答案从哪来', () => {
    expect(validateOperationalCheck({ status: 'unknown', evidenceSource: '', checkedAt: null }).ok).toBe(false)
  })

  it('给出确定答案就必须带 checkedAt', () => {
    expect(validateOperationalCheck({ status: 'yes', evidenceSource: 'github', checkedAt: null }).ok).toBe(false)
    expect(validateOperationalCheck({ status: 'no', evidenceSource: 'production', checkedAt: null }).ok).toBe(false)
    expect(
      validateOperationalCheck({ status: 'yes', evidenceSource: 'github', checkedAt: '2026-08-15T00:00:00Z' }).ok,
    ).toBe(true)
  })

  it('unknown 允许 checkedAt 为 null（从没查过）', () => {
    expect(validateOperationalCheck({ status: 'unknown', evidenceSource: 'not-wired', checkedAt: null }).ok).toBe(true)
  })
})

describe('validateOperationalSnapshot —— 四问缺一不可', () => {
  const check = { status: 'unknown', evidenceSource: 'not-wired', checkedAt: null }

  it('四问齐全通过', () => {
    expect(
      validateOperationalSnapshot({
        codeInMain: check,
        productionPrerequisitesExist: check,
        realCallerWired: check,
        productionRunObserved: check,
      }),
    ).toEqual({ ok: true })
  })

  it('缺任何一问都拒绝 —— 不许用其它三问代偿', () => {
    const result = validateOperationalSnapshot({
      codeInMain: check,
      productionPrerequisitesExist: check,
      realCallerWired: check,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('productionRunObserved')
  })
})

describe('validateMaturitySignals', () => {
  const signals = (overrides: Record<string, unknown> = {}) => ({
    contractFrozen: 'yes',
    mergedToMain: 'yes',
    targetedTestsPassing: 'unknown',
    realIntegration: 'no',
    productionRun: 'unknown',
    repeatedAttributableOutcome: 'unknown',
    ...overrides,
  })

  it('三态齐全通过', () => {
    expect(validateMaturitySignals(signals())).toEqual({ ok: true })
  })

  it('boolean 一律拒绝', () => {
    const result = validateMaturitySignals(signals({ mergedToMain: true }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('布尔值')
  })

  it('缺信号拒绝', () => {
    const partial = signals()
    delete (partial as Record<string, unknown>).productionRun
    expect(validateMaturitySignals(partial).ok).toBe(false)
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
